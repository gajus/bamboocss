import { createCss } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'
import { createCssContext } from '../src/runtime-css'
import { createFoldFixture, selectorsFor } from './fixture'

/**
 * A declaration whose value is an empty string.
 *
 * CSS has no empty value. The runtime names a class for one all the same — `content_` — while the
 * stylesheet drops the declaration, so the class had no rule and the build failed on it as a
 * mismatch between the compiler and the stylesheet, calling it a Bamboo bug. Each one is now
 * reported by the call it is written in, with what to write instead.
 */
const withImport = (body: string) => `import { css, cva, cx } from 'styled-system/css'\n${body}\n`

const skipsOf = (code: string) =>
  createFoldFixture()
    .fold(code)
    .skipped.map(({ name, reason, detail }) => ({ name, reason, detail }))

const content = {
  reason: 'empty-value',
  detail: '`content` is an empty string, which CSS has no value for; an empty `content` is written `\'""\'`',
}
const color = {
  reason: 'empty-value',
  detail:
    '`color` is an empty string, which CSS has no value for; leave it out, or write `undefined` where it is chosen',
}

describe('why it is an error', () => {
  test('the runtime names a class for it, and the stylesheet writes no rule', () => {
    const { ctx, fold, getCss } = createFoldFixture()
    fold(withImport(`export const A = css({ '&::after': { content: '' } })`))

    expect(createCss(createCssContext(ctx))({ '&::after': { content: '' } })).toBe('[&::after]:content_')
    // Nor one for a value it is not: an empty string was read back as 0, `content: 0`.
    expect(getCss()).not.toContain('content_')
  })
})

describe('reported by the call it is written in', () => {
  test.each([`{ '&::after': { content: '' } }`, `{ _before: { content: '  ' } }`])('css(%s)', (style) => {
    expect(skipsOf(withImport(`export const A = css(${style})`))).toEqual([{ name: 'css', ...content }])
  })

  test.each([
    `{ color: '' }`,
    `{ color: ' ' }`,
    `{ _hover: { color: '' } }`,
    `{ color: { base: 'red.300', md: '' } }`,
    `{ color: '!important' }`,
  ])('css(%s)', (style) => {
    expect(skipsOf(withImport(`export const A = css(${style})`))).toEqual([{ name: 'css', ...color }])
  })

  test('by the part of a `cx()` holding it', () => {
    expect(skipsOf(withImport(`export const A = cx(css({ color: '' }), css({ padding: '4' }))`))).toEqual([
      { name: 'css', ...color },
    ])
  })

  test('by the call selecting a variant holding it, and by the declaration', () => {
    const badge = `const badge = cva({ variants: { tone: { quiet: { color: 'gray.500' }, none: { color: '' } } } })`

    expect(skipsOf(withImport(`${badge}\nexport const A = badge({ tone: 'none' })`))).toEqual([
      { name: 'badge', ...color },
      { name: 'cva', ...color },
    ])
  })
})

describe('what it was meant as compiles, to classes that have rules', () => {
  test.each([`css({ '&::after': { content: '""' } })`, `css({ color: undefined, padding: '4' })`])('%s', (call) => {
    const { fold, getCss } = createFoldFixture()
    const result = fold(withImport(`export const A = ${call}`))

    expect(result.skipped).toEqual([])
    const css = getCss()
    for (const selector of result.folded.flatMap((entry) => entry.classNames).flatMap(selectorsFor)) {
      expect(css).toContain(selector)
    }
  })
})
