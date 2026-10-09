import { createCss } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'
import { createCssContext } from '../src/runtime-css'
import { createFoldFixture, selectorsFor } from './fixture'

/**
 * A key nested in a style object that is neither a property nor a condition.
 *
 * The compiler named a class for it that kept the key — `_hovr:c_red.300` — while the stylesheet
 * dropped the key and wrote the declaration with no condition at all. The class had no rule, so
 * the element went unstyled and nothing said so. Each such key is now reported by the call it is
 * written in, with what it was probably meant to be.
 */
const withImport = (body: string) => `import { css, cva, cx } from 'styled-system/css'\n${body}\n`

const skipsOf = (code: string) =>
  createFoldFixture()
    .fold(code)
    .skipped.map(({ name, reason, detail }) => ({ name, reason, detail }))

/** Every class the fold emitted, checked against the stylesheet the same module produced. */
const expectRules = (code: string) => {
  const { fold, getCss } = createFoldFixture()
  const result = fold(code)

  expect(result.skipped).toEqual([])
  expect(result.folded.length).toBeGreaterThan(0)
  const css = getCss()
  for (const selector of result.folded.flatMap((entry) => entry.classNames).flatMap(selectorsFor)) {
    expect(css).toContain(selector)
  }
}

describe('why it is an error', () => {
  test('the class the runtime names for it has no rule, and its declaration lost the condition', () => {
    const { ctx, fold, getCss } = createFoldFixture()
    fold(withImport(`export const A = css({ _hovr: { color: 'red.300' } })`))
    const named = createCss(createCssContext(ctx))({ _hovr: { color: 'red.300' } })

    expect(named).toBe('_hovr:c_red.300')
    expect(getCss()).not.toContain(selectorsFor(named)[0])
    expect(getCss()).toContain('.c_red\\.300')
  })
})

describe('a key that is not a condition is reported where it is written', () => {
  test.each([
    [
      'a misspelled condition',
      `css({ _hovr: { color: 'red.300' } })`,
      '`_hovr` is not a condition; did you mean `_hover`?',
    ],
    [
      'a misspelled condition among a property’s values',
      `css({ color: { base: 'red.300', _hovr: 'blue.300' } })`,
      '`_hovr` is not a condition; did you mean `_hover`?',
    ],
    [
      'a misspelled condition inside another',
      `css({ _hover: { _focs: { color: 'red.300' } } })`,
      '`_focs` is not a condition; did you mean `_focus`?',
    ],
    [
      'a condition without its underscore',
      `css({ hover: { color: 'red.300' } })`,
      '`hover` is not a condition; did you mean `_hover`?',
    ],
    ['a misspelled breakpoint', `css({ mdd: { color: 'red.300' } })`, '`mdd` is not a condition; did you mean `md`?'],
    [
      'a pseudo-class function written as a key',
      `css({ has: { svg: { color: 'red.300' } } })`,
      "`has` is not a condition; did you mean `'&:has(svg)'`?",
    ],
    [
      'an element selector without `&`',
      `css({ svg: { color: 'red.300' } })`,
      "`svg` is not a condition; did you mean `'& svg'`?",
    ],
    [
      'a pseudo-class without `&`',
      `css({ ':hover': { color: 'red.300' } })`,
      "`:hover` is not a condition; did you mean `'&:hover'`?",
    ],
    [
      'a combinator without `&`',
      `css({ '> p': { color: 'red.300' } })`,
      "`> p` is not a condition; did you mean `'& > p'`?",
    ],
    [
      'a key nothing resembles',
      `css({ Tooltip: { color: 'red.300' } })`,
      '`Tooltip` is neither a condition nor a selector written with `&`',
    ],
  ])('%s', (_, call, detail) => {
    expect(skipsOf(withImport(`export const A = ${call}`))).toEqual([
      { name: 'css', reason: 'unknown-condition', detail },
    ])
  })

  test('in a pattern', () => {
    const skips = skipsOf(
      `import { flex } from 'styled-system/patterns'\nexport const A = flex({ gap: '2', _hovr: { color: 'red.300' } })\n`,
    )

    expect(skips).toEqual([
      { name: 'flex', reason: 'unknown-condition', detail: '`_hovr` is not a condition; did you mean `_hover`?' },
    ])
  })

  test('in a `cx()` argument, by that argument alone', () => {
    const skips = skipsOf(
      withImport(`export const A = cx(css({ color: 'red.300' }), css({ _hovr: { color: 'blue.300' } }))`),
    )

    expect(skips).toEqual([
      { name: 'css', reason: 'unknown-condition', detail: '`_hovr` is not a condition; did you mean `_hover`?' },
    ])
  })
})

