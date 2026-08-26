import { readFileSync, statSync } from 'node:fs'
import { ResolverFactory } from 'oxc-resolver'
import type { FileSystemDelegate } from './types'

/**
 * Where a specifier went, and what was tried on the way.
 *
 * TypeScript 7 does not expose module resolution — the Go compiler resolves internally to build
 * the program and hands back neither the graph nor the probes. So resolution becomes bamboo's,
 * and the probes have to come with it: `failedLookups` is not diagnostics, it is what decides
 * whether an unresolved specifier is *local*, and therefore whether a file created later can
 * satisfy it. Drop it and a dev server stops noticing that a new file completed a broken
 * import — silently, because the import was already broken.
 *
 * `affectingFiles` is the other half: the `package.json` files a resolution consulted, which a
 * watch rebuild has to invalidate on.
 */
export interface ResolvedModule {
  /** The file the specifier resolved to, absent when it resolved to nothing. */
  path?: string
  /** Concrete paths tried and not found, in priority order. */
  failedLookups: string[]
  /** Files whose contents decided this resolution — `package.json` and friends. */
  affectingFiles: string[]
}

export interface ResolveOptions {
  /** The importing file, which relative specifiers are relative to. */
  importer: string
  /** `paths`/`baseUrl` from the project's tsconfig, already resolved to absolute directories. */
  paths?: Record<string, string[]>
  baseUrl?: string
  /** Reads delegated to bamboo's runtime, so a synthesized source resolves like a real one. */
  fs?: FileSystemDelegate
}

/**
 * The extensions a specifier may omit, in the order TypeScript tries them.
 *
 * `.tsx` before `.d.ts` and `.js` last, because a checkout that has both `a.ts` and `a.js` means
 * the first: the second is its output. Getting this order wrong resolves an import to a build
 * artifact and extracts from generated code.
 */
const EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const

const dirname = (filePath: string) => filePath.slice(0, Math.max(0, filePath.lastIndexOf('/')))

