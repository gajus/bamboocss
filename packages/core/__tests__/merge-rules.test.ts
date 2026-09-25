import postcss from 'postcss'
import { describe, expect, test } from 'vitest'
import { mergeRules } from '../src/plugins/merge-rules'

const merge = async (css: string) =>
  (await postcss([mergeRules()]).process(css, { from: undefined })).css.replace(/\s+/g, ' ').trim()

/**
 * A merge may not move a declaration across the shorthand that overrides it.
 *
 * Merging `.a { top: 0 }` into `.b { inset: 5px; top: 0 }` hoists `top` into a shared `.a,.b`
 * rule written *before* `.b`, so `.b` is left with `inset` after it — and `inset` now wins, the
 * opposite of what `.b` said. The conflict check matched names by prefix, which catches
 * `margin`/`margin-top` and misses every shorthand whose longhands are named differently.
 */
describe('merge-rules keeps a longhand after the shorthand it overrides', () => {
  test.each([
    ['inset / top', '.a { top: 0; } .b { inset: 5px; top: 0; }'],
    ['gap / row-gap', '.a { row-gap: 1px; } .b { gap: 2px; row-gap: 1px; }'],
    ['font / line-height', '.a { line-height: 2; } .b { font: 12px x; line-height: 2; }'],
    ['grid-area / grid-row', '.a { grid-row: 1; } .b { grid-area: a; grid-row: 1; }'],
    [
      'grid-area / grid-row-start, through grid-row',
      '.a { grid-row-start: 1; } .b { grid-area: a; grid-row-start: 1; }',
    ],
    ['place-items / align-items', '.a { align-items: end; } .b { place-items: center; align-items: end; }'],
    ['flex / flex-basis', '.a { flex-basis: 0; } .b { flex: 1 1 auto; flex-basis: 0; }'],
  ])('%s', async (_, css) => {
    expect(await merge(css)).toBe(css)
  })

  test('declarations that do not conflict still merge', async () => {
    expect(await merge('.a { color: red; } .b { top: 0; color: red; }')).toBe('.a,.b { color: red; } .b { top: 0; }')
  })

  test('the prefix-named case still holds', async () => {
    const css = '.a { margin-top: 1px; } .b { margin: 2px; margin-top: 1px; }'
    expect(await merge(css)).toBe(css)
  })
})
