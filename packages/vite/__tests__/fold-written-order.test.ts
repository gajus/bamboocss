import { withoutMergeCodes } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { cascadeOrder } from '../../core/__tests__/cascade-oracle'
import { createFoldFixture } from './fixture'

/**
 * A recipe's order between two conditions the sorter ranks alike is its own.
 *
 * `_dark` and `&[data-active]` require no state, so nothing ranks one above the other, and the
 * sheet used to order them by whichever it met first. Recipes are written out after every
 * `css()` call, so any call writing both, anywhere and for any property, decided the recipe's
 * winner — here the color an element shows while dark and active.
 */
const RECIPE = `import { cva } from 'styled-system/css'
const card = cva({ base: { _dark: { color: 'white' }, '&[data-active]': { color: 'red' } } })
export const A = card()
`
const UNRELATED = `import { css } from 'styled-system/css'
export const B = css({ '&[data-active]': { fontWeight: 'bold' }, _dark: { fontWeight: 'normal' } })
`

/** The color the recipe's element shows while dark and active, folding `files` in this order. */
const colorWhileDarkAndActive = (files: Array<[string, string]>) => {
  const fixture = createFoldFixture()
  fixture.ctx.encoder.reconcileFileOwnerOrder(
    'extract',
    files.map(([path]) => fixture.pathOf(path)),
  )
  let classes = ''
  for (const [path, code] of files) {
    classes = fixture.foldStyleSets(code, path).code.match(/export const A = "([^"]*)"/)?.[1] ?? classes
  }
  expect(withoutMergeCodes(classes)).toBe('dark:c_white [&[data-active]]:c_red')

  // Both rules apply while dark and active, and only these two write color: the later wins.
  const ranking = cascadeOrder(fixture.getStyleSetCss()).color!.filter((selector) => /c_(white|red)/.test(selector))
  return ranking.at(-1)!.match(/c_(white|red)/)![1]
}

describe('a recipe’s conditions that rank alike', () => {
  test('keep the order the recipe wrote them in', () => {
    expect(colorWhileDarkAndActive([['app/src/card.tsx', RECIPE]])).toBe('red')
  })

  test('whatever another module writes for another property, before or after it', () => {
    expect(
      colorWhileDarkAndActive([
        ['app/src/a.tsx', UNRELATED],
        ['app/src/card.tsx', RECIPE],
      ]),
    ).toBe('red')
    expect(
      colorWhileDarkAndActive([
        ['app/src/card.tsx', RECIPE],
        ['app/src/z.tsx', UNRELATED],
      ]),
    ).toBe('red')
  })
})
