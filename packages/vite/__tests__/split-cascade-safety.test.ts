import { describe, expect, test } from 'vitest'
import { cascadeOrder } from '../../core/__tests__/cascade-oracle'
import { splitStaticCss, type CoOccurrences } from '../src/css-output-module'
import { createStaticCompilationSession } from '../src/static-session'

/**
 * Moving a rule to a chunk sheet must not change which declaration wins.
 *
 * Sublayers order rules that differ in specificity, condition or property priority, and that
 * is what makes the split safe for them: wherever the rule lands, its sublayer decides. Two
 * atoms that agree on all three share a sublayer, and inside one sublayer the winner is still
 * the later rule — so for those the sheet a rule sits in is the whole answer, and the entry
 * and chunk sheets have no defined order relative to each other. The browser's is decided by
 * caching and preload, not by the build.
 *
 * `cx(css({ color }), css({ color }))` is exactly that shape, and it is what a benchmark
 * caught: the variant rule moved into a route chunk and the base then won, un-styling the
 * variant before hydration.
 *
 * These assert on the oracle rather than on bytes: what must hold is the winner, in every
 * order the document can parse the sheets.
 */
const session = () => {
  const created = createStaticCompilationSession()
  created.utilityLayer = 'utilities'
  return created
}

/** Two `color` atoms in one sublayer — same specificity, no condition, same priority. */
const COMPETING =
  `@layer utilities{@layer s010-c0-p3000;` +
  `@layer s010-c0-p3000{.c_\\#fff{color:#fff}.c_\\#6b7280{color:#6b7280}}` +
  `}` +
  `:root{--made-with-bamboo:x}`

/** They reach one element together, which is what makes them able to compete. */
const TOGETHER: CoOccurrences = new Map([
  ['c_#fff', new Set(['c_#6b7280'])],
  ['c_#6b7280', new Set(['c_#fff'])],
])

const winner = (sheets: string[]) => cascadeOrder(sheets.join('')).color?.at(-1)

describe('the per-chunk split and the cascade', () => {
  test('keeps two competing atoms together, so neither order can change the winner', () => {
    const ownership = new Map([['c_#6b7280', 'assets/route.js']])
    const { css, chunks } = splitStaticCss(COMPETING, session(), ownership, TOGETHER)

    // Both stayed, so there is nothing to parse in the wrong order.
    expect(chunks.size).toBe(0)
    expect(winner([css])).toBe('.c_\\#6b7280')
  })

  test('the winner survives whichever sheet the document parses first', () => {
    const ownership = new Map([['c_#6b7280', 'assets/route.js']])
    const { css, chunks } = splitStaticCss(COMPETING, session(), ownership, TOGETHER)
    const chunk = chunks.get('assets/route.js') ?? ''

    const authored = winner([COMPETING])
    expect(winner([css, chunk])).toBe(authored)
    expect(winner([chunk, css])).toBe(authored)
  })

  test('without the split guard the winner does depend on fetch order', () => {
    // The shape this exists to prevent, with co-occurrence withheld so the split proceeds.
    const ownership = new Map([['c_#6b7280', 'assets/route.js']])
    const { css, chunks } = splitStaticCss(COMPETING, session(), ownership)
    const chunk = chunks.get('assets/route.js')!

    expect(winner([css, chunk])).not.toBe(winner([chunk, css]))
  })

  test('still splits atoms that never meet on an element', () => {
    const apart: CoOccurrences = new Map()
    const ownership = new Map([['c_#6b7280', 'assets/route.js']])
    const { css, chunks, moved } = splitStaticCss(COMPETING, session(), ownership, apart)

    expect(moved).toEqual(new Set(['c_#6b7280']))
    expect(chunks.get('assets/route.js')).toContain('6b7280')
    expect(css).not.toContain('6b7280')
  })

  test('still splits co-occurring atoms whose sublayers already order them', () => {
    // A hover rule and a bare rule share an element but sit in different sublayers, so the
    // cascade decides between them wherever each one lands.
    const ordered =
      `@layer utilities{@layer s010-c0-p3000,s020-c1-p3000;` +
      `@layer s010-c0-p3000{.c_\\#fff{color:#fff}}` +
      `@layer s020-c1-p3000{.hover\\:c_\\#6b7280:hover{color:#6b7280}}` +
      `}` +
      `:root{--made-with-bamboo:x}`
    const together: CoOccurrences = new Map([
      ['c_#fff', new Set(['hover:c_#6b7280'])],
      ['hover:c_#6b7280', new Set(['c_#fff'])],
    ])
    const { chunks, moved } = splitStaticCss(ordered, session(), new Map([['hover:c_#6b7280', 'r.js']]), together)

    expect(moved).toEqual(new Set(['hover:c_#6b7280']))
    expect(chunks.get('r.js')).toContain('6b7280')
  })

  test('keeps a competing pair together even when both are owned by different chunks', () => {
    const ownership = new Map([
      ['c_#fff', 'assets/a.js'],
      ['c_#6b7280', 'assets/b.js'],
    ])
    const { css, chunks } = splitStaticCss(COMPETING, session(), ownership, TOGETHER)

    expect(chunks.size).toBe(0)
    expect(winner([css])).toBe('.c_\\#6b7280')
  })
})

