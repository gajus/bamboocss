import { createContext } from '@bamboocss/fixture'
import { logger } from '@bamboocss/logger'
import type { Dict } from '@bamboocss/types'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cascadeOrder } from './cascade-oracle'

/**
 * Conditions the sorter ranks alike — `_dark` and `&[data-active]`, neither requiring a state —
 * are ordered by the style objects that write both, each for the property it writes: the one
 * written later wins, as it would in a stylesheet written by hand.
 *
 * They used to be ordered by whichever the build met first, so a call anywhere writing both
 * decided for every other, whatever property it set.
 */

/** The sheet for these files' style objects, each read as its file, in this inventory order. */
const sheetOf = (files: Array<[path: string, styles: Dict[]]>, arrival = files.map(([path]) => path)) => {
  const ctx = createContext() as any
  ctx.encoder.reconcileFileOwnerOrder(
    'extract',
    files.map(([path]) => path),
  )
  for (const path of arrival) {
    const [, styles] = files.find(([file]) => file === path)!
    ctx.encoder.withOwner('extract', path, () => styles.forEach((style) => ctx.encoder.processAtomic(style)))
  }
  const sheet = ctx.createSheet()
  ctx.appendParserCss(sheet)
  return { ctx, css: ctx.getCss(sheet) as string }
}

/** Where every rule writing `property` applies, the one that wins. */
const winner = (css: string, property: string) => cascadeOrder(css)[property]!.at(-1)

