import { createGeneratorContext } from '@bamboocss/fixture'
import { generateCxRuntime } from '@bamboocss/node'
import { type CvaLookup, cvaJoin, cvaMap, splitProps } from '@bamboocss/shared'
import type { Config } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { bamboocssCompiledRuntime, COMPILED_RUNTIME_ID, compiledRuntimeSource } from '../src/compiled-runtime'
import { RECIPE_JOIN_HELPER, RECIPE_MAP_HELPER, SPLIT_PROPS_HELPER } from '../src/fold-recipe'
import { compiledRuntime, compiledRuntimeFor, createFoldFixture, evaluateModule } from './fixture'

/** The helpers a fold can write a call to, which are no authoring API. */
const HELPERS = [RECIPE_MAP_HELPER, RECIPE_JOIN_HELPER, SPLIT_PROPS_HELPER]

/** Everything compiled code reaches at runtime: those helpers, and `cx`. */
const SERVED = [...HELPERS, 'cx']

/** The authoring API the barrel exists to expose. */
const AUTHORING = ['css', 'cx', 'cva', 'sva', 'fallback', 'viewTransition']

const generated = (id: 'css-index' | 'cx', file: string, config?: Config) => {
  const [artifact] = createGeneratorContext(config).getArtifacts([id])
  const code = artifact?.files.find((entry) => entry.file === file)?.code
  if (!code) throw new Error(`no ${file} in the ${id} artifact`)
  return code
}

/**
 * Names a module exports, read from its `export { … }` lists, with or without `from`, and from
 * its exported declarations.
 *
 * Parsed rather than matched as substrings, and with comments left out, so a name appearing only
 * in prose does not count as an export.
 */
const exportedNames = (code: string) => {
  const source = code.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '')
  const names = new Set<string>()

  for (const [, clause = ''] of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const specifier of clause.split(',')) {
      // `a as b` is exported under `b`; a bare `a` under itself.
      const exported = specifier
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (exported) names.add(exported)
    }
  }
  const declaration = /export\s+(?:declare\s+)?(?:const|let|var|function|class|type|interface)\s+([\w$]+)/g
  for (const [, name] of source.matchAll(declaration)) if (name) names.add(name)

  return names
}

