import { createGeneratorContext, fixtureDefaults } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { Generator } from '../src'
import { generatePackageExports } from '../src/artifacts/js/package-json'
import { generatePackageJson } from '../src/artifacts/js/package-json'

const exportsFor = (config?: Parameters<typeof createGeneratorContext>[0], base?: string) =>
  generatePackageExports(createGeneratorContext(config), base)

describe('generated package exports', () => {
  /**
   * The reason the map exists. `node16`/`nodenext` do no directory-index lookup, so without
   * it `styled-system/tokens` does not resolve and the artifact has to be spelled
   * `styled-system/tokens/index.mjs` — a workaround `token-references.ts` still recognises
   * because people write it.
   */
  test('declares the bare entry points, so nodenext resolves them', () => {
    const map = exportsFor()

    expect(map['./css']).toEqual({ types: './css/index.d.ts', default: './css/index.mjs' })
    expect(map['./tokens']).toEqual({ types: './tokens/index.d.ts', default: './tokens/index.mjs' })
  })

  /** Kept working, so a map that makes the workaround unnecessary does not make it an error. */
  test('keeps the explicit index spelling resolvable', () => {
    const map = exportsFor()

    expect(map['./tokens/index.mjs']).toEqual(map['./tokens'])
    expect(map['./css/index.mjs']).toEqual(map['./css'])
  })

  /** Nothing to run in there, and saying otherwise would resolve a value import to a `.d.ts`. */
  test('exposes ./types for declarations only', () => {
    expect(exportsFor()['./types']).toEqual({ types: './types/index.d.ts' })
  })

  test('offers the stylesheet, the split layers and the specs', () => {
    const map = exportsFor()

    expect(map['./styles.css']).toBe('./styles.css')
    expect(map['./styles/*']).toBe('./styles/*')
    expect(map['./specs/*']).toBe('./specs/*')
    expect(map['./package.json']).toBe('./package.json')
  })

  /**
   * The point of the map: these are imported by the modules beside them, never by an app. A
   * relative import inside the package is unaffected either way; an external one now fails.
   */
  test('offers no path to the internal modules', () => {
    const keys = Object.keys(exportsFor())

    for (const internal of ['./css/merge-css', './css/utilities', './css/conditions', './tokens/tokens', './helpers']) {
      expect(keys).not.toContain(internal)
    }
  })

  test('omits an entry for an artifact that is not emitted', () => {
    // `presets: []` is the fixture's bare context, which keeps no defaults at all — including
    // `outdir`, which the context requires.
    const map = exportsFor({ presets: [], outdir: 'styled-system' } as never)

    expect(map['./recipes']).toBeUndefined()
    expect(map['./themes']).toBeUndefined()
    expect(map['./css']).toBeDefined()
  })

  /** The default fixture declares recipes, so the conditional entry is exercised both ways. */
  test('declares ./recipes when the theme has some', () => {
    expect(exportsFor()['./recipes']).toEqual({ types: './recipes/index.d.ts', default: './recipes/index.mjs' })
  })

  test('declares ./themes once a theme has variants', () => {
    const map = exportsFor({
      theme: { variants: { dark: { tokens: { colors: { bg: { value: 'black' } } } } } },
    } as never)

    expect(map['./themes']).toEqual({ types: './themes/index.d.ts', default: './themes/index.mjs' })
  })

  /** `emit-pkg` reuses this with the package's `base` prefix, which is why it takes one. */
  test('prefixes every target with base when given one', () => {
    const map = exportsFor(undefined, 'dist')

    expect(map['./css']).toEqual({ types: './dist/css/index.d.ts', default: './dist/css/index.mjs' })
    expect(map['./styles.css']).toBe('./dist/styles.css')
  })

  /** `forceConsistentTypeExtension` moves the declaration extension; the map has to follow. */
  test('tracks the declaration extension', () => {
    const map = exportsFor({ forceConsistentTypeExtension: true } as never)

    expect(map['./css']).toEqual({ types: './css/index.d.mts', default: './css/index.mjs' })
  })

  test('is written into the emitted package.json', () => {
    const pkg = JSON.parse(generatePackageJson(createGeneratorContext()).json)

    expect(pkg.exports['./css']).toBeDefined()
    expect(pkg.private).toBe(true)
  })
})

/**
 * Under `forceConsistentTypeExtension`, a declaration file is `.d.mts` and every relative import
 * in it has to name its extension, which `moduleResolution: nodenext` requires of an ES module.
 * `css/merge-css.d.mts` spelled its import of `../types/index` by hand, without one, and failed
 * type-checking with TS2834 there while every other artifact took it from `ctx.file.importType`.
 */
test('every relative import of a declaration file names its extension under forceConsistentTypeExtension', () => {
  const artifacts =
    new Generator({
      ...fixtureDefaults,
      config: { ...fixtureDefaults.config, forceConsistentTypeExtension: true, outExtension: 'mjs' },
    }).getArtifacts() ?? []
  const declarations = artifacts.flatMap((artifact) =>
    (artifact?.files ?? [])
      .filter((file) => file.file.endsWith('.d.mts') && file.code)
      .map((file) => ({ path: [...(artifact!.dir ?? []), file.file].join('/'), code: file.code! })),
  )

  const bare = declarations.flatMap(({ path, code }) =>
    [...code.matchAll(/from\s*'(\.{1,2}\/[^']*)'/g)]
      .map((match) => match[1]!)
      .filter((specifier) => !/\.(mjs|js|json|css)$/.test(specifier))
      .map((specifier) => `${path} imports ${specifier}`),
  )

  expect(bare).toEqual([])
  expect(declarations.some(({ path }) => path.endsWith('merge-css.d.mts'))).toBe(true)
})
