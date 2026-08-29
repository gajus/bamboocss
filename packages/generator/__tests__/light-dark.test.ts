import { createContext } from '@bamboocss/fixture'
import type { Config } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'

import { assertValidLightDark } from './light-dark-arity'

const tokenCss = (config?: Config) => {
  const ctx = createContext(config)
  const sheet = ctx.createSheet()
  ctx.appendCssOfType('tokens', sheet)
  // Every sheet this suite produces, not just the ones a test reads. See the helper's header:
  // `toContain('light-dark(')` passes on an invalid three-argument call.
  return assertValidLightDark(sheet.toCss())
}

// Not `eject`: the fold is gated on `_osDark` resolving to its media query, and ejecting
// leaves the condition undefined.
const semantic = (colors: Record<string, { value: unknown }>, config?: Config): Config =>
  ({ ...config, theme: { extend: { semanticTokens: { colors } } } }) as Config

describe('light-dark()', () => {
  test('folds a base/_osDark pair and drops the media block', () => {
    const css = tokenCss(semantic({ panel: { value: { base: '#ffffff', _osDark: '#131211' } } }))

    expect(css).toContain('--colors-panel: light-dark(#ffffff, #131211)')
    expect(css).not.toContain('prefers-color-scheme: dark')
  })

  /**
   * `light-dark()` returns the light value unless `color-scheme` names both, so a sheet that
   * folds without declaring it is a sheet where dark mode silently never engages.
   */
  test('declares color-scheme alongside the folded tokens', () => {
    const css = tokenCss(semantic({ panel: { value: { base: '#ffffff', _osDark: '#131211' } } }))

    expect(css).toContain('color-scheme: light dark')
  })

  test('declares it only when something actually folded', () => {
    expect(tokenCss(semantic({ panel: { value: '#ffffff' } }))).not.toContain('color-scheme')
  })

  /**
   * A list folds per item, so what makes these two unfoldable is that the arms disagree about
   * how many items there are. Nothing can pair a two-shadow light value with a one-shadow dark
   * one, and `light-dark()` cannot express the difference between "two shadows" and "one".
   */
  test('leaves a token alone when the light arm has more list items than the dark', () => {
    const css = tokenCss({
      theme: {
        extend: {
          semanticTokens: {
            shadows: {
              sm: {
                value: {
                  base: '0 1px 2px rgb(16 19 26 / 0.06), 0 1px 3px rgb(16 19 26 / 0.04)',
                  _osDark: '0 1px 2px rgb(0 0 0 / 0.3)',
                },
              },
            },
          },
        },
      },
    } as Config)

    expect(css).not.toContain('light-dark(')
    expect(css).toContain('prefers-color-scheme: dark')
  })

  test('leaves a token alone when the dark arm has more list items than the light', () => {
    const css = tokenCss({
      theme: {
        extend: {
          semanticTokens: {
            shadows: {
              sm: { value: { base: '0 1px 2px rgb(0 0 0 / 0.1)', _osDark: '0 1px 2px red, 0 2px 4px blue' } },
            },
          },
        },
      },
    } as Config)

    expect(css).not.toContain('light-dark(')
    expect(css).toContain('prefers-color-scheme: dark')
  })

  /**
   * The guard is depth-aware, not a `includes(',')`. Legacy `rgb()` notation carries its own
   * commas and is a single value, so it must still fold.
   */
  test('still folds a value whose commas are inside a function', () => {
    const css = tokenCss(semantic({ panel: { value: { base: 'rgb(16, 19, 26)', _osDark: 'rgb(255, 255, 255)' } } }))

    expect(css).toContain('--colors-panel: light-dark(rgb(16, 19, 26), rgb(255, 255, 255))')
  })

  /** A token that cannot fold must not suppress folding for one that can. */
  test('folds the foldable token and leaves the mismatched token on the media block', () => {
    const css = tokenCss({
      theme: {
        extend: {
          semanticTokens: {
            colors: { panel: { value: { base: '#ffffff', _osDark: '#131211' } } },
            shadows: { sm: { value: { base: '0 1px 2px red, 0 2px 4px blue', _osDark: '0 1px 2px black' } } },
          },
        },
      },
    } as Config)

    expect(css).toContain('--colors-panel: light-dark(#ffffff, #131211)')
    expect(css).toContain('prefers-color-scheme: dark')
    expect(css).toContain('color-scheme: light dark')
  })

  /**
   * The light arm and an `@media (prefers-color-scheme: light)` block would both be in play
   * for one var, and the block wins on order — so the arm would be dead code. Three-way
   * tokens keep the mechanism they had.
   */
  test('leaves a token carrying _osLight alone', () => {
    const css = tokenCss(semantic({ ink: { value: { base: 'red', _osDark: 'blue', _osLight: 'green' } } }))

    expect(css).not.toContain('light-dark(')
    expect(css).toContain('prefers-color-scheme: dark')
    expect(css).toContain('prefers-color-scheme: light')
  })

  /**
   * `_dark` is a class selector, not a media query. It stays a rule of its own — an explicit
   * toggle sets `color-scheme` on the subtree rather than restating each token.
   */
  test('leaves a selector condition alone', () => {
    const css = tokenCss(semantic({ ink: { value: { base: '#131211', _dark: '#ffffff' } } }))

    expect(css).not.toContain('light-dark(')
    expect(css).toContain('.dark')
  })

  /**
   * `_osDark` is a configurable condition, not a keyword. Pointed at a selector it no longer
   * means "the OS prefers dark", and `light-dark()` cannot express a selector — so folding it
   * would silently rewrite the mechanism the user chose.
   */
  test('leaves _osDark alone when it has been redefined as a selector', () => {
    const css = tokenCss(
      semantic({ panel: { value: { base: '#ffffff', _osDark: '#131211' } } }, {
        conditions: { extend: { osDark: '[data-os=dark] &' } },
      } as Config),
    )

    expect(css).not.toContain('light-dark(')
    expect(css).not.toContain('color-scheme')
    expect(css).toContain('[data-os=dark]')
  })

  test('folds only the paired vars, leaving the rest of the dark block standing', () => {
    const css = tokenCss(
      semantic({
        panel: { value: { base: '#ffffff', _osDark: '#131211' } },
        ink: { value: { base: 'red', _osDark: 'blue', _osLight: 'green' } },
      }),
    )

    expect(css).toContain('--colors-panel: light-dark(#ffffff, #131211)')
    expect(css).toContain('prefers-color-scheme: dark')
    expect(css).toContain('--colors-ink: blue')
  })
})

