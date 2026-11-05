import { createRuleProcessor, createColorMixTransform } from '@bamboocss/fixture'
import type { Dict } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'

describe('color-mix', () => {
  const api = createRuleProcessor({
    utilities: {
      background: {
        shorthand: 'bg',
        className: 'bg',
        values: 'colors',
        transform: createColorMixTransform('background'),
      },
      gradientFrom: {
        className: 'from',
        values: 'colors',
        transform: createColorMixTransform('--gradient-from'),
      },
      WebkitTextFillColor: {
        className: 'wktf-c',
        values: 'colors',
        transform: createColorMixTransform('WebkitTextFillColor'),
      },
    },
    theme: {
      extend: {
        tokens: {
          opacity: {
            half: { value: 0.5 },
            subtle: { value: 0.07 },
          },
        },
      },
    },
  })

  const css = (styles: Dict) => {
    const result = api.clone().css(styles)
    return { className: result.getClassNames(), css: result.toCss() }
  }

  test('native CSS color', () => {
    expect(css({ bg: 'red/30' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_red\\/30",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_red\\/30 {
            background: color-mix(in srgb, red 30%, transparent);
      }
        }
      }",
      }
    `)
  })

  test('native CSS color', () => {
    expect(css({ bg: 'red/30' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_red\\/30",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_red\\/30 {
            background: color-mix(in srgb, red 30%, transparent);
      }
        }
      }",
      }
    `)
  })

  test('config token color', () => {
    expect(css({ bg: 'red.300/30' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_red\\.300\\/30",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_red\\.300\\/30 {
            background: color-mix(in srgb, var(--colors-red-300) 30%, transparent);
      }
        }
      }",
      }
    `)
  })

  test('decimal opacity', () => {
    expect(css({ bg: 'red/0.33' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_red\\/0\\.33",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_red\\/0\\.33 {
            background: color-mix(in srgb, red 0.33%, transparent);
      }
        }
      }",
      }
    `)
  })

  test('percent opacity', () => {
    expect(css({ bg: 'red/33' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_red\\/33",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_red\\/33 {
            background: color-mix(in srgb, red 33%, transparent);
      }
        }
      }",
      }
    `)
  })

  test('inside var', () => {
    expect(css({ gradientFrom: 'red/33' })).toMatchInlineSnapshot(`
      {
        "className": [
          "from_red\\/33",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          .from_red\\/33 {
            --gradient-from: color-mix(in srgb, red 33%, transparent);
      }
        }
      }",
      }
    `)
  })

  test('in token fn', () => {
    expect(css({ bg: 'token(colors.pink.400/30)' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_token\\(colors\\.pink\\.400\\/30\\)",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_token\\(colors\\.pink\\.400\\/30\\) {
            background: color-mix(in srgb, var(--colors-pink-400) 30%, transparent);
      }
        }
      }",
      }
    `)
  })

  /**
   * The retired curly spelling, which used to mean the same as the `token()` above.
   *
   * An error rather than a literal: left alone it is silent in both directions — the declaration
   * is dropped here, and a curly value in a *token* emits its text into the stylesheet. Neither
   * reports itself, and neither is valid css.
   *
   * Safe to throw on because the spelling was never available for anything else: until it was
   * removed, `{…}` in a value was consumed unconditionally, so no literal `{a.b}` could have
   * survived to mean itself.
   */
  test('a curly reference fails rather than emitting a literal', () => {
    expect(() => css({ color: '{colors.pink.400/30}' })).toThrow(/retired token reference syntax/)
  })

  test('the error names the replacement', () => {
    expect(() => css({ color: '1px solid {colors.red.300}' })).toThrow(/token\(colors\.red\.300\)/)
  })

  /** Braces that are not a reference are left alone — a `content` string, most obviously. */
  test('a brace that is not a reference still passes through', () => {
    expect(() => css({ content: '"{ a: 1 }"' })).not.toThrow()
  })

  /**
   * The retired fallback form. A pattern that needs "this token, or this literal" now asks
   * `PatternHelpers.token()` and emits the answer, so nothing defers the question into a string.
   */
  test('a fallback reference fails rather than emitting a literal', () => {
    expect(() => css({ color: 'token(colors.pink.400, red)' })).toThrow(/retired .*token\(path, fallback\).* form/)
  })

  // below are invalid cases

  test('wrong format', () => {
    expect(css({ bg: 'xx1x//30' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_xx1x\\/\\/30",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_xx1x\\/\\/30 {
            background: xx1x//30;
      }
        }
      }",
      }
    `)
  })

  test('wrong opacity', () => {
    expect(css({ bg: 'red/abc' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_red\\/abc",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_red\\/abc {
            background: red/abc;
      }
        }
      }",
      }
    `)
  })

  test('wrong number format', () => {
    expect(css({ bg: 'red/0,4' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_red\\/0\\,4",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_red\\/0\\,4 {
            background: red/0,4;
      }
        }
      }",
      }
    `)
  })

  test('invalid number format', () => {
    expect(css({ bg: 'red/0..,4' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_red\\/0\\.\\.\\,4",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_red\\/0\\.\\.\\,4 {
            background: red/0..,4;
      }
        }
      }",
      }
    `)
  })

  test('opacity token', () => {
    expect(css({ bg: 'red/half' })).toMatchInlineSnapshot(`
      {
        "className": [
          "bg_red\\/half",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_red\\/half {
            background: color-mix(in srgb, red 50%, transparent);
      }
        }
      }",
      }
    `)
  })

  /** `0.07 * 100` is `7.000000000000001` in floating point, which used to reach the stylesheet. */
  test('opacity token without float noise', () => {
    expect(css({ bg: 'red/subtle' }).css).toContain('color-mix(in srgb, red 7%, transparent)')
  })

  test('WebkitTextFillColor with color token', () => {
    expect(css({ WebkitTextFillColor: 'red.300' })).toMatchInlineSnapshot(`
      {
        "className": [
          "wktf-c_red\\.300",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          .wktf-c_red\\.300 {
            -webkit-text-fill-color: var(--colors-red-300);
      }
        }
      }",
      }
    `)
  })
})

/**
 * `color-mix()` takes a percentage from 0% to 100%, and refuses one outside: `red.500/150` wrote
 * `color-mix(in srgb, var(--colors-red-500) 150%, transparent)`, which reads a variable and so passed
 * every check the sheet makes, while the browser dropped it. Out of range, the modifier is no mix:
 * the value is written as it is, which the sheet reports as no valid colour.
 */
describe('an opacity outside 0 to 100', () => {
  const written = (color: string) => {
    const css = createRuleProcessor().css({ color }).toCss()
    return css.match(/color: ([^;]+);/)?.[1]
  }

  test('is no mix', () => {
    expect(written('red.500/150')).toBe('red.500/150')
    expect(written('red.500/-5')).toBe('red.500/-5')
    expect(written('red.500/100.5')).toBe('red.500/100.5')
  })

  test('the bounds are', () => {
    expect(written('red.500/0')).toBe('color-mix(in srgb, var(--colors-red-500) 0%, transparent)')
    expect(written('red.500/100')).toBe('color-mix(in srgb, var(--colors-red-500) 100%, transparent)')
  })

  test('nor an opacity token holding more than 1', () => {
    const css = createRuleProcessor({ theme: { extend: { tokens: { opacity: { over: { value: 1.5 } } } } } })
      .css({ color: 'red.500/over' })
      .toCss()
    expect(css).toContain('color: red.500/over;')
  })
})
