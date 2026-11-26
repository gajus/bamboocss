import { describe, expect, test } from 'vitest'
import { mergeConfigs } from '../src/merge-config'

/**
 * `theme.variants` carries an `extend` of its own, and `mergeExtensions` only unwraps the
 * level it is handed — so merging `theme` leaves a nested `extend` sitting there as literal
 * data. It is merged explicitly against the source configs instead.
 *
 * This got the behaviour for free while it was a top-level `themes`, by being its own key.
 * Moving it under `theme` is what made it a hand-written path, which is the reason to pin it.
 */
const merge = (...configs: object[]) => mergeConfigs(configs.map((c, i) => ({ name: `c${i}`, ...c }) as never))

const variant = (value: string) => ({ tokens: { colors: { primary: { value } } } })

describe('theme.variants merging', () => {
  test('collects variants declared by different configs', () => {
    const result = merge(
      { theme: { variants: { dark: variant('black') } } },
      {
        theme: { variants: { light: variant('white') } },
      },
    )

    expect(Object.keys(result.theme!.variants!)).toEqual(expect.arrayContaining(['dark', 'light']))
  })

  test('a later config wins for a variant they both declare', () => {
    const result = merge(
      { theme: { variants: { dark: variant('black') } } },
      {
        theme: { variants: { dark: variant('#111') } },
      },
    )

    expect(result.theme!.variants!.dark).toEqual(variant('#111'))
  })

  /** The nested `extend`, which is the part `mergeExtensions` cannot reach on its own. */
  test('unwraps a nested extend rather than leaving it as data', () => {
    const result = merge(
      { theme: { variants: { dark: variant('black') } } },
      {
        theme: { variants: { extend: { sepia: variant('#704214') } } },
      },
    )

    expect(result.theme!.variants).not.toHaveProperty('extend')
    expect(result.theme!.variants!.sepia).toEqual(variant('#704214'))
    expect(result.theme!.variants!.dark).toEqual(variant('black'))
  })

  // `theme.extend.variants` is typed as an extension of the variants, beside `theme.variants.extend`.
  // The variants were merged from `theme.variants` alone, which dropped a variant declared this way.
  test('takes a variant declared under theme.extend', () => {
    const result = merge(
      { theme: { variants: { dark: variant('black') } } },
      {
        theme: { extend: { variants: { sepia: variant('#704214') } } },
      },
    )

    expect(result.theme!.variants!.sepia).toEqual(variant('#704214'))
    expect(result.theme!.variants!.dark).toEqual(variant('black'))
  })

  test('extends a variant another config declares, under theme.extend', () => {
    const result = merge(
      { theme: { variants: { dark: variant('black') } } },
      {
        theme: { extend: { variants: { dark: { tokens: { colors: { muted: { value: '#555' } } } } } } },
      },
    )

    expect(result.theme!.variants!.dark!.tokens).toEqual({
      colors: { primary: { value: 'black' }, muted: { value: '#555' } },
    })
  })

  test('combines theme.extend.variants with a theme.variants.extend in one config', () => {
    const result = merge({
      theme: {
        variants: { extend: { dark: variant('black') } },
        extend: { variants: { sepia: variant('#704214') } },
      },
    })

    expect(Object.keys(result.theme!.variants!).sort()).toEqual(['dark', 'sepia'])
  })

  test('leaves no empty variants key when nobody declares one', () => {
    const result = merge({ theme: { tokens: { colors: { red: { value: 'red' } } } } }, {})

    expect(result.theme).not.toHaveProperty('variants')
  })

  test('does not disturb the rest of the theme', () => {
    const result = merge(
      { theme: { tokens: { colors: { red: { value: 'red' } } } } },
      {
        theme: { variants: { dark: variant('black') } },
      },
    )

    expect(result.theme!.tokens!.colors).toHaveProperty('red')
    expect(result.theme!.variants).toHaveProperty('dark')
  })
})