const join = (...parts: string[]) => {
  const joined = parts.filter(Boolean).join('/')
  const segments: string[] = []
  for (const segment of joined.split('/')) {
    if (segment === '.' || segment === '') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return (joined.startsWith('/') ? '/' : '') + segments.join('/')
}

/**
 * Every concrete file a path could name: the path itself, then extensions, then `/index`.
 *
 * The path itself only when it already carries one of those extensions. `./styles` names
 * `styles.ts`, never a file called `styles` with no extension — and probing for one anyway
 * leaves a candidate that can never be satisfied. That is not merely a wasted `stat`: the
 * misses are reported as `failedLookups`, which become the *pending candidates* a watch build
 * re-checks, so an unsatisfiable one keeps its importer permanently unresolved and rebuilt.
 */
const candidatesFor = (base: string): string[] => [
  ...(EXTENSIONS.some((extension) => base.endsWith(extension)) ? [base] : []),
  ...EXTENSIONS.map((extension) => base + extension),
  ...EXTENSIONS.map((extension) => join(base, 'index' + extension)),
]

const isRelative = (specifier: string) =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..'

/**
 * Resolve a specifier the way the program that will bundle it does.
 *
 * Split by shape rather than handed wholesale to one resolver, because the two halves need
 * different things. A relative or mapped specifier is the case where the probe list matters, and
 * enumerating it here is exact — every candidate not found is a path that, if written, would
 * resolve. A bare specifier goes to `oxc-resolver`, which implements Node's algorithm including
 * `exports`/`imports`, and reports the `package.json` that decided it.
 */
export const createResolver = (options: { cwd: string; fs?: FileSystemDelegate }) => {
  /**
   * Does this path hold a file?
   *
   * Asked once per candidate, and `firstExisting` walks a lot of candidates, so what this does
   * *not* do matters as much as what it does.
   *
   * The disk answers first. It is the cheap answer — one `stat`, no bytes — and it is the
   * precise one: a candidate has to be a *file*, or `./nested` stops at the directory rather
   * than reaching `nested/index.ts`. Only when there is nothing on disk is a delegate worth
   * asking, because the sole case it decides differently is a module with no file behind it,
   * which is exactly what a synthesized or overlay source is. A delegate that merely *shadows*
   * a real path does not change whether that path exists.
   *
   * Every delegated call is contained. A resolver probes paths that mostly do not exist, and
   * asks about directories as though they were files; bamboo's runtime `fs` throws for both,
   * being written for callers that read files they believe in. Here a failure to answer is
   * absence, which is what it means — an escaping ENOENT would fail the parse of a file whose
   * imports all resolve, over a candidate that was never supposed to be there.
   */
  const exists = (filePath: string): boolean => {
    try {
      if (statSync(filePath).isFile()) return true
    } catch {
      // Nothing on disk under that name — ask below.
    }

    try {
      if (options.fs?.fileExists?.(filePath) === true) return true
      const read = options.fs?.readFile?.(filePath)
      return read !== undefined && read !== null
    } catch {
      return false
    }
  }

  /** A file's text through the same order `exists` asks in, or nothing. */
  const readContent = (filePath: string): string | undefined => {
    try {
      const delegated = options.fs?.readFile?.(filePath)
      if (delegated != null) return delegated
    } catch {
      // Fall through to the disk.
    }
    try {
      return statSync(filePath).isFile() ? readFileSync(filePath, 'utf8') : undefined
    } catch {
      return undefined
    }
  }

  const readJson = (filePath: string): Record<string, unknown> | undefined => {
    const text = readContent(filePath)
    if (text === undefined) return undefined
    try {
      const parsed: unknown = JSON.parse(text)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Every target an `exports`/`imports` entry can name, in the order to try them.
   *
   * The field is a string, an array of fallbacks, or an object of conditions — and conditions
   * nest. Order is what matters here rather than which condition is "right": these are
   * candidates, and the first that exists wins, which is what the array form means anyway.
   */
  const targetsOf = (entry: unknown): string[] => {
    if (typeof entry === 'string') return [entry]
    if (Array.isArray(entry)) return entry.flatMap(targetsOf)
    if (entry && typeof entry === 'object') return Object.values(entry).flatMap(targetsOf)
    return []
  }

  /** The nearest `package.json` at or above a directory, with the directory that holds it. */
  const nearestPackage = (from: string): { dir: string; json: Record<string, unknown>; path: string } | undefined => {
    let dir = from
    for (;;) {
      const path = join(dir, 'package.json')
      const json = readJson(path)
      if (json) return { dir, json, path }
      const parent = dirname(dir)
      if (parent === dir) return undefined
      dir = parent
    }
  }

  /**
   * A bare specifier, resolved by reading through the project's filesystem.
   *
   * Reached only when `oxc-resolver` finds nothing, which on a real checkout means the module
   * genuinely is not there. It matters when the files are not on disk at all: a bundler hands
   * bamboo modules it holds in memory, and `oxc-resolver` reads the real filesystem and cannot
   * be given another one. Without this, resolution is inconsistent about where it looks —
   * relative and `paths` specifiers read through the delegate while bare ones do not, so a
   * virtual `node_modules` resolves for one and not the other.
   *
   * Covers what a bare specifier can be: a package subpath, a package's own `exports` map, a
   * `#name` from the nearest `package.json`'s `imports`, and a self-reference by the package's
   * own name.
   */
  const bareThroughDelegate = (
    specifier: string,
    from: string,
  ): { path?: string; failedLookups: string[]; affectingFiles: string[] } => {
    const owner = nearestPackage(from)

    if (specifier.startsWith('#')) {
      if (!owner) return { failedLookups: [], affectingFiles: [] }
      const targets = targetsOf((owner.json.imports as Record<string, unknown>)?.[specifier])
      const found = firstExisting(targets.map((target) => join(owner.dir, target)))
      return { path: found.path, failedLookups: found.failedLookups, affectingFiles: [owner.path] }
    }

    const slash = specifier.indexOf('/', specifier.startsWith('@') ? specifier.indexOf('/') + 1 : 0)
    const name = slash === -1 ? specifier : specifier.slice(0, slash)
    const subpath = slash === -1 ? '.' : `.${specifier.slice(slash)}`

    // Misses from the package's *own* map only — `imports` and a self-referencing `exports`,
    // whose targets are files inside the project. Those become the pending candidates a watch
    // build re-checks, so a target listed ahead of the one that resolved has to appear here or
    // writing it later re-resolves nothing.
    //
    // The `node_modules` walk below is deliberately silent. Package discovery probes a
    // directory at every level above the importer, and reporting those would make an ordinary
    // external dependency look like a local name waiting to be written.
    const failedLookups: string[] = []

    // A package referring to itself by name, which `exports` is what makes legal.
    if (owner && owner.json.name === name) {
      const targets = targetsOf((owner.json.exports as Record<string, unknown>)?.[subpath])
      const found = firstExisting(targets.map((target) => join(owner.dir, target)))
      failedLookups.push(...found.failedLookups)
      if (found.path) return { path: found.path, failedLookups, affectingFiles: [owner.path] }
    }

    for (let dir = from; ; dir = dirname(dir)) {
      const root = join(dir, 'node_modules', name)
      const manifestPath = join(root, 'package.json')
      const manifest = readJson(manifestPath)

      if (manifest) {
        const exported = targetsOf((manifest.exports as Record<string, unknown>)?.[subpath])
        const implied = subpath === '.' ? targetsOf(manifest.types ?? manifest.main ?? manifest.module) : []
        const direct = subpath === '.' ? [] : [subpath]
        const found = firstExisting([...exported, ...implied, ...direct].map((target) => join(root, target)))
        if (found.path) return { path: found.path, failedLookups, affectingFiles: [manifestPath] }
      }

      if (subpath !== '.') {
        const found = firstExisting([join(root, subpath)])
        if (found.path) return { path: found.path, failedLookups, affectingFiles: manifest ? [manifestPath] : [] }
      }

      const parent = dirname(dir)
      if (!parent || parent === dir) return { failedLookups, affectingFiles: [] }
    }
  }

  const factory = new ResolverFactory({
    extensions: [...EXTENSIONS],
    // A `.ts` source importing `./x.js` means `./x.ts`; without this the import resolves to the
    // emitted file when one is present and to nothing when it is not.
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'], '.cjs': ['.cts', '.cjs'] },
  })

  const firstExisting = (bases: string[]): { path?: string; failedLookups: string[] } => {
    const failedLookups: string[] = []
    for (const base of bases) {
      for (const candidate of candidatesFor(base)) {
        if (exists(candidate)) return { path: candidate, failedLookups }
        failedLookups.push(candidate)
      }
    }
    return { failedLookups }
  }

  return (specifier: string, resolveOptions: ResolveOptions): ResolvedModule => {
    const from = dirname(resolveOptions.importer)

    if (isRelative(specifier) || specifier.startsWith('/')) {
      const base = specifier.startsWith('/') ? specifier : join(from, specifier)
      const { path, failedLookups } = firstExisting([base])
      return { path, failedLookups, affectingFiles: [] }
    }

    // `paths` and `baseUrl` are tried before the package algorithm, exactly as tsc does, and
    // their misses are the substitutions that make a bare name local.
    const mapped: string[] = []
    for (const [pattern, targets] of Object.entries(resolveOptions.paths ?? {})) {
      const star = pattern.indexOf('*')
      if (star === -1) {
        if (pattern === specifier) mapped.push(...targets)
        continue
      }
      const prefix = pattern.slice(0, star)
      const suffix = pattern.slice(star + 1)
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue
      const matched = specifier.slice(prefix.length, specifier.length - suffix.length)
      mapped.push(...targets.map((target) => target.replace('*', matched)))
    }
    if (resolveOptions.baseUrl) mapped.push(join(resolveOptions.baseUrl, specifier))

    // Against `baseUrl`, which is what a `paths` target is relative to — TypeScript resolves
    // `{"~/*": ["./app/src/*"]}` from the base URL, not from the process's working directory.
    // Joining against the cwd instead silently turns every mapped target into a different path,
    // and the alias resolves to nothing.
    const pathsBase = resolveOptions.baseUrl ?? options.cwd
    const viaPaths = firstExisting(mapped.map((target) => (target.startsWith('/') ? target : join(pathsBase, target))))
    if (viaPaths.path) return { path: viaPaths.path, failedLookups: viaPaths.failedLookups, affectingFiles: [] }

    const result = factory.sync(from, specifier)
    if (result.path) {
      return {
        path: result.path,
        failedLookups: viaPaths.failedLookups,
        affectingFiles: result.packageJsonPath ? [result.packageJsonPath] : [],
      }
    }

    const delegated = bareThroughDelegate(specifier, from)
    return {
      path: delegated.path,
      failedLookups: [...viaPaths.failedLookups, ...delegated.failedLookups],
      affectingFiles: delegated.affectingFiles,
    }
  }
}
