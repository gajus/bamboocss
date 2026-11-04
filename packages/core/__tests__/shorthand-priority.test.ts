import { createContext } from '@bamboocss/fixture'
import { allCssProperties } from '@bamboocss/is-valid-prop'
import { getPropertyPriority } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'
import { cascadeOrder } from './cascade-oracle'
import chrome from './chrome-shorthands.json' with { type: 'json' }

/**
 * A utility is written into a cascade sublayer keyed in part by its property's priority, and two
 * atoms in one sublayer are ordered by nothing but where the sheet happens to hold them. So a
 * shorthand ranking with a longhand it sets ties with it: `css({ whiteSpace: 'nowrap' })` and
 * `css({ textWrapMode: 'wrap' })` on one element went to whichever rule arrived later, though
 * the longhand is meant to win.
 *
 * What sets what is Chrome's answer, from `scripts/chrome-shorthands.ts`. Only names `css()`
 * takes are held to it; Chrome also knows a hundred `-webkit-` aliases nothing types.
 */
const shorthands = new Map(Object.entries(chrome.shorthands).map(([name, longhands]) => [name, new Set(longhands)]))
const taken = new Set(allCssProperties)
const ranked = (name: string) => `${name} ${getPropertyPriority(name)}`

describe('a shorthand css() takes', () => {
  test('ranks below every longhand it sets', () => {
    const ties: string[] = []
    for (const [shorthand, longhands] of shorthands) {
      if (!taken.has(shorthand)) continue
      for (const longhand of longhands) {
        if (getPropertyPriority(shorthand) >= getPropertyPriority(longhand)) {
          ties.push(`${ranked(shorthand)} ≥ ${ranked(longhand)}`)
        }
      }
    }

    expect(ties).toEqual([])
  })

  /**
   * `grid` sets everything `gridTemplate` does and more, so `gridTemplate` is the longhand in that
   * pair. A name Chrome resolves to one other property — `wordWrap` to `overflowWrap` — is that
   * property's other spelling, ranked below it by the test above; it is not nested in a shorthand
   * that sets the same property, and is not held to ranking above one.
   */
  test('ranks below every shorthand nested in it', () => {
    const ties: string[] = []
    for (const [shorthand, longhands] of shorthands) {
      if (!taken.has(shorthand)) continue
      for (const [nested, its] of shorthands) {
        const isNested = its.size > 1 && its.size < longhands.size && [...its].every((name) => longhands.has(name))
        if (isNested && getPropertyPriority(shorthand) >= getPropertyPriority(nested)) {
          ties.push(`${ranked(shorthand)} ≥ ${ranked(nested)}`)
        }
      }
    }

    expect(ties).toEqual([])
  })
})

/**
 * The ranking through the stylesheet, where it decides a winner. The oracle compares declarations
 * of one property name, so the pair's two names are read as one.
 */
describe('a longhand wins over the shorthand that sets it, whichever arrives first', () => {
  test.each([
    [{ whiteSpace: 'nowrap' }, { textWrapMode: 'wrap' }, /\b(?:white-space|text-wrap-mode):/g, '.text-wrap-mode_wrap'],
    [
      { borderBlockColor: 'red' },
      { borderBlockStartColor: 'blue' },
      /\bborder-block(?:-start)?-color:/g,
      '.bd-bs-c_blue',
    ],
    [{ textBox: 'trim-both cap alphabetic' }, { textBoxTrim: 'none' }, /\btext-box(?:-trim)?:/g, '.text-box-trim_none'],
    [{ grid: 'auto-flow / 1fr' }, { gridTemplate: 'none' }, /\bgrid(?:-template)?:/g, '.grid-template_none'],
  ])('%o and %o', (shorthand, longhand, names, winner) => {
    for (const arrival of [
      [shorthand, longhand],
      [longhand, shorthand],
    ]) {
      const ctx = createContext() as any
      for (const styles of arrival) ctx.encoder.processAtomic(styles)
      const sheet = ctx.createSheet()
      ctx.appendParserCss(sheet)
      const ranked = cascadeOrder((ctx.getCss(sheet) as string).replace(names, 'one-property:'))['one-property']

      expect(ranked?.at(-1)).toBe(winner)
    }
  })
})

test('the table is a Chrome that expands the shorthands this is about', () => {
  // mdn-data lists neither of these as a shorthand of what it sets.
  expect(chrome.shorthands.whiteSpace).toEqual(['textWrapMode', 'whiteSpaceCollapse'])
  expect(chrome.shorthands.borderBlockColor).toEqual(['borderBlockEndColor', 'borderBlockStartColor'])
  expect(shorthands.size).toBeGreaterThan(200)
})
