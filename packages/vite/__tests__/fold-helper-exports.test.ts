import { createGeneratorContext } from '@bamboocss/fixture'
import { type CvaLookup, cvaMap, splitProps } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'
import { bamboocssCompiledRuntime, COMPILED_RUNTIME_ID } from '../src/compiled-runtime'
import { RECIPE_MAP_HELPER, SPLIT_PROPS_HELPER } from '../src/fold-recipe'
import compiled from '../src/generated/compiled.mjs.json' with { type: 'json' }
import { compiledRuntime } from './fixture'

/** The helpers a fold can write a call to. */
const HELPERS = [RECIPE_MAP_HELPER, SPLIT_PROPS_HELPER]

/** The authoring API the barrel exists to expose. */
const AUTHORING = ['css', 'cx', 'cva', 'sva', 'fallback', 'viewTransition']

const generated = (id: 'css-index' | 'cx', file: string) => {
  const [artifact] = createGeneratorContext().getArtifacts([id])
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
  test('exports every helper the fold can write a call to, and nothing else', () => {
    expect([...exportedNames(compiled.content)].sort()).toEqual([...HELPERS].sort())
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

  test('is what the plugin resolves and loads the id to', () => {
    const plugin = bamboocssCompiledRuntime()
    const resolveId = plugin.resolveId as (id: string) => string | null
    const load = plugin.load as (id: string) => string | null

    const resolved = resolveId(COMPILED_RUNTIME_ID)
    expect(resolved).toBe(`\0${COMPILED_RUNTIME_ID}`)
    expect(resolveId(resolved!)).toBe(resolved)
    expect(load(resolved!)).toBe(compiled.content)
    expect(load(`${resolved}?t=1`)).toBe(compiled.content)

    expect(resolveId('virtual:bamboo.css')).toBeNull()
    expect(load('\0virtual:bamboo.css')).toBeNull()
  })
})

describe('the generated styled-system', () => {
  /**
   * Compiled code imports none of these from a `styled-system`, which can be another release's,
   * so the generated runtime exports none: one it did is one compiled code could be pointed at
   * again, and they are not authoring API.
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
