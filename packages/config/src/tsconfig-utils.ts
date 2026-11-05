/**
 * Utilities for resolving tsconfig.json files and matching source files
 * against tsconfig include/exclude/files globs.
 *
 * Replaces the discontinued `tsconfck` package. Uses `get-tsconfig` for
 * parsing (including `extends` chains) and implements tsconfck-compatible
 * glob matching for project-reference resolution.
 */
import { logger } from '@bamboocss/logger'
import type { TsConfigJsonResolved } from 'get-tsconfig'
import { existsSync, promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Find tsconfig
// ---------------------------------------------------------------------------

/**
 * If `filename` points to a `.json` file that exists as a regular file, return its absolute path.
 */
export async function resolveDirectTsconfigJson(filename: string): Promise<string | null> {
  if (path.extname(filename) !== '.json') return null
  const resolved = path.resolve(filename)
  try {
    const stat = await fs.stat(resolved)
    if (stat.isFile() || stat.isFIFO()) return resolved
    throw new Error(`${filename} exists but is not a regular file.`)
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw e
  }
}

/**
 * Walk upward from `dirname(filename)` and return the first existing `configName`,
 * stopping at `root` (inclusive) or the filesystem root.
 */
export async function findClosestTsconfig(
  filename: string,
  root: string,
  configName = 'tsconfig.json',
): Promise<string | null> {
  const resolvedRoot = path.resolve(root)
  let dir = path.dirname(path.resolve(filename))

  for (;;) {
    const candidate = path.join(dir, configName)
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile() || stat.isFIFO()) {
        return candidate
      }
    } catch {
      // ENOENT: continue
    }

    if (dir === resolvedRoot || path.dirname(dir) === dir) {
      return null
    }
    dir = path.dirname(dir)
  }
}

// ---------------------------------------------------------------------------
// Resolve baseUrl
// ---------------------------------------------------------------------------

/**
 * Resolve `compilerOptions.baseUrl` the same way TypeScript does: relative to the tsconfig file.
 * Falls back to `cwd` when `baseUrl` is omitted.
 */
export function resolveBaseUrlForCompilerOptions(
  baseUrl: string | undefined,
  tsconfigFile: string,
  cwd: string,
): string {
  if (baseUrl == null) return cwd
  if (baseUrl.startsWith('${')) return baseUrl
  if (path.isAbsolute(baseUrl)) return baseUrl
  return path.resolve(path.dirname(tsconfigFile), baseUrl)
}

// ---------------------------------------------------------------------------
// Solution-style project references
// ---------------------------------------------------------------------------

function resolveReferencedTsconfigPath(refPath: string, fromDir: string, configName = 'tsconfig.json') {
  const p = refPath.endsWith('.json') ? refPath : path.join(refPath, configName)
  return path.resolve(fromDir, p)
}

export interface TsconfigProject {
  tsconfig: TsConfigJsonResolved
  tsconfigFile: string
}

const MAX_REFERENCED_TSCONFIGS = 256

/** Roots already warned about reaching the cap: the config bundle and the sources each read one. */
const warnedAtCap = new Set<string>()

/** A tsconfig and the projects it references, read through one `get-tsconfig` cache. */
export interface TsconfigGraph {
  root: TsconfigProject
  /**
   * The first project the root references — references of references included, breadth first —
   * that `predicate` holds for. Each is read when first reached and kept, so asking again walks
   * nothing twice, and a question answered early reads no further.
   */
  find(predicate: (project: TsconfigProject) => boolean): TsconfigProject | undefined
  /** Every project the root references that `predicate` holds for, in the same order: all are read. */
  filter(predicate: (project: TsconfigProject) => boolean): TsconfigProject[]
  /**
   * The project TypeScript compiles `file` in: the root, unless the root does not include it and
   * a referenced project does — every file, under a solution-style root, which compiles nothing.
   */
  projectIncluding(file: string): TsconfigProject | undefined
  /** Every tsconfig read so far, and every reference that does not exist, for a caller to watch. */
  files(): string[]
}