describe('in a `cx()` composing a recipe chosen at runtime', () => {
  const detail = '`_hovr` is not a condition; did you mean `_hover`?'
  const badge = `const badge = cva({ variants: { tone: { quiet: { color: 'gray.500' }, loud: { color: 'red.300' } } } })`
  const broken = `const broken = cva({ variants: { tone: { quiet: { color: 'gray.500' }, loud: { _hovr: { color: 'red.300' } } } } })`

  test('by the argument holding it, when that is a `css()` call', () => {
    expect(
      skipsOf(
        withImport(`${badge}\nexport const f = (tone) => cx(badge({ tone }), css({ _hovr: { color: 'blue.300' } }))`),
      ),
    ).toEqual([{ name: 'css', reason: 'unknown-condition', detail }])
  })

  test('by the recipe call, when the recipe holds it', () => {
    expect(
      skipsOf(withImport(`${broken}\nexport const f = (tone) => cx(broken({ tone }), css({ color: 'blue.300' }))`)),
    ).toEqual([
      { name: 'broken', reason: 'unknown-condition', detail },
      { name: 'cva', reason: 'unknown-condition', detail },
    ])
  })
})

describe('by the composition, when no part holds it on its own', () => {
  // Applied alone, a mixin keeps its own class, and the key in its declaration is never named at
  // the call. Composed, it is written out where it is applied, and the composition meets it.
  const config = { theme: { extend: { mixins: { ring: { value: { _hovr: { color: 'red.300' } } } } } } }

  test('a mixin written out once its argument is no longer alone', () => {
    const skips = createFoldFixture(config)
      .fold(withImport(`export const A = cx(css({ mixin: 'ring' }), css({ color: 'blue.300' }))`))
      .skipped.map(({ name, reason, detail }) => ({ name, reason, detail }))

    expect(skips).toEqual([
      { name: 'cx', reason: 'unknown-condition', detail: '`_hovr` is not a condition; did you mean `_hover`?' },
    ])
  })
})

describe('in a recipe', () => {
  const detail = '`_hovr` is not a condition; did you mean `_hover`?'
  const badge = `const badge = cva({ variants: { tone: { quiet: { color: 'gray.500' }, loud: { _hovr: { color: 'red.300' } } } } })`

  test('by the call selecting it, and by the declaration that holds it', () => {
    expect(skipsOf(withImport(`${badge}\nexport const A = badge({ tone: 'loud' })`))).toEqual([
      { name: 'badge', reason: 'unknown-condition', detail },
      { name: 'cva', reason: 'unknown-condition', detail },
    ])
  })

  test('by a call choosing among its variants at runtime, since every one is compiled', () => {
    expect(skipsOf(withImport(`${badge}\nexport const f = (tone) => badge({ tone })`))).toEqual([
      { name: 'badge', reason: 'unknown-condition', detail },
      { name: 'cva', reason: 'unknown-condition', detail },
    ])
  })

  test('only by the declaration, when the call selects a variant without it', () => {
    expect(skipsOf(withImport(`${badge}\nexport const A = badge({ tone: 'quiet' })`))).toEqual([
      { name: 'cva', reason: 'unknown-condition', detail },
    ])
  })
})

describe('every way of writing a condition still compiles, to classes that have rules', () => {
  test.each([
    `css({ _hover: { color: 'red.300' } })`,
    `css({ color: { base: 'red.300', _hover: 'blue.300', md: 'green.300' } })`,
    `css({ md: { _hover: { color: 'red.300' } } })`,
    `css({ _hover: { _focus: { color: 'red.300' } } })`,
    `css({ '&:hover': { color: 'red.300' } })`,
    `css({ '& svg': { color: 'red.300' } })`,
    `css({ '&:has(svg)': { color: 'red.300' } })`,
    `css({ '[data-state=open] &': { color: 'red.300' } })`,
    `css({ '@media (min-width: 40em)': { color: 'red.300' } })`,
    `css({ _dark: { color: 'red.300' } })`,
    `css({ base: { color: 'red.300' }, _hover: { color: 'blue.300' } })`,
    `css({ '--size': { base: '1px', md: '2px' } })`,
    `css({ _before: { content: '""', color: 'red.300' } })`,
  ])('%s', (call) => {
    expectRules(withImport(`export const A = ${call}`))
  })
})