const recipe = { _dark: { color: 'white' }, '&[data-active]': { color: 'red' } }
const other = { '&[data-active]': { fontWeight: 'bold' }, _dark: { fontWeight: 'normal' } }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('conditions that rank alike', () => {
  test('keep the order an object wrote them in, whatever another writes for another property', () => {
    for (const files of [
      [
        ['src/a.tsx', [other]],
        ['src/b.tsx', [recipe]],
      ],
      [
        ['src/a.tsx', [recipe]],
        ['src/b.tsx', [other]],
      ],
    ] as Array<Array<[string, Dict[]]>>) {
      const { css } = sheetOf(files)

      expect(winner(css, 'color')).toContain('c_red')
      expect(winner(css, 'font-weight')).toContain('fw_normal')
    }
  })

  test('and for the same property, when the values differ', () => {
    const blueFirst = { '&[data-active]': { color: 'blue' }, _dark: { color: 'gray' } }
    const { css } = sheetOf([
      ['src/a.tsx', [blueFirst]],
      ['src/b.tsx', [recipe]],
    ])
    const ranking = cascadeOrder(css).color!.map((selector) => selector.match(/c_(\w+)/)?.[1])

    // Each object's later declaration ranks above its earlier one.
    expect(ranking.lastIndexOf('gray')).toBeGreaterThan(ranking.indexOf('blue'))
    expect(ranking.lastIndexOf('red')).toBeGreaterThan(ranking.lastIndexOf('white'))
  })

  test('share one sublayer where objects order them both ways, and keep their own otherwise', () => {
    const alone = sheetOf([['src/a.tsx', [recipe]]]).css
    expect(alone).toContain('@layer s020-c0-p3000, s020-c1-p3000;')

    const both = sheetOf([
      ['src/a.tsx', [other]],
      ['src/b.tsx', [recipe]],
    ]).css
    expect(both).toContain('@layer s020-c0c1-p3000;')
  })

  test('the same two declarations written in both orders keep one order, the same in every build, said once', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const reversed = { '&[data-active]': { color: 'red' }, _dark: { color: 'white' } }
    const { ctx, css } = sheetOf([
      ['src/a.tsx', [recipe]],
      ['src/b.tsx', [reversed]],
    ])

    expect(winner(css, 'color')).toContain('c_red')
    expect(warn.mock.calls.filter(([scope]) => scope === 'sheet:order')).toMatchInlineSnapshot(`
      [
        [
          "sheet:order",
          "\`dark:c_white\` and \`[&[data-active]]:c_red\` set one property under conditions that rank alike, and are written in both orders: \`src/a.tsx\` writes \`dark:c_white\` first, \`src/b.tsx\` writes \`[&[data-active]]:c_red\` first. One stylesheet can keep only one order, so where both apply \`[&[data-active]]:c_red\` wins. To choose, nest one condition inside the other.",
        ],
      ]
    `)

    // A second sheet from the same context says nothing new.
    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    ctx.getCss(sheet)
    expect(warn.mock.calls.filter(([scope]) => scope === 'sheet:order')).toHaveLength(1)
  })

  test('orders that contradict through a third declaration keep all but one, and say which', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { css } = sheetOf([
      ['src/a.tsx', [{ _dark: { color: 'white' }, '&[data-active]': { color: 'red' } }]],
      ['src/b.tsx', [{ '&[data-active]': { color: 'red' }, '&[data-open]': { color: 'blue' } }]],
      ['src/c.tsx', [{ '&[data-open]': { color: 'blue' }, _dark: { color: 'white' } }]],
    ])
    const ranking = cascadeOrder(css).color!.map((selector) => selector.match(/c_(\w+)/)?.[1])

    // a and b keep theirs; c, closing the circle, cannot.
    expect(ranking.lastIndexOf('red')).toBeGreaterThan(ranking.lastIndexOf('white'))
    expect(ranking.lastIndexOf('blue')).toBeGreaterThan(ranking.lastIndexOf('red'))
    expect(warn.mock.calls.filter(([scope]) => scope === 'sheet:order').map(([, message]) => message))
      .toMatchInlineSnapshot(`
        [
          "\`dark:c_white\` and \`[&[data-open]]:c_blue\` set one property under conditions that rank alike, and are written in both orders: the order others write puts \`dark:c_white\` first, \`src/c.tsx\` writes \`[&[data-open]]:c_blue\` first. One stylesheet can keep only one order, so where both apply \`[&[data-open]]:c_blue\` wins. To choose, nest one condition inside the other.",
        ]
      `)
  })

  test('written in both orders with one value, there is nothing to choose and nothing said', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const same = { _dark: { color: 'white' }, '&[data-active]': { color: 'white' } }
    const reversed = { '&[data-active]': { color: 'white' }, _dark: { color: 'white' } }
    sheetOf([
      ['src/a.tsx', [same]],
      ['src/b.tsx', [reversed]],
    ])

    expect(warn.mock.calls.filter(([scope]) => scope === 'sheet:order')).toHaveLength(0)
  })

  test('a file read again without the object no longer orders the others', () => {
    const ctx = createContext() as any
    ctx.encoder.reconcileFileOwnerOrder('extract', ['src/a.tsx', 'src/b.tsx'])
    ctx.encoder.withOwner('extract', 'src/a.tsx', () => ctx.encoder.processAtomic(other))
    ctx.encoder.withOwner('extract', 'src/b.tsx', () => ctx.encoder.processAtomic(recipe))
    ctx.encoder.withOwner('extract', 'src/a.tsx', () => ctx.encoder.processAtomic({ fontWeight: 'bold' }))

    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    const css = ctx.getCss(sheet) as string

    expect(css).toContain('@layer s010-c0-p3000, s020-c1-p3000, s020-c2-p3000;')
    expect(winner(css, 'color')).toContain('c_red')
  })

  test('is decided by the inventory, not by the order files arrive in', () => {
    const files: Array<[string, Dict[]]> = [
      ['src/a.tsx', [other]],
      ['src/b.tsx', [recipe]],
      ['src/c.tsx', [{ '&[data-active]': { color: 'blue' }, _dark: { color: 'gray' } }]],
    ]
    const expected = sheetOf(files).css
    for (const arrival of [
      ['src/c.tsx', 'src/b.tsx', 'src/a.tsx'],
      ['src/b.tsx', 'src/c.tsx', 'src/a.tsx'],
    ]) {
      expect(sheetOf(files, arrival).css, arrival.join(', ')).toBe(expected)
    }
  })
})