/**
 * Read `tsconfigFile`, and the projects it references as they are asked for. Throws when the root
 * does not parse.
 *
 * A reference that does not exist, or does not parse — an `extends` naming a package that is not
 * installed — is passed over: it is no reason to fail a build that does not need it. One that does
 * not exist is in `files`, so a caller watching them sees it appear.
 */
export async function readTsconfigGraph(tsconfigFile: string): Promise<TsconfigGraph> {
  const { parseTsconfig } = await import('get-tsconfig')
  const cache = new Map<string, string>()
  const root = { tsconfig: parseTsconfig(tsconfigFile, cache), tsconfigFile }
  const projects: TsconfigProject[] = []
  const missing = new Set<string>()
  const visited = new Set([path.resolve(tsconfigFile)])
  // Every reference in the order it is reached, read up to `next`.
  const pending: string[] = []
  let next = 0

  const reach = (project: TsconfigProject) => {
    for (const reference of project.tsconfig.references ?? []) {
      pending.push(resolveReferencedTsconfigPath(reference.path, path.dirname(project.tsconfigFile)))
    }
  }
  /** Read one more project; whether there was one. */
  const readNext = () => {
    while (next < pending.length) {
      const file = pending[next++]!
      if (visited.has(file)) continue
      if (visited.size === MAX_REFERENCED_TSCONFIGS) {
        if (!warnedAtCap.has(tsconfigFile)) {
          warnedAtCap.add(tsconfigFile)
          logger.warn(
            'tsconfig',
            `${tsconfigFile} reaches more than ${MAX_REFERENCED_TSCONFIGS} tsconfigs; the rest are not read`,
          )
        }
        next = pending.length
        return false
      }
      visited.add(file)
      if (!existsSync(file)) {
        missing.add(file)
        continue
      }
      let tsconfig: TsConfigJsonResolved
      try {
        tsconfig = parseTsconfig(file, cache)
      } catch {
        continue
      }
      const project = { tsconfig, tsconfigFile: file }
      projects.push(project)
      reach(project)
      return true
    }
    return false
  }
  reach(root)

  const find = (predicate: (project: TsconfigProject) => boolean) => {
    for (let index = 0; index < projects.length || readNext(); index++) {
      if (predicate(projects[index]!)) return projects[index]
    }
    return undefined
  }

  return {
    root,
    find,
    filter(predicate) {
      while (readNext());
      return projects.filter(predicate)
    },
    projectIncluding(file) {
      if (isSourceFileIncludedInTsconfig(file, root.tsconfigFile, root.tsconfig)) return root
      return find(({ tsconfig, tsconfigFile }) => isSourceFileIncludedInTsconfig(file, tsconfigFile, tsconfig))
    },
    files: () => [...readTsconfigPaths(cache), ...missing],
  }
}

/** Whether a project says where a bare import resolves: `paths`, or a `baseUrl`. */
export const declaresAliases = ({ tsconfig }: TsconfigProject) =>
  tsconfig.compilerOptions?.paths != null || tsconfig.compilerOptions?.baseUrl != null

/** Whether a project maps specifiers it names, by `paths` — a `baseUrl` alone maps every one. */
const declaresPaths = ({ tsconfig }: TsconfigProject) => tsconfig.compilerOptions?.paths != null

const isWithin = (file: string, directory: string) => file === directory || file.startsWith(directory + path.sep)

/**
 * A glob's path up to its first segment holding a wildcard, and whether it has one. Which
 * characters are wildcards is the glob syntax's: a tsconfig `include` has `*` and `?`.
 */
export function globBase(pattern: string, wildcard = /[*?]/): { base: string; wildcard: boolean } {
  const segments = pattern.split('/')
  const end = segments.findIndex((segment) => wildcard.test(segment))
  return end === -1 ? { base: pattern, wildcard: false } : { base: segments.slice(0, end).join('/'), wildcard: true }
}