describe('virtual:bamboo/compiled', () => {
  /**
   * Nothing else pins this short of a build. Folded code is rewritten in memory during the
   * bundler's transform and never typechecked, so a helper the fold calls that this module does
   * not export fails every build compiling such a call, on an import the module lacks.
   *
   * Nothing else, either: every export is shipped to every page that runs compiled code.
   */
  test('exports everything compiled code can call, and nothing else', () => {
    expect([...exportedNames(compiledRuntimeSource(generateCxRuntime('')))].sort()).toEqual([...SERVED].sort())
  })

  /**
   * The text is `@bamboocss/shared`'s `src/compiled.ts` as last built, which that package's
   * postbuild copies here. A copy left behind by a change to the source answers differently from
   * it; CI's check that a build changes nothing finds that too, but only there.
   */
  test('behaves as its source does', () => {
    const table: CvaLookup = [
      1,
      [
        [1, ~0, ~1, ['sm', ~2]],
        [0, ~3, 0, ['quiet', ~4]],
      ],
      ['miss-size', 'default-size', 'small', 'miss-tone', 'quiet-tone'],
    ]
    const segments: CvaLookup = ['d_flex', [0, [[0, ~0, ~0, ['quiet', ~1]]], ['', 'c_gray']], 'm_1']
    const slots: Record<string, CvaLookup> = {
      root: 'd_flex',
      label: [0, [[0, ~0, ~0, ['quiet', ~1]]], ['', 'c_gray']],
    }
    const selections = [
      ['quiet', 'sm'],
      [undefined, 'sm'],
      [undefined, undefined],
      [null, 'unknown'],
    ]
    for (const values of selections) {
      for (const lookup of [table, segments, slots]) {
        expect(compiledRuntime.cvaMap(values, lookup)).toEqual(cvaMap(values, lookup))
      }
      expect(compiledRuntime.cvaJoin(values, segments)).toBe(cvaJoin(values, segments as never))
    }

    // An accessor stays one, which reading it eagerly would undo.
    const props = Object.defineProperty({ size: 'sm', id: 'field' }, 'label', {
      enumerable: true,
      get: () => 'read',
    })
    const [picked, rest] = compiledRuntime.splitProps(props, ['size'])
    expect([picked, rest]).toEqual(splitProps(props, ['size']))
    expect(Object.getOwnPropertyDescriptor(rest, 'label')?.get).toBeTypeOf('function')
  })

  /**
   * The `cx` served is the one the generator writes into a `styled-system`, for the project's own
   * config: whatever `styled-system` a compiled module imported `cx` from, it merges the classes
   * this build names as the project's own `cx` would.
   */
  test("merges a project's classes as that project's own styled-system cx does", () => {
    const configs: Config[] = [{}, { prefix: 'pfx' }, { hash: true }, { hash: true, prefix: 'pfx' }]
    for (const config of configs) {
      const label = JSON.stringify(config)
      const { red, blue, prefix } = classesOf(config)
      const own = evaluateModule<{ cx: (...args: unknown[]) => string }>(generated('cx', 'cx.mjs', config)).cx
      const { cx } = compiledRuntimeFor(prefix)

      const samples = [
        [red, blue],
        [blue, red],
        [red, 'external'],
        ['external', red, blue],
        [red, null, false, [blue]],
      ]
      for (const args of samples) expect(cx(...args), label).toBe(own(...args))
      // The later color wins, and the earlier one is gone.
      expect(cx(red, blue).split(' '), label).not.toContain(red)
    }
  })

  /**
   * Why the `cx` has to be the project's: one generated for another prefix, as a workspace design
   * system's own `styled-system` can be, reads none of this build's classes as atoms, and keeps the
   * class an override was to replace.
   */
  test('a cx generated for another prefix merges none of them', () => {
    const { red, blue } = classesOf({ prefix: 'pfx' })
    expect(compiledRuntimeFor('').cx(red, blue)).toBe(`${red} ${blue}`)
    expect(compiledRuntimeFor('ds').cx(red, blue)).toBe(`${red} ${blue}`)
    expect(compiledRuntimeFor('pfx').cx(red, blue).split(' ')).not.toContain(red)
  })

  test("is what the plugin resolves and loads the id to, with the project's cx", async () => {
    const plugin = bamboocssCompiledRuntime(async () => generateCxRuntime('pfx'))
    const resolveId = plugin.resolveId as (id: string) => string | null
    const load = plugin.load as (id: string) => Promise<string | null>
    const served = compiledRuntimeSource(generateCxRuntime('pfx'))

    const resolved = resolveId(COMPILED_RUNTIME_ID)
    expect(resolved).toBe(`\0${COMPILED_RUNTIME_ID}`)
    expect(resolveId(resolved!)).toBe(resolved)
    expect(await load(resolved!)).toBe(served)
    expect(await load(`${resolved}?t=1`)).toBe(served)
    expect(served).toContain('"pfx-"')

    expect(resolveId('virtual:bamboo.css')).toBeNull()
    expect(await load('\0virtual:bamboo.css')).toBeNull()
  })
})

/** Two colors the build names for `config`, the second with a padding of its own, and its class prefix. */
const classesOf = (config: Config) => {
  const { ctx, foldStrict } = createFoldFixture(config)
  const result = foldStrict(
    `import { css } from 'styled-system/css'\n` +
      `export const red = css({ color: 'red.500' })\n` +
      `export const blue = css({ color: 'blue.500', padding: '4' })\n`,
  )
  const [red, blue] = result.folded.map((call) => call.className)
  if (!red || !blue || red.includes(' ')) throw new Error(`unexpected classes: ${red} / ${blue}`)
  return { red, blue, prefix: ctx.utility.prefix }
}

describe('the generated styled-system', () => {
  /**
   * Compiled code imports none of these from a `styled-system`, which can be another release's,
   * so the generated runtime exports none: one it did is one compiled code could be pointed at
   * again, and they are not authoring API. `cx` is, so it stays, and compiled code reaches the
   * plugin's instead.
   */
  test('exports none of the helpers compiled code calls', () => {
    const modules = [
      ['css-index', 'index.mjs'],
      ['css-index', 'index.d.ts'],
      ['cx', 'cx.mjs'],
      ['cx', 'cx.d.ts'],
    ] as const
    for (const [id, file] of modules) {
      const exported = exportedNames(generated(id, file))
      for (const helper of HELPERS) expect(exported, `${file} exports ${helper}`).not.toContain(helper)
    }
  })

  test('exports the authoring API from the css barrel', () => {
    for (const file of ['index.mjs', 'index.d.ts']) {
      const exported = exportedNames(generated('css-index', file))
      for (const name of AUTHORING) expect(exported, `${file} exports ${name}`).toContain(name)
    }
  })
})
