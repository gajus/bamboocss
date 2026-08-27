import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ts } from 'ts-morph'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createResolver } from '../src/resolve'

/**
 * Module resolution, against the implementation it replaces.
 *
 * TypeScript 7 resolves internally and exposes neither the graph nor the probes, so this became
 * bamboo's problem. The probes are the part worth testing: `failedLookups` decides whether an
 * unresolved specifier is *local*, and therefore whether a file written later can satisfy it. A
 * resolver that returns the right path and the wrong probe list passes every obvious test and
 * breaks the dev server months later, on the one edit nobody reproduces.
 *
 * So each case asserts against what `ts.resolveModuleName` does with the same input.
 */
let root: string
let resolve: ReturnType<typeof createResolver>

const write = (relative: string, contents = 'export const x = 1\n') => {
  const target = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
  return target
}

const viaTypeScript = (specifier: string, importer: string, options: ts.CompilerOptions = {}) => {
  const result = ts.resolveModuleName(specifier, importer, { ...options }, ts.sys)
  return {
    path: result.resolvedModule?.resolvedFileName,
    failedLookups: ((result as unknown as { failedLookupLocations?: string[] }).failedLookupLocations ?? []).map((p) =>
      p.replaceAll('\\', '/'),
    ),
  }
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bamboo-resolve-'))
  write('src/app.ts')
  write('src/styles.ts')
  write('src/nested/index.ts')
  write('src/tokens/index.ts')
  write('packages/design/src/index.ts')
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  resolve = createResolver({ cwd: root })
})

afterAll(() => rmSync(root, { force: true, recursive: true }))

describe('relative specifiers', () => {
  test('resolves a sibling module to the same file TypeScript does', () => {
    const importer = path.join(root, 'src/app.ts')

    expect(resolve('./styles', { importer }).path).toBe(viaTypeScript('./styles', importer).path)
    expect(resolve('./styles', { importer }).path).toBe(path.join(root, 'src/styles.ts'))
  })

  test('resolves a directory through its index, as TypeScript does', () => {
    const importer = path.join(root, 'src/app.ts')

    expect(resolve('./nested', { importer }).path).toBe(viaTypeScript('./nested', importer).path)
  })

  test('resolves upward through a parent segment', () => {
    const importer = path.join(root, 'src/nested/index.ts')

    expect(resolve('../styles', { importer }).path).toBe(viaTypeScript('../styles', importer).path)
  })

  /**
   * The case the probes exist for. Nothing resolves, but every candidate reported is a path that
   * *would* resolve if written — which is what marks the specifier local and makes the dev
   * server rebuild when the file appears.
   */
  test('reports concrete candidates for a specifier that resolves to nothing', () => {
    const importer = path.join(root, 'src/app.ts')
    const result = resolve('./not-yet', { importer })

    expect(result.path).toBeUndefined()
    expect(result.failedLookups).toContain(path.join(root, 'src/not-yet.ts'))
    expect(result.failedLookups).toContain(path.join(root, 'src/not-yet.tsx'))
    expect(result.failedLookups).toContain(path.join(root, 'src/not-yet/index.ts'))
  })

  test('offers `.ts` before `.js`, so an import never lands on a build artifact', () => {
    const importer = path.join(root, 'src/app.ts')
    const { failedLookups } = resolve('./absent', { importer })

    expect(failedLookups.indexOf(path.join(root, 'src/absent.ts'))).toBeLessThan(
      failedLookups.indexOf(path.join(root, 'src/absent.js')),
    )
  })
})