/** Where a pattern points, read up to its first wildcard; whether it reaches below that. */
const patternEntry = (base: string, pattern: string) => {
  const { base: prefix, wildcard } = globBase(pattern)
  // No wildcard: a file, or — with no extension — a directory and everything in it.
  return { entry: path.resolve(base, prefix), reaches: wildcard || !path.extname(pattern) }
}

/**
 * Whether a project includes files under `directory` — through a `files` entry or an `include`
 * pattern there, or a pattern reaching into it from above that `exclude` does not take back. A
 * pattern is read up to its first wildcard, so `src/*.ts` reaches into `src/components` as well: a
 * guess at which project holds a set of files, which is all a caller with a glob can ask.
 */
export function includesUnder(directory: string, { tsconfig, tsconfigFile }: TsconfigProject): boolean {
  const base = path.dirname(tsconfigFile)
  const excluded = (tsconfig.exclude ?? []).some((pattern) => {
    const { entry, reaches } = patternEntry(base, pattern)
    return reaches && isWithin(directory, entry)
  })
  if (excluded) return false
  const entries = [
    ...(tsconfig.files ?? []).map((file) => ({ entry: path.resolve(base, file), reaches: false })),
    ...(tsconfig.include ?? (tsconfig.files ? [] : [GLOB_ALL_PATTERN])).map((pattern) => patternEntry(base, pattern)),
  ]
  return entries.some(({ entry, reaches }) => isWithin(entry, directory) || (reaches && isWithin(directory, entry)))
}

/**
 * Whether a root is solution-style: it compiles nothing itself and only references the projects
 * that do. That takes `files` or `include` written out empty — with neither, TypeScript includes
 * everything — and `get-tsconfig` keeps only one of the two when both are.
 */
export function isSolutionTsconfig(parsed: TsConfigJsonResolved): boolean {
  const { files, include } = parsed
  return (
    Boolean(parsed.references?.length) &&
    !files?.length &&
    !include?.length &&
    (Array.isArray(files) || Array.isArray(include))
  )
}

/**
 * The directory a tsconfig's `paths` resolve against: its `baseUrl`, or else the directory of the
 * tsconfig declaring them — which `get-tsconfig` records, since through `extends` that may be
 * another file in another directory. Falls back to `cwd`, as it always has, for neither.
 */
export function resolvePathsBase(tsconfig: TsConfigJsonResolved, tsconfigFile: string, cwd: string): string {
  const compilerOptions = tsconfig.compilerOptions
  if (compilerOptions?.baseUrl != null)
    return resolveBaseUrlForCompilerOptions(compilerOptions.baseUrl, tsconfigFile, cwd)
  const implicit =
    compilerOptions &&
    Object.getOwnPropertySymbols(compilerOptions).find((symbol) => symbol.description === 'implicitBaseUrl')
  const value = implicit && (compilerOptions as Record<symbol, unknown>)[implicit]
  return typeof value === 'string' ? value : cwd
}

/** Where the bare imports of a file esbuild reads under a solution-style root resolve. */
export interface SolutionAliases {
  /**
   * Where `specifier`, imported by `importer`, may be, the first existing one meant: through the
   * `paths` and `baseUrl` of the project including the importer, or for one in none, through the
   * `paths` of each project in turn whose patterns it matches. `undefined` when esbuild's own
   * reading of the importer stands.
   */
  candidates(specifier: string, importer: string): string[] | undefined
  /** Every tsconfig consulted, and every reference that does not exist, for the config to depend on. */
  files(): string[]
}

