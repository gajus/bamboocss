import { fixturePreset } from '@bamboocss/fixture'
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