/**
 * `light-dark() = light-dark(<color>, <color>)` — CSS Color 5. It is not a general conditional
 * and cannot carry a shadow, a border shorthand or a length.
 *
 * This fold used to hand it whole token values regardless of category, so a single-shadow
 * `_osDark` token emitted `light-dark(0 1px 2px red, 0 1px 2px black)` and every element
 * carrying it rendered with `box-shadow: none`; a `sizes` token emitted `light-dark(4px, 8px)`
 * and computed `0px`. Verified in Chrome, both silent — same symptom as the arity bug, and
 * the arity guard could not see it because two arguments were exactly what it got.
 *
 * The fix folds the parts that differ rather than the value, which is also what finally makes
 * a list foldable: the commas stay in the value where they parse instead of splatting into
 * the function's argument list.
 */
describe('light-dark() folds at the color, not the value', () => {
  const shadow = (light: string, dark: string, category = 'shadows') =>
    tokenCss({
      theme: { extend: { semanticTokens: { [category]: { tk: { value: { base: light, _osDark: dark } } } } } },
    } as Config)

  test('folds a single shadow at its color component', () => {
    const css = shadow('0 1px 2px red', '0 1px 2px black')

    expect(css).toContain('--shadows-tk: 0 1px 2px light-dark(red, black)')
    expect(css).not.toContain('prefers-color-scheme: dark')
  })

  test('folds every item of a shadow list independently', () => {
    const css = shadow('0 1px 2px red, 0 2px 4px blue', '0 1px 2px black, 0 2px 4px white')

    expect(css).toContain('--shadows-tk: 0 1px 2px light-dark(red, black), 0 2px 4px light-dark(blue, white)')
    expect(css).not.toContain('prefers-color-scheme: dark')
  })

  /** The shape a real elevation token takes: two shadows, alpha colors, function-internal commas. */
  test('folds a realistic two-part elevation token', () => {
    const css = shadow(
      '0 1px 2px rgb(16 19 26 / 0.06), 0 1px 3px rgb(16 19 26 / 0.04)',
      '0 1px 2px rgb(0 0 0 / 0.3), 0 1px 3px rgb(0 0 0 / 0.2)',
    )

    expect(css).toContain(
      '--shadows-tk: 0 1px 2px light-dark(rgb(16 19 26 / 0.06), rgb(0 0 0 / 0.3)), ' +
        '0 1px 3px light-dark(rgb(16 19 26 / 0.04), rgb(0 0 0 / 0.2))',
    )
    expect(css).not.toContain('prefers-color-scheme: dark')
  })

  test('keeps a leading keyword outside the function', () => {
    expect(shadow('inset 0 1px 2px red', 'inset 0 1px 2px black')).toContain(
      '--shadows-tk: inset 0 1px 2px light-dark(red, black)',
    )
  })

  test('folds a border shorthand at its color component', () => {
    expect(shadow('1px solid red', '1px solid black', 'borders')).toContain(
      '--borders-tk: 1px solid light-dark(red, black)',
    )
  })

  test('folds a token reference, which resolves to a color var', () => {
    const css = tokenCss({
      theme: {
        extend: {
          semanticTokens: {
            shadows: {
              tk: {
                value: { base: '0 1px 2px token(colors.red.300)', _osDark: '0 1px 2px token(colors.red.500)' },
              },
            },
          },
        },
      },
    } as Config)

    expect(css).toContain('--shadows-tk: 0 1px 2px light-dark(var(--colors-red-300), var(--colors-red-500))')
  })

  /**
   * The regression that motivated the color gate. A length is not a color, and folding one
   * produced CSS the browser drops without a word.
   */
  test('leaves a token whose differing part is a length alone', () => {
    const css = shadow('4px', '8px', 'sizes')

    expect(css).not.toContain('light-dark(')
    expect(css).toContain('--sizes-tk: 8px')
    expect(css).toContain('prefers-color-scheme: dark')
  })

  test('leaves a shadow whose geometry differs alone', () => {
    const css = shadow('0 1px 2px red', '0 4px 8px black')

    expect(css).not.toContain('light-dark(')
    expect(css).toContain('prefers-color-scheme: dark')
  })

  /** Component counts have to line up: one arm naming a color and the other not is not an edit. */
  test('leaves a shadow that omits its color in one arm alone', () => {
    const css = shadow('0 1px 2px red', '0 1px 2px')

    expect(css).not.toContain('light-dark(')
    expect(css).toContain('prefers-color-scheme: dark')
  })

  /**
   * A `var()` says nothing about its own type. Only a reference bamboo emitted for a `colors`
   * token is provably a color — anything else is the silent-drop case again.
   */
  test('leaves a shadow referencing an unknown custom property alone', () => {
    const css = shadow('0 1px 2px var(--brand-light)', '0 1px 2px var(--brand-dark)')

    expect(css).not.toContain('light-dark(')
    expect(css).toContain('prefers-color-scheme: dark')
  })

  /**
   * A `colors` token is a color whatever it is spelled as, so the whole-value path still folds
   * a raw `var()` the component walk could never prove. This is the capability the gate must
   * not cost.
   */
  test('still folds a colors token pointed at an unknown custom property', () => {
    const css = tokenCss(semantic({ brand: { value: { base: 'var(--brand-light)', _osDark: 'var(--brand-dark)' } } }))

    expect(css).toContain('--colors-brand: light-dark(var(--brand-light), var(--brand-dark))')
  })

  /** Quote-aware: a font stack's commas are not list separators, and a family is not a color. */
  test('leaves a quoted font stack alone', () => {
    const css = shadow('"Foo, Bar", serif', '"Baz, Qux", serif', 'fonts')

    expect(css).not.toContain('light-dark(')
    expect(css).toContain('prefers-color-scheme: dark')
  })
})