/**
 * How a config's alias imports resolve under a solution-style root.
 *
 * esbuild, bundling the config, reads each file under the first tsconfig found walking up from it,
 * which for a file beside a solution-style root — `"files": []` and `references`, as `create vite`
 * writes — is that root. It declares no `paths`: they are in the projects it references. So a
 * config importing through an alias failed to bundle. A file esbuild reads under the root resolves
 * here as TypeScript resolves it, through the project including it. The config beside the root is
 * in none, and resolves through the `paths` of whichever project's patterns it matches and reach a
 * file — not a `baseUrl` alone, which would put a directory of the project ahead of every package.
 * So does a file in a project that declares no aliases, where TypeScript would fail the import.
 * A root declaring aliases of its own keeps those for a file in no project: esbuild reads them.
 *
 * Only the aliases. The rest of that project's options are its own: its `verbatimModuleSyntax`
 * would keep a type-only import the config never had to write as one. And only for files read
 * under the root — a package the config imports goes on resolving through its own tsconfig, which
 * esbuild's `tsconfig` option would have replaced for every file in the bundle. `undefined` for any
 * other root: what esbuild finds is the config's.
 */
export async function resolveSolutionAliases(configFile: string, cwd: string): Promise<SolutionAliases | undefined> {
  const rootFile = await findClosestTsconfig(configFile, cwd)
  if (!rootFile) return undefined
  let graph: TsconfigGraph
  try {
    graph = await readTsconfigGraph(rootFile)
  } catch {
    // esbuild reports a root that does not parse, as it always has.
    return undefined
  }
  if (!isSolutionTsconfig(graph.root.tsconfig)) return undefined

  const { createPathsMatcher } = await import('get-tsconfig')
  const matchers = new Map<TsconfigProject, ((specifier: string) => string[]) | null>()
  const matcherFor = (project: TsconfigProject) => {
    if (!matchers.has(project)) {
      matchers.set(project, createPathsMatcher({ path: project.tsconfigFile, config: project.tsconfig }))
    }
    return matchers.get(project)
  }
  let lenders: TsconfigProject[] | undefined
  const owners = new Map<string, TsconfigProject | null>()
  const ownerOf = (file: string) => {
    let owner = owners.get(file)
    if (owner === undefined) owners.set(file, (owner = graph.projectIncluding(file) ?? null))
    return owner
  }
  /** Where a file in no project may find `specifier`: through `paths` whose patterns it matches. */
  const borrowed = (specifier: string) => {
    if (declaresAliases(graph.root)) return []
    lenders ??= graph.filter(declaresPaths)
    return lenders.flatMap((project) =>
      Object.keys(project.tsconfig.compilerOptions!.paths!).some((pattern) => matchesPattern(pattern, specifier))
        ? (matcherFor(project)?.(specifier) ?? [])
        : [],
    )
  }

  const rootDirectory = path.dirname(rootFile)
  // esbuild names an importer by its real path, and the projects were read where the config is.
  const directories = [rootDirectory, realpathSync.native(rootDirectory)]
  const ownTsconfig = new Map<string, boolean>()
  const hasOwnTsconfig = (directory: string) => {
    let found = ownTsconfig.get(directory)
    if (found === undefined) {
      found = ['tsconfig.json', 'jsconfig.json'].some((name) => existsSync(path.join(directory, name)))
      ownTsconfig.set(directory, found)
    }
    return found
  }
  /** Where `file` is beside the root, when the root is the tsconfig esbuild reads it under. */
  const underRoot = (file: string) => {
    for (const directory of directories) {
      const relative = path.relative(directory, file)
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
      const segments = relative.split(path.sep)
      if (segments.includes('node_modules')) return undefined
      // A tsconfig between the file and the root is the one esbuild reads the file under.
      for (let depth = segments.length - 1; depth > 0; depth--) {
        if (hasOwnTsconfig(path.join(rootDirectory, ...segments.slice(0, depth)))) return undefined
      }
      return path.join(rootDirectory, relative)
    }
    return undefined
  }

  return {
    candidates(specifier, importer) {
      const file = underRoot(importer)
      if (!file) return undefined
      const owner = ownerOf(file)
      if (!owner) return borrowed(specifier)
      // A project with aliases of its own resolves through those alone, as TypeScript does. One
      // with none — `tsconfig.node.json` as `create vite` writes it, which includes the config —
      // borrows another's, as a file in no project does: the config importing a theme through the
      // app's `@/*` failed to load, where TypeScript fails it under `tsc -b` too, and there is no
      // alias of the project's own for the borrowed one to stand in for.
      return declaresAliases(owner) ? (matcherFor(owner)?.(specifier) ?? []) : borrowed(specifier)
    },
    files: () => graph.files(),
  }
}

