import type { ConfigTsOptions } from '@bamboocss/types'
import findUp from 'escalade/sync'
import fs from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import { resolveTsPathPattern } from './resolve-ts-path-pattern'
import { type PathMapping } from './ts-config-paths'

const jsExtensions = ['.js', '.cjs', '.mjs']

const jsResolutionOrder = ['', '.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.jsx', '.tsx']
const tsResolutionOrder = ['', '.ts', '.cts', '.mts', '.tsx', '.js', '.cjs', '.mjs', '.jsx']

function resolveWithExtension(file: string, extensions: string[]) {
  // Try to find `./a.ts`, `./a.ts`, ... from `./a`
  for (const ext of extensions) {
    const full = `${file}${ext}`
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return full
    }
  }

  // Try to find `./a/index.js` from `./a`
  for (const ext of extensions) {
    const full = `${file}/index${ext}`
    if (fs.existsSync(full)) {
      return full
    }
  }

  return null
}

export interface GetDepsOptions {
  filename: string
  ext: string
  cwd: string
  seen: Set<string>
  baseUrl: string | undefined
  pathMappings: PathMapping[]
  foundModuleAliases: Map<string, string>
}

const importRegex = /import[\s\S]*?['"](.{3,}?)['"]/gi
const importFromRegex = /import[\s\S]*from[\s\S]*?['"](.{3,}?)['"]/gi
const requireRegex = /require\(['"`](.+)['"`]\)/gi
const exportRegex = /export[\s\S]*from[\s\S]*?['"](.{3,}?)['"]/gi

type ImportKind = 'import' | 'require'

/**
 * The conditions a package's `exports` and `imports` are read with: esbuild's on `platform: 'node'`,
 * which is what bundles the config (`bundleConfig`). `types` is not one of them, nor `source`.
 */
const conditions: Record<ImportKind, ReadonlySet<string>> = {
  import: new Set(['default', 'import', 'module', 'node']),
  require: new Set(['default', 'module', 'node', 'require']),
}

/**
 * Whether a file a package import loads is followed: TypeScript source, which is what a workspace
 * package holds when its `main` or `exports` name `src/index.ts` rather than a build. Anything else,
 * a build or a package as it was installed, is declared by the bundle's own inputs once the config
 * has loaded.
 */
const isTypeScriptSource = (file: string) => /\.[cm]?ts$/.test(file) && !/\.d\.(?:[^./\\]+\.)?[cm]?ts$/.test(file)

interface Manifest {
  exports?: unknown
  imports?: unknown
  main?: unknown
  module?: unknown
}

function readManifest(file: string): Manifest | undefined {
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return manifest !== null && typeof manifest === 'object' ? manifest : undefined
  } catch {
    return undefined
  }
}

const resolveFile = (file: string) => resolveWithExtension(file, tsResolutionOrder) ?? undefined

function realpathOf(file: string) {
  try {
    return fs.realpathSync.native(file)
  } catch {
    return file
  }
}

/**
 * The target an `exports` or `imports` map gives `key`, read as Node reads one: the key itself, or
 * else the pattern with the longest prefix that matches it, then its conditions in the order the map
 * writes them. `null` is a key the package declines to export, which stops the search.
 */
function matchSubpath(map: unknown, key: string, active: ReadonlySet<string>) {
  // A string, an array or an object of conditions alone is the `.` export.
  const entries: Record<string, unknown> =
    map !== null &&
    typeof map === 'object' &&
    !Array.isArray(map) &&
    Object.keys(map).some((name) => name[0] === '.' || name[0] === '#')
      ? (map as Record<string, unknown>)
      : { '.': map }

  if (Object.hasOwn(entries, key) && !key.includes('*')) return resolveTarget(entries[key], undefined, active)

  let best: string | undefined
  for (const pattern of Object.keys(entries)) {
    const star = pattern.indexOf('*')
    if (star === -1 || star !== pattern.lastIndexOf('*') || key.length < pattern.length) continue
    if (!key.startsWith(pattern.slice(0, star)) || !key.endsWith(pattern.slice(star + 1))) continue
    const bestStar = best?.indexOf('*') ?? -1
    if (!best || star > bestStar || (star === bestStar && pattern.length > best.length)) best = pattern
  }
  if (!best) return undefined

  const star = best.indexOf('*')
  return resolveTarget(entries[best], key.slice(star, key.length - (best.length - star - 1)), active)
}

function resolveTarget(
  target: unknown,
  match: string | undefined,
  active: ReadonlySet<string>,
): string | null | undefined {
  if (typeof target === 'string') return match === undefined ? target : target.replaceAll('*', match)
  if (target === null) return null
  if (typeof target !== 'object') return undefined

  if (Array.isArray(target)) {
    for (const fallback of target) {
      const resolved = resolveTarget(fallback, match, active)
      if (resolved !== undefined) return resolved
    }
    return undefined
  }

  for (const [condition, value] of Object.entries(target)) {
    if (!active.has(condition)) continue
    const resolved = resolveTarget(value, match, active)
    if (resolved !== undefined) return resolved
  }
  return undefined
}

/** `@scope/name/sub` is the package `@scope/name` and its subpath `./sub`; `name` alone is `.`. */
function splitSpecifier(specifier: string): [name: string, subpath: string] {
  const parts = specifier.split('/')
  const length = specifier[0] === '@' ? 2 : 1
  const rest = parts.slice(length).join('/')
  return [parts.slice(0, length).join('/'), rest ? `./${rest}` : '.']
}

/**
 * The file a bare import loads, found as the config bundler finds it: the package in the nearest
 * `node_modules` holding one by that name, and in it what `exports` gives the subpath, or `module`,
 * `main` or `index` where there are no `exports`. A `#` import is read off the `imports` of the
 * package the importer is in. The path is the real one: a workspace package is linked into
 * `node_modules`, which Vite's watcher ignores, and its own imports resolve from where it is.
 *
 * Resolved here rather than by the TypeScript compiler, which this used to ask. Loading it was a
 * third of a small app's `vite dev` start, to resolve `@bamboocss/dev`, the one bare import nearly
 * every config has, and it answered another question: where an import's types are, a declaration
 * file for almost every package, when the scan wants the file the config runs.
 */
function resolveBareImport(specifier: string, importer: string, kind: ImportKind): string | undefined {
  if (isBuiltin(specifier)) return undefined
  const active = conditions[kind]

  if (specifier[0] === '#') {
    const manifestFile = findUp(
      path.dirname(importer),
      (_dir, names) => names.includes('package.json') && 'package.json',
    )
    if (!manifestFile) return undefined
    const imports = readManifest(manifestFile)?.imports
    const target = imports == null ? undefined : matchSubpath(imports, specifier, active)
    if (typeof target !== 'string' || target[0] === '#') return undefined
    if (!target.startsWith('./')) return resolveBareImport(target, manifestFile, kind)
    const found = resolveFile(path.join(path.dirname(manifestFile), target))
    return found && realpathOf(found)
  }

  const [name, subpath] = splitSpecifier(specifier)
  if (!name || name[0] === '.' || name.includes('\\')) return undefined
  for (let dir = path.dirname(importer); ; ) {
    if (path.basename(dir) !== 'node_modules') {
      const root = path.join(dir, 'node_modules', name)
      const manifest = readManifest(path.join(root, 'package.json'))
      if (manifest) {
        const found = resolvePackageEntry(root, manifest, subpath, active)
        return found && realpathOf(found)
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function resolvePackageEntry(root: string, manifest: Manifest, subpath: string, active: ReadonlySet<string>) {
  if (manifest.exports != null) {
    const target = matchSubpath(manifest.exports, subpath, active)
    return typeof target === 'string' && target.startsWith('./') ? resolveFile(path.join(root, target)) : undefined
  }
  if (subpath !== '.') return resolveFile(path.join(root, subpath))
  for (const entry of [manifest.module, manifest.main]) {
    const found = typeof entry === 'string' ? resolveFile(path.join(root, entry)) : undefined
    if (found) return found
  }
  return resolveFile(path.join(root, 'index'))
}

/** Whether the file was found, scanned now or before, so a bare import can try the next way to resolve it. */
function getDeps(opts: GetDepsOptions, fromAlias?: string): boolean {
  const { filename, seen } = opts

  // Try to find the file
  const absoluteFile = resolveWithExtension(
    path.resolve(opts.cwd, filename),
    jsExtensions.includes(opts.ext) ? jsResolutionOrder : tsResolutionOrder,
  )
  if (absoluteFile === null) return false // File doesn't exist

  if (fromAlias) {
    opts.foundModuleAliases.set(fromAlias, absoluteFile)
  }

  // Prevent infinite loops when there are circular dependencies
  if (seen.size > 1 && seen.has(absoluteFile)) return true // Already seen
  seen.add(absoluteFile)

  const contents = fs.readFileSync(absoluteFile, 'utf-8')
  const fileDeps = [
    ...contents.matchAll(importRegex),
    ...contents.matchAll(importFromRegex),
    ...contents.matchAll(requireRegex),
    ...contents.matchAll(exportRegex),
  ]
  if (!fileDeps.length) return true // No deps

  const nextOpts: Omit<GetDepsOptions, 'filename'> = {
    // Resolve new base for new imports/requires
    cwd: path.dirname(absoluteFile),
    ext: path.extname(absoluteFile),
    seen,
    baseUrl: opts.baseUrl,
    pathMappings: opts.pathMappings,
    foundModuleAliases: opts.foundModuleAliases,
  }

  fileDeps.forEach((match) => {
    const mod = match[1]

    if (mod[0] === '.' || path.isAbsolute(mod)) {
      getDeps(Object.assign({}, nextOpts, { filename: mod }))
      return
    }

    try {
      // The tsconfig's `paths`, then its `baseUrl`, before `node_modules`, as TypeScript and esbuild
      // read a bare import: `import { css } from "styled-system/css"` with `baseUrl: "./src"`.
      const aliased = resolveTsPathPattern(opts.pathMappings, mod)
      if (aliased && getDeps(Object.assign({}, nextOpts, { filename: aliased }), mod)) return
      if (opts.baseUrl && getDeps(Object.assign({}, nextOpts, { filename: path.resolve(opts.baseUrl, mod) }))) return

      // An internal monorepo package with no `dist`, whose `main` or `exports` name a `src/xxx.ts` file.
      const kind = /^require/i.test(match[0]) ? 'require' : 'import'
      const found = resolveBareImport(mod, absoluteFile, kind)
      if (found && isTypeScriptSource(found)) getDeps(Object.assign({}, nextOpts, { filename: found }))
    } catch {
      //
    }
  })

  return true
}

export function getConfigDependencies(
  filePath: string,
  tsOptions: ConfigTsOptions = { pathMappings: [] },
  compilerOptions?: { baseUrl?: string | undefined },
) {
  if (filePath === null) return { deps: new Set<string>(), aliases: new Map<string, string>() }

  const foundModuleAliases = new Map<string, string>()
  const deps = new Set<string>()

  // Add the file itself as a dependency
  deps.add(filePath)

  getDeps({
    filename: filePath,
    ext: path.extname(filePath),
    cwd: path.dirname(filePath),
    seen: deps,
    // Set on its own, `baseUrl` reaches only the compiler options: `tsOptions` exist for `paths`.
    baseUrl: compilerOptions?.baseUrl ?? tsOptions.baseUrl,
    pathMappings: tsOptions.pathMappings ?? [],
    foundModuleAliases: foundModuleAliases,
  })

  return { deps, aliases: foundModuleAliases }
}
