import { describe, expect, test } from 'vitest'
import { COMPILED_RUNTIME_ID } from '../src/compiled-runtime'
import { createFoldFixture } from './fixture'

/**
 * A compiled module joins classes at runtime with the plugin's `cx`, not the one it imported.
 *
 * `cx` merges by reading class names past the `prefix` it was generated for, and the classes a
 * compiled module joins are this build's: a workspace design system's own `styled-system`, generated
 * by another release or for its own config, holds a `cx` that reads none of them as atoms. The
 * module's binding is rebound to `virtual:bamboo/compiled`, so every read of it follows.
 */
const fromPlugin = (names: string) => `import { ${names} } from '${COMPILED_RUNTIME_ID}'`

describe('cx in a compiled module', () => {
  test('is bound to the plugin’s, under the name the module gave it', () => {
    const { fold, foldStrict } = createFoldFixture()
    const source =
      `import { css, cx } from 'styled-system/css'\n` +
      `export const join = (className) => cx(css({ color: 'red.500' }), className)\n`
    const result = fold(source)

    expect(result.code).toContain(`import { css, cx as __bambooCx0 } from 'styled-system/css'\n${fromPlugin('cx')}\n`)
    // Called as written: the binding is what changed.
    expect(result.code).toMatch(/export const join = \(className\) => cx\("[^"]+", className\)/)
    // The same text whether or not references were asked for, which a dev server's check that a
    // module is unchanged compares against.
    expect(foldStrict(source).code).toBe(result.code)
  })

  test('keeps an alias, and the compiler’s own call uses it', () => {
    const { fold } = createFoldFixture()
    const result = fold(
      `import { cva, cx as merge } from 'styled-system/css'\n` +
        `const badge = cva({ variants: { tone: { quiet: { color: 'gray.500' }, loud: { color: 'red.500' } } } })\n` +
        `export const join = (tone, className) => merge(badge({ tone }), className)\n`,
    )

    expect(result.code).toContain(`import { cva, cx as __bambooCx0 } from 'styled-system/css'`)
    expect(result.code).toContain(fromPlugin('cvaMap, cx as merge'))
    expect(result.code).toMatch(/export const join = \(tone, className\) => merge\(cvaMap\(\[tone\], /)
  })

  test('rebinds a deep import of cx, and each of several imports', () => {
    const { fold } = createFoldFixture()
    const result = fold(
      `import { cx } from 'styled-system/css/cx'\n` +
        `import { css, cx as join } from 'styled-system/css'\n` +
        `export const a = (c) => cx(c, css({ color: 'red.500' }))\n` +
        `export const b = (c) => join(c, css({ color: 'blue.500' }))\n`,
    )

    expect(result.code).toContain(`import { cx as __bambooCx0 } from 'styled-system/css/cx'`)
    expect(result.code).toContain(`import { css, cx as __bambooCx1 } from 'styled-system/css'`)
    expect(result.code).toContain(fromPlugin('cx, cx as join'))
  })

  test('rebinds a module that compiles nothing and only joins at runtime', () => {
    const { fold } = createFoldFixture()
    const result = fold(`import { cx } from 'styled-system/css'\nexport const join = (a, b) => cx(a, b)\n`)

    expect(result.folded).toEqual([])
    expect(result.map).not.toBeNull()
    expect(result.code).toBe(
      `import { cx as __bambooCx0 } from 'styled-system/css'\n${fromPlugin('cx')}\nexport const join = (a, b) => cx(a, b)\n`,
    )
  })

  test('re-exports the plugin’s cx where a module re-exports cx alone', () => {
    const { fold } = createFoldFixture()
    const result = fold(
      `export { cx } from 'styled-system/css'\n` +
        `export { cx as merge } from 'styled-system/css/cx'\n` +
        `export { other } from './other'\n`,
    )

    expect(result.code).toBe(
      `export { cx } from '${COMPILED_RUNTIME_ID}'\n` +
        `export { cx as merge } from '${COMPILED_RUNTIME_ID}'\n` +
        `export { other } from './other'\n`,
    )
  })

  test('leaves a re-export naming anything else, which hands on an API compiled code cannot keep', () => {
    const { foldStrict } = createFoldFixture()
    const source = `export { css, cx } from 'styled-system/css'\n`
    const result = foldStrict(source)

    expect(result.code).toBe(source)
    expect(result.skipped.map((entry) => [entry.name, entry.reason])).toContainEqual(['css', 'runtime-binding'])
  })

  test('leaves a cx that is not Bamboo’s, and a type-only import', () => {
    const { fold } = createFoldFixture()
    const source =
      `import { cx } from 'clsx'\n` +
      `import type { cx as Cx } from 'styled-system/css'\n` +
      `import { css, type cx as CxType } from 'styled-system/css'\n` +
      `export const a = (c) => cx(c, css({ color: 'red.500' }))\n`
    const result = fold(source)

    expect(result.code).toContain(`import { cx } from 'clsx'\n`)
    expect(result.code).toContain(`import type { cx as Cx } from 'styled-system/css'\n`)
    expect(result.code).toContain(`import { css, type cx as CxType } from 'styled-system/css'\n`)
    expect(result.code).not.toContain(COMPILED_RUNTIME_ID)
  })

  test('renames the original out of the way with a name the module never spells', () => {
    const { fold } = createFoldFixture()
    const result = fold(
      `import { cx } from 'styled-system/css'\n` +
        `const __bambooCx0 = 'taken'\n` +
        `export const join = (a, b) => cx(a, b, __bambooCx0)\n`,
    )

    expect(result.code).toContain(`import { cx as __bambooCx_0 } from 'styled-system/css'`)
    expect(result.code).toContain(`const __bambooCx0 = 'taken'`)
  })

  test('writes nothing when folded again', () => {
    const { fold } = createFoldFixture()
    const first = fold(
      `import { css, cx as merge } from 'styled-system/css'\n` +
        `export { cx } from 'styled-system/css'\n` +
        `export const join = (className) => merge(css({ color: 'red.500' }), className)\n`,
    )
    const second = fold(first.code)

    expect(first.code).toContain(fromPlugin('cx as merge'))
    expect(second.code).toBe(first.code)
    expect(second.map).toBeNull()
  })
})