/** Whether `specifier` is one a `paths` pattern — `@/*`, or a name written out — maps. */
function matchesPattern(pattern: string, specifier: string) {
  const star = pattern.indexOf('*')
  if (star === -1) return pattern === specifier
  const prefix = pattern.slice(0, star)
  const suffix = pattern.slice(star + 1)
  return specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix)
}

/** The files a `get-tsconfig` cache has read, keyed as it keys them. */
function readTsconfigPaths(cache: Map<string, string>): string[] {
  const prefix = 'readFileSync:'
  const suffix = ':utf8'
  return Array.from(cache.keys())
    .filter((key) => key.startsWith(prefix) && key.endsWith(suffix))
    .map((key) => path.resolve(key.slice(prefix.length, -suffix.length)))
}

// ---------------------------------------------------------------------------
// Tsconfig include/exclude/files matching
//
// Ported from tsconfck's glob semantics because get-tsconfig's
// createFilesMatcher doesn't handle some valid patterns (e.g. `src/*`).
// ---------------------------------------------------------------------------

const POSIX_SEP_RE = new RegExp('\\' + path.posix.sep, 'g')
const NATIVE_SEP_RE = new RegExp('\\' + path.sep, 'g')
const PATTERN_REGEX_CACHE = new Map<string, RegExp>()
const GLOB_ALL_PATTERN = `**/*`
const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']
const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs']
const TSJS_EXTENSIONS = TS_EXTENSIONS.concat(JS_EXTENSIONS)
const TS_EXTENSIONS_RE_GROUP = `\\.(?:${TS_EXTENSIONS.map((ext) => ext.slice(1)).join('|')})`
const TSJS_EXTENSIONS_RE_GROUP = `\\.(?:${TSJS_EXTENSIONS.map((ext) => ext.slice(1)).join('|')})`
const IS_POSIX = path.posix.sep === path.sep

const native2posix = IS_POSIX
  ? (filename: string) => filename
  : (filename: string) => filename.replace(NATIVE_SEP_RE, path.posix.sep)

const resolve2posix = IS_POSIX
  ? (dir: string | null, filename: string) => (dir ? path.resolve(dir, filename) : path.resolve(filename))
  : (dir: string | null, filename: string) => {
      const posix2native = (f: string) => f.replace(POSIX_SEP_RE, path.sep)
      return native2posix(
        dir ? path.resolve(posix2native(dir), posix2native(filename)) : path.resolve(posix2native(filename)),
      )
    }

