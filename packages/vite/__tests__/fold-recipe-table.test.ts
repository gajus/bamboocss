import { describe, expect, test } from 'vitest'
import { compiledRuntime, createFoldFixture } from './fixture'

/**
 * Where a recipe lookup's table lives: declared once for the module, before its first import, and
 * read by every call. Written inside the call, it was built again on every render, nodes, leaves and
 * slot objects alike, and each call site repeated it.
 */
const RECIPE = `const badge = cva({ variants: { tone: { quiet: { color: 'gray.500' }, loud: { color: 'red.500' } } } })`

/** Fold `source` and run it against the `cvaMap` the plugin serves, with `globals` in scope. */
const run = (
  source: string,
  exports: string[],
  globals: Record<string, unknown> = {},
  {
    cvaMap = compiledRuntime.cvaMap,
    files = {},
  }: { cvaMap?: (...args: never[]) => unknown; files?: Record<string, string> } = {},
) => {
  const fixture = createFoldFixture()
  fixture.addFiles(files)
  const { code } = fixture.foldStrict(source)
  const body = code.replace(/^import .*$/gm, '').replaceAll('export const ', 'const ')
  const module = new Function(
    'cvaMap',
    'cvaJoin',
    ...Object.keys(globals),
    `${body}\nreturn { ${exports.join(', ')} }`,
  )(cvaMap, compiledRuntime.cvaJoin, ...Object.values(globals))
  return { code, module: module as Record<string, any>, fixture }
}

const declarations = (code: string) => code.match(/^const __bambooLookup\w* = /gm) ?? []

describe('a recipe lookup table', () => {
  test('is declared once for the module, and every call reads it', () => {
    const { code, module, fixture } = run(
      `import { cva } from 'styled-system/css'\n${RECIPE}\nexport const a = (tone) => badge({ tone })\nexport const b = (tone) => badge({ tone })\n`,
      ['a', 'b'],
    )

    expect(declarations(code)).toHaveLength(1)
    expect(code.match(/cvaMap\(\[tone\], __bambooLookup0\)/g)).toHaveLength(2)
    expect(module.a('loud')).toBe(fixture.runtimeCss({ color: 'red.500' }))
    expect(module.b('quiet')).toBe(fixture.runtimeCss({ color: 'gray.500' }))
  })

  test('is declared after the directives and comments the module opens with', () => {
    const { code } = run(
      `'use client'\n/** @jsxImportSource preact */\nimport { cva } from 'styled-system/css'\n${RECIPE}\nexport const a = (tone) => badge({ tone })\n`,
      ['a'],
    )

    expect(code.startsWith(`'use client'\n/** @jsxImportSource preact */\nconst __bambooLookup0 = `)).toBe(true)
  })

  // Nothing runs ahead of the table, so this call, at module scope, reads it initialized.
  test('is read by a call at module scope', () => {
    const { module, fixture } = run(
      `import { cva } from 'styled-system/css'\n${RECIPE}\nexport const cls = badge({ tone: readTone() })\n`,
      ['cls'],
      { readTone: () => 'loud' },
    )
    expect(module.cls).toBe(fixture.runtimeCss({ color: 'red.500' }))
  })

  // A statement before the first import runs before anything declared there could be initialized.
  // The table is a `var` there, hoisted, and the first call to read it assigns it. Written into the
  // call, it was built again on every one.
  test('is assigned by the first call to read it when a statement comes before the first import', () => {
    const tables: unknown[] = []
    const { code, module, fixture } = run(
      `const early = 1\nimport { cva } from 'styled-system/css'\n${RECIPE}\nexport const a = (tone) => badge({ tone })\nexport const b = (tone) => badge({ tone })\n`,
      ['a', 'b', 'early'],
      {},
      { cvaMap: (values: never, table: never) => (tables.push(table), compiledRuntime.cvaMap(values, table)) },
    )

    expect(declarations(code)).toEqual([])
    expect(code).toMatch(/\nvar __bambooLookup0;\n$/)
    expect(code.match(/cvaMap\(\[tone\], \(__bambooLookup0 \|\| \(__bambooLookup0 = \[0,/g)).toHaveLength(2)
    expect(module.a('loud')).toBe(fixture.runtimeCss({ color: 'red.500' }))
    expect(module.b('quiet')).toBe(fixture.runtimeCss({ color: 'gray.500' }))
    expect(module.a('quiet')).toBe(fixture.runtimeCss({ color: 'gray.500' }))
    expect(new Set(tables).size).toBe(1)
  })

  // What the `var` is for: a call at module scope ahead of the first import, through a binding the
  // import initializes before the module runs. A table declared at the import is not initialized yet.
  test('is read by a call at module scope ahead of the first import', () => {
    const { module, fixture } = run(
      `export const early = badge({ tone: readTone() })\nimport { badge } from './styles'\n`,
      ['early'],
      { readTone: () => 'loud' },
      { files: { 'app/src/styles.ts': `import { cva } from 'styled-system/css'\nexport ${RECIPE}\n` } },
    )

    expect(module.early).toBe(fixture.runtimeCss({ color: 'red.500' }))
  })

  test('is named so that no binding in the module is taken or shadowed', () => {
    const { code, module, fixture } = run(
      `import { cva } from 'styled-system/css'\nconst __bambooLookup0 = 'mine'\n${RECIPE}\nexport const a = (tone) => badge({ tone })\n`,
      ['a', '__bambooLookup0'],
    )

    // The table's, then the module's own.
    expect(declarations(code)).toEqual(['const __bambooLookup_0 = ', 'const __bambooLookup0 = '])
    expect(module.__bambooLookup0).toBe('mine')
    expect(module.a('quiet')).toBe(fixture.runtimeCss({ color: 'gray.500' }))
  })

  // The table holds one object per state, which every call would otherwise share.
  test('hands each call its own slot object', () => {
    const { module } = run(
      `import { sva } from 'styled-system/css'
const field = sva({
  slots: ['root', 'label'],
  base: { root: { display: 'flex' } },
  variants: { tone: { quiet: { label: { color: 'gray.500' } }, loud: { label: { color: 'red.500' } } } },
})
export const slots = (tone) => field({ tone })
`,
      ['slots'],
    )

    const first = module.slots('loud')
    const root = first.root
    first.root = `${root} mine`
    expect(module.slots('loud').root).toBe(root)
    expect(module.slots('loud')).not.toBe(module.slots('loud'))
  })
})