describe('tsconfig paths and baseUrl', () => {
  test('resolves a mapped specifier the way TypeScript does', () => {
    const importer = path.join(root, 'src/app.ts')
    const options = { baseUrl: root, paths: { '@design/*': ['packages/design/src/*'] } }

    const mine = resolve('@design/index', { importer, baseUrl: root, paths: options.paths })
    const theirs = viaTypeScript('@design/index', importer, options as ts.CompilerOptions)

    expect(mine.path).toBe(theirs.path)
    expect(mine.path).toBe(path.join(root, 'packages/design/src/index.ts'))
  })

  /**
   * A mapped specifier that misses is the strongest form of "local": the substitution names a
   * path inside the checkout, so writing that file completes the import.
   */
  test('a mapped specifier that misses still reports its substitution as a candidate', () => {
    const importer = path.join(root, 'src/app.ts')
    const result = resolve('@design/missing', {
      importer,
      baseUrl: root,
      paths: { '@design/*': ['packages/design/src/*'] },
    })

    expect(result.path).toBeUndefined()
    expect(result.failedLookups).toContain(path.join(root, 'packages/design/src/missing.ts'))
  })

  test('baseUrl alone resolves a rootless specifier', () => {
    const importer = path.join(root, 'src/app.ts')

    expect(resolve('src/styles', { importer, baseUrl: root }).path).toBe(path.join(root, 'src/styles.ts'))
  })
})

describe('bare specifiers', () => {
  test('a package that is not installed resolves to nothing rather than throwing', () => {
    const importer = path.join(root, 'src/app.ts')

    expect(resolve('not-a-real-package-xyz', { importer }).path).toBeUndefined()
  })

  test('a real package resolves, and names the package.json that decided it', () => {
    // `oxc-resolver` itself is installed next to this test, so it is a package that certainly
    // exists without the fixture having to vendor one.
    const importer = path.join(__dirname, 'resolve.test.ts')
    const result = createResolver({ cwd: __dirname })('oxc-resolver', { importer })

    expect(result.path).toBeDefined()
    expect(result.affectingFiles.some((file) => file.endsWith('package.json'))).toBe(true)
  })
})

/**
 * Counted rather than timed, for the reason `shared/__tests__/memo.test.ts` counts
 * serializations: a wall-clock threshold fails on a busy machine instead of on a regression.
 * On a 400-file build this took the resolver's `stat` probes from 4,920 to 312.
 */
describe('repeat resolution', () => {
  test('an answer already given is not re-derived', () => {
    let probes = 0
    const resolveCounted = createResolver({
      cwd: root,
      // Consulted only for paths with nothing on disk under that name, which is what a
      // synthesized module is -- so every probe for it lands here and can be counted.
      fs: { fileExists: (filePath) => (probes++, filePath === path.join(root, 'src/virtual.ts')) },
    })
    const importer = path.join(root, 'src/app.ts')

    const first = resolveCounted('./virtual', { importer })
    expect(first.path).toBe(path.join(root, 'src/virtual.ts'))
    const afterFirst = probes
    expect(afterFirst).toBeGreaterThan(0)

    expect(resolveCounted('./virtual', { importer }).path).toBe(first.path)
    expect(probes).toBe(afterFirst)
  })

  test('a sibling in the same directory shares the answer, a different directory does not', () => {
    let probes = 0
    const resolveCounted = createResolver({
      cwd: root,
      fs: { fileExists: (filePath) => (probes++, filePath === path.join(root, 'src/virtual.ts')) },
    })

    resolveCounted('./virtual', { importer: path.join(root, 'src/app.ts') })
    const afterFirst = probes

    // Same directory, different importer: resolution reads only the directory.
    resolveCounted('./virtual', { importer: path.join(root, 'src/other.ts') })
    expect(probes).toBe(afterFirst)

    // A different directory is a different question, and is asked.
    resolveCounted('./virtual', { importer: path.join(root, 'src/nested/deep.ts') })
    expect(probes).toBeGreaterThan(afterFirst)
  })

  test('a change to paths or baseUrl is not served from the previous table', () => {
    const importer = path.join(root, 'src/app.ts')
    const resolveCounted = createResolver({ cwd: root })

    expect(resolveCounted('~/styles', { importer, baseUrl: root, paths: { '~/*': ['./src/*'] } }).path).toBe(
      path.join(root, 'src/styles.ts'),
    )
    // The same specifier under a table that maps it nowhere must miss, not repeat the hit.
    expect(resolveCounted('~/styles', { importer, baseUrl: root, paths: { '#/*': ['./src/*'] } }).path).toBeUndefined()
  })
})