function isGlobMatch(filename: string, dir: string, patterns: string[], allowJs: boolean | undefined) {
  const extensions = allowJs ? TSJS_EXTENSIONS : TS_EXTENSIONS
  return patterns.some((patternArg) => {
    let pattern = patternArg
    let lastWildcardIndex = pattern.length
    let hasWildcard = false
    let hasExtension = false
    let hasSlash = false
    let lastSlashIndex = -1
    for (let i = pattern.length - 1; i > -1; i--) {
      const c = pattern[i]
      if (!hasWildcard) {
        if (c === '*' || c === '?') {
          lastWildcardIndex = i
          hasWildcard = true
        }
      }
      if (!hasSlash) {
        if (c === '.') {
          hasExtension = true
        } else if (c === '/') {
          lastSlashIndex = i
          hasSlash = true
        }
      }
      if (hasWildcard && hasSlash) {
        break
      }
    }
    if (!hasExtension && (!hasWildcard || lastWildcardIndex < lastSlashIndex)) {
      pattern += `${pattern.endsWith('/') ? '' : '/'}${GLOB_ALL_PATTERN}`
      lastWildcardIndex = pattern.length - 1
      hasWildcard = true
    }

    if (lastWildcardIndex < pattern.length - 1 && !filename.endsWith(pattern.slice(lastWildcardIndex + 1))) {
      return false
    }

    if (pattern.endsWith('*') && !extensions.some((ext) => filename.endsWith(ext))) {
      return false
    }

    if (pattern === GLOB_ALL_PATTERN) {
      return filename.startsWith(`${dir}/`)
    }

    const resolvedPattern = resolve2posix(dir, pattern)

    let firstWildcardIndex = -1
    for (let i = 0; i < resolvedPattern.length; i++) {
      if (resolvedPattern[i] === '*' || resolvedPattern[i] === '?') {
        firstWildcardIndex = i
        hasWildcard = true
        break
      }
    }
    if (firstWildcardIndex > 1 && !filename.startsWith(resolvedPattern.slice(0, firstWildcardIndex - 1))) {
      return false
    }

    if (!hasWildcard) {
      return filename === resolvedPattern
    }
    if (
      firstWildcardIndex + GLOB_ALL_PATTERN.length ===
        resolvedPattern.length - (pattern.length - 1 - lastWildcardIndex) &&
      resolvedPattern.slice(firstWildcardIndex, firstWildcardIndex + GLOB_ALL_PATTERN.length) === GLOB_ALL_PATTERN
    ) {
      return true
    }
    if (PATTERN_REGEX_CACHE.has(resolvedPattern)) {
      return PATTERN_REGEX_CACHE.get(resolvedPattern)!.test(filename)
    }
    const regex = pattern2regex(resolvedPattern, allowJs)
    PATTERN_REGEX_CACHE.set(resolvedPattern, regex)
    return regex.test(filename)
  })
}

function pattern2regex(resolvedPattern: string, allowJs: boolean | undefined) {
  let regexStr = '^'
  for (let i = 0; i < resolvedPattern.length; i++) {
    const char = resolvedPattern[i]
    if (char === '?') {
      regexStr += '[^\\/]'
      continue
    }
    if (char === '*') {
      if (resolvedPattern[i + 1] === '*' && resolvedPattern[i + 2] === '/') {
        i += 2
        regexStr += '(?:[^\\/]*\\/)*'
        continue
      }
      regexStr += '[^\\/]*'
      continue
    }
    if ('/.+^${}()|[]\\'.includes(char)) {
      regexStr += '\\'
    }
    regexStr += char
  }

  if (resolvedPattern.endsWith('*')) {
    regexStr += allowJs ? TSJS_EXTENSIONS_RE_GROUP : TS_EXTENSIONS_RE_GROUP
  }
  regexStr += '$'

  return new RegExp(regexStr)
}

function isIncluded(filename: string, tsconfigFile: string, tsconfig: TsConfigJsonResolved) {
  const dir = native2posix(path.dirname(tsconfigFile))
  const files = (tsconfig.files || []).map((file) => resolve2posix(dir, file))
  const absoluteFilename = resolve2posix(null, filename)
  if (files.includes(absoluteFilename)) {
    return true
  }
  const allowJs = tsconfig.compilerOptions?.allowJs
  const included = isGlobMatch(
    absoluteFilename,
    dir,
    tsconfig.include || (tsconfig.files ? [] : [GLOB_ALL_PATTERN]),
    allowJs,
  )
  if (included) {
    const excluded = isGlobMatch(absoluteFilename, dir, tsconfig.exclude || [], allowJs)
    return !excluded
  }
  return false
}

/** Whether `absoluteFilename` is part of the compilation set defined by this tsconfig. */
export function isSourceFileIncludedInTsconfig(
  absoluteFilename: string,
  tsconfigFile: string,
  tsconfig: TsConfigJsonResolved,
) {
  return isIncluded(absoluteFilename, tsconfigFile, tsconfig)
}
