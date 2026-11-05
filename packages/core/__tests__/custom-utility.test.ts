import { createGeneratorContext, fixturePreset } from '@bamboocss/fixture'
import type { Dict } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { createRuleProcessor } from './fixture'

describe('custom utility', () => {
  test('shorthand + no className', () => {
    const css = (styles: any) =>
      createRuleProcessor({
        utilities: {
          extend: {
            coloredBorder: {
              shorthand: 'cb',
              values: ['red', 'green', 'blue'],
              transform(value) {
                return {
                  border: `1px solid ${value}`,
                }
              },
            },
          },
        },
      })
        .css(styles)
        .toCss()

    expect(css({ coloredBorder: 'red' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          .cb_red {
            border: 1px solid red;
      }
        }
      }"
    `)

    expect(css({ cb: 'red' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          .cb_red {
            border: 1px solid red;
      }
        }
      }"
    `)
  })

  test('multiple shorthand + no className', () => {
    const css = (styles: any) =>
      createRuleProcessor({
        utilities: {
          extend: {
            coloredBorder: {
              shorthand: ['cbd', 'cbxxp'],
              values: ['red', 'green', 'blue'],
              transform(value) {
                return {
                  border: `1px solid ${value}`,
                }
              },
            },
          },
        },
      })
        .css(styles)
        .toCss()

    expect(css({ coloredBorder: 'red' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          .cbd_red {
            border: 1px solid red;
      }
        }
      }"
    `)

    expect(css({ cbd: 'red' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          .cbd_red {
            border: 1px solid red;
      }
        }
      }"
    `)

    expect(css({ cbxxp: 'red' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          .cbd_red {
            border: 1px solid red;
      }
        }
      }"
    `)
  })
})

/**
 * A `values` callback can find nothing to return: `theme('spacing')` finds nothing in a theme with
 * no spacing tokens. The utility threw on its first use, and a callback returning `null` failed the
 * whole config.
 */
describe('a values callback that returns nothing', () => {
  test.each([
    ['undefined', () => undefined],
    ['null', () => null],
    ['a category the theme lacks', (theme: (category: string) => unknown) => theme('spacing')],
  ])('%s leaves the value as written', (_label, values) => {
    const css = createRuleProcessor({
      presets: [],
      utilities: { space: { className: 'space', values, transform: (value: string) => ({ margin: value }) } },
    } as never)
      .css({ space: '4px' })
      .toCss()

    expect(css).toContain('margin: 4px')
  })

  test("preset-base's translateZ, in a theme with no spacing tokens", () => {
    const css = createRuleProcessor({ presets: [], utilities: fixturePreset.utilities } as never)
      .css({ translateZ: '4px' })
      .toCss()

    expect(css).toContain('--translate-z: 4px')
  })
})

/**
 * A transform can write under a condition, as a style object does: `{ _hover: { … } }`. The name
 * reached the stylesheet as written, read as an element, so `.hs_true _hover` and `.wl_true md`
 * matched nothing and what the utility set under the condition never applied, with nothing said.
 */
describe('a transform writing under a condition', () => {
  /** Returned as it is every time, so writing into it would change what every later use reads. */
  const dark = { '@media (prefers-color-scheme: dark)': { color: 'black' }, _darkHover: { color: 'white' } }
  const config = {
    utilities: {
      extend: {
        hoverStack: {
          className: 'hs',
          values: { type: 'boolean' },
          transform: () => ({ _hover: { display: 'flex' }, cursor: 'pointer' }),
        },
        wideLater: { className: 'wl', values: { type: 'boolean' }, transform: () => ({ md: { width: '100%' } }) },
        touchy: { className: 'th', values: { type: 'boolean' }, transform: () => ({ _touchy: { opacity: '0.5' } }) },
        darkHover: { className: 'dh', values: { type: 'boolean' }, transform: () => dark },
        both: {
          className: 'bo',
          values: { type: 'boolean' },
          transform: () => ({ md: { color: 'red' }, '@media (width >= 48rem)': { width: '1px' } }),
        },
      },
    },
    conditions: {
      extend: {
        touchy: { '@media (hover: hover)': { '&:hover': '@slot' }, '@media (hover: none)': { '&:active': '@slot' } },
        darkHover: ['@media (prefers-color-scheme: dark)', '&:hover'],
      },
    },
    theme: { extend: { recipes: { card: { className: 'card', base: { hoverStack: true } } } } },
  } as never

  const flat = (css: string) => css.replace(/\s+/g, ' ')
  const css = (styles: Dict) => flat(createRuleProcessor(config).css(styles).toCss())

  test('writes the selector the condition stands for', () => {
    const sheet = css({ hoverStack: true })

    expect(sheet).toContain('.hs_true:is(:hover, [data-hover]) { display: flex; }')
    expect(sheet).toContain('.hs_true { cursor: pointer; }')
    expect(sheet).not.toContain('_hover')
  })

  test('and the at-rule', () => {
    expect(css({ wideLater: true })).toContain('@media (width >= 48rem) { .wl_true { width: 100%; } }')
  })

  test('inside a condition the style writes', () => {
    expect(css({ md: { hoverStack: true } })).toContain(
      '@media (width >= 48rem) { .md\\:hs_true:is(:hover, [data-hover]) { display: flex; } }',
    )
  })

  test('a condition holding in more than one way, under each', () => {
    const sheet = css({ touchy: true })

    expect(sheet).toContain('@media (hover: hover) { .th_true:hover { opacity: 0.5; } }')
    expect(sheet).toContain('@media (hover: none) { .th_true:active { opacity: 0.5; } }')
  })

  test('a selector within an at-rule, nested', () => {
    const sheet = css({ darkHover: true })

    expect(sheet).toContain('@media (prefers-color-scheme: dark) { .dh_true:hover { color: white; } }')
    expect(sheet).toContain('@media (prefers-color-scheme: dark) { .dh_true { color: black; } }')
  })

  test('merged with the same at-rule written out', () => {
    expect(css({ both: true })).toContain('@media (width >= 48rem) { .bo_true { color: red; width: 1px; } }')
  })

  test('in a recipe', () => {
    const sheet = flat(createRuleProcessor(config).recipe('card', {})!.toCss())

    expect(sheet).toContain('.card:is(:hover, [data-hover]) { display: flex; }')
  })

  test('in global css', () => {
    const sheet = createGeneratorContext(config).createSheet()
    sheet.processGlobalCss({ '.x': { hoverStack: true } })

    expect(flat(sheet.toCss())).toContain('.x:is(:hover, [data-hover]) { display: flex; }')
  })

  test('leaves what the transform returned as it was', () => {
    css({ darkHover: true, md: { darkHover: true } })

    expect(dark).toEqual({ '@media (prefers-color-scheme: dark)': { color: 'black' }, _darkHover: { color: 'white' } })
  })
})
