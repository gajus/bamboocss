import { createGeneratorContext, fixturePreset, withoutMergeCodes } from '@bamboocss/fixture'
import type { Dict } from '@bamboocss/types'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'
import { cascadeOrder } from './cascade-oracle'
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
          ._NUnYvp\\:cb_red {
            border: 1px solid red;
      }
        }
      }"
    `)

    expect(css({ cb: 'red' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._NUnYvp\\:cb_red {
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
          ._NUnYvp\\:cbd_red {
            border: 1px solid red;
      }
        }
      }"
    `)

    expect(css({ cbd: 'red' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._NUnYvp\\:cbd_red {
            border: 1px solid red;
      }
        }
      }"
    `)

    expect(css({ cbxxp: 'red' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._NUnYvp\\:cbd_red {
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
  const css = (styles: Dict) => withoutMergeCodes(flat(createRuleProcessor(config).css(styles).toCss()))

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

/**
 * What a transform writes under a condition ranks as the condition does written in a style. An
 * at-rule ranked as no condition: `{ md: { width: '100%' } }` sat beside a bare `width` of the
 * same specificity, and lost to it at `md` whichever of the two was written first.
 */
describe('a condition a transform writes ranks as written in a style', () => {
  const config = {
    utilities: {
      extend: {
        wideLater: { className: 'wl', values: { type: 'boolean' }, transform: () => ({ md: { width: '100%' } }) },
        wideSpelled: {
          className: 'ws',
          values: { type: 'boolean' },
          transform: () => ({ '@media (width >= 48rem)': { width: '100%' } }),
        },
        darkHover: {
          className: 'dh',
          values: { type: 'boolean' },
          transform: () => ({ _darkHover: { color: 'white' } }),
        },
        touchy: { className: 'th', values: { type: 'boolean' }, transform: () => ({ _touchy: { color: 'white' } }) },
      },
    },
    conditions: {
      extend: {
        touchy: { '@media (hover: hover)': { '&:hover': '@slot' }, '@media (hover: none)': { '&:active': '@slot' } },
        darkHover: ['@media (prefers-color-scheme: dark)', '&:hover'],
      },
    },
  } as never

  const sheet = (styles: Dict) => withoutMergeCodes(createRuleProcessor(config).css(styles).toCss())

  /** The condition part of each rule's sublayer, `c1` of `s020-c1-p3000`, by its selector. */
  const conditionOf = (css: string) => {
    const found = new Map<string, string>()
    postcss.parse(css).walkAtRules('layer', (layer) => {
      if (!layer.nodes || (layer.parent as postcss.AtRule | undefined)?.params !== 'utilities') return
      layer.walkRules((rule) => void found.set(rule.selector, layer.params.split('-')[1]!))
    })
    return found
  }

  test('an at-rule, written by name or spelled out, over a bare declaration', () => {
    for (const utility of ['wideLater', 'wideSpelled']) {
      for (const styles of [
        { w: '50%', [utility]: true },
        { [utility]: true, w: '50%' },
      ]) {
        expect(cascadeOrder(sheet(styles)).width!.at(-1), JSON.stringify(styles)).toMatch(/^@media .*_true$/)
      }
    }
  })

  test('in the sublayer the condition has written in a style', () => {
    const cases: Array<[Dict, string, string]> = [
      [{ wideLater: true, md: { color: 'red' } }, '.wl_true', '.md\\:c_red'],
      [
        { _hover: { wideLater: true }, md: { _hover: { color: 'red' } } },
        '.hover\\:wl_true:is(:hover, [data-hover])',
        '.md\\:hover\\:c_red:is(:hover, [data-hover])',
      ],
      [{ darkHover: true, _darkHover: { bg: 'red' } }, '.dh_true:hover', '.darkHover\\:bg_red:hover'],
      [{ touchy: true, _touchy: { bg: 'red' } }, '.th_true:active', '.touchy\\:bg_red:active'],
    ]
    for (const [styles, transformed, written] of cases) {
      const conditions = conditionOf(sheet(styles))

      expect(conditions.get(transformed), JSON.stringify(styles)).toBeDefined()
      expect(conditions.get(transformed), JSON.stringify(styles)).toBe(conditions.get(written))
    }
  })
})
