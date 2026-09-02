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