/**
 * Three breakpoints of one property, as LightningCSS leaves the sheet — and LightningCSS is
 * Vite 8's default minifier. It folds the sublayer order statement into the order of the
 * blocks, which is the same order while the sheet is one and no order at all once it is split.
 */
const FOLDED =
  `@layer utilities{` +
  `@layer s010-c0-p4000{.w_1px{width:1px}}` +
  `@layer s010-c1-p4000{@media (width>=40rem){.sm\\:w_2px{width:2px}}}` +
  `@layer s010-c2-p4000{@media (width>=64rem){.lg\\:w_4px{width:4px}}}` +
  `}` +
  `:root{--made-with-bamboo:x}`

/** What LightningCSS keeps of a statement naming a sublayer with no block: that name, in place. */
const PARTIAL = FOLDED.replace('@layer s010-c1-p4000{', '@layer s010-c1-p3000;@layer s010-c1-p4000{')

describe('the per-chunk split of a sheet whose order statement a minifier removed', () => {
  test.each([
    ['folded into the blocks', FOLDED],
    ['folded, keeping a name with no block', PARTIAL],
  ])('a lower breakpoint moved out still loses to a higher one that stayed (%s)', (_, sheet) => {
    // The `sm` sublayer leaves the entry entirely, and the entry keeps `lg`.
    const { css, chunks } = splitStaticCss(sheet, session(), new Map([['sm:w_2px', 'assets/route.js']]))
    const chunk = chunks.get('assets/route.js')!

    const authored = cascadeOrder(sheet).width
    expect(authored?.at(-1)).toBe('@media (width>=64rem) .lg\\:w_4px')
    expect(cascadeOrder(css + chunk).width).toEqual(authored)
    expect(cascadeOrder(chunk + css).width).toEqual(authored)
  })
})

/**
 * The layers the utilities sit among. Preflight is in `reset` and global styles in `base`, both
 * declared before `utilities`, which is what lets every utility override them. Layers rank by when
 * the document first declares them, statement or block, so that holds only while the first sheet
 * the document parses declares them in that order.
 */
const LAYERED =
  `@layer reset,base,tokens,utilities;` +
  `@layer reset{*{margin:0}}` +
  `@layer base{body{color:#000}}` +
  `@layer utilities{@layer s010-c0-p4000;@layer s010-c0-p4000{.m_4px{margin:4px}.c_red{color:red}}}` +
  `:root{--made-with-bamboo:x}`

describe('the per-chunk split and the layers around the utilities', () => {
  test.each([
    ['declared by a statement', LAYERED],
    // What LightningCSS leaves: a statement only for a layer with no block, and the order of the blocks.
    ['folded into the blocks', LAYERED.replace('@layer reset,base,tokens,utilities;', '@layer reset;')],
  ])(
    'a utility moved to a route sheet still beats preflight and global styles, whichever sheet is parsed first (%s)',
    (_, sheet) => {
      const ownership = new Map([
        ['m_4px', 'assets/route.js'],
        ['c_red', 'assets/route.js'],
      ])
      const { css, chunks } = splitStaticCss(sheet, session(), ownership)
      const chunk = chunks.get('assets/route.js')!

      for (const sheets of [css + chunk, chunk + css]) {
        expect(cascadeOrder(sheets).margin?.at(-1), 'over preflight').toBe('.m_4px')
        expect(cascadeOrder(sheets).color?.at(-1), 'over global styles').toBe('.c_red')
      }
    },
  )
})
