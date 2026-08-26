import { statSync } from 'node:fs'
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

/** Every concrete file a bare path could name: the path itself, then extensions, then `/index`. */
const candidatesFor = (base: string): string[] => [
  base,
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

    const viaPaths = firstExisting(
      mapped.map((target) => (target.startsWith('/') ? target : join(options.cwd, target))),
    )
    if (viaPaths.path) return { path: viaPaths.path, failedLookups: viaPaths.failedLookups, affectingFiles: [] }

    const result = factory.sync(from, specifier)
    return {
      path: result.path ?? undefined,
      failedLookups: viaPaths.failedLookups,
      affectingFiles: result.packageJsonPath ? [result.packageJsonPath] : [],
    }
  }
}
