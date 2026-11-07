import { createContext, withoutMergeCodes } from '@bamboocss/fixture'
import type { Config } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { generateThemes } from '../src/artifacts/js/themes'

/**
 * A theme's tokens, `[data-bamboo-theme=pastel]`, under a condition such as `.dark &`.
 *
 * The condition was compounded onto the theme's root, `[data-bamboo-theme=pastel].dark`, and so
 * held only where the theme attribute and the dark class share an element. A theme in a page put in
 * dark mode on `<html>` kept its light values, and a dark panel inside the theme took the default
 * dark values instead of the theme's.
 */
const themed = (conditions: Config['conditions'], value: unknown, variants: Record<string, unknown> = {}) =>
  createContext({
    presets: [],
    conditions,
    theme: {
      breakpoints: { md: '768px' },
      semanticTokens: { colors: { text: { value: { base: '#000', _dark: '#fff' } } } },
      variants: { pastel: { semanticTokens: { colors: { text: { value } } } }, ...variants },
    },
    staticCss: { themes: ['*'] },
    outdir: '',
  } as Config)

/** The rules after the default ones, which the change leaves as they were. */
const themeCss = (ctx: ReturnType<typeof themed>) => {
  const sheet = ctx.createSheet()
  ctx.appendCssOfType('tokens', sheet)
  const css = sheet.toCss()
  return css.slice(css.indexOf('[data-bamboo-theme=pastel] {'))
}

const value = { base: '#111', _dark: '#eee' }

describe('a parent condition inside a theme', () => {
  // Inside it, on the root of a theme nested in this one, the rule is no more specific than that
  // root: the nested theme's own values win there, and this one's fill in what it leaves out.
  test('meets the theme root above it, on it and inside it', () => {
    expect(themeCss(themed({ dark: '.dark &' }, value))).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        .dark [data-bamboo-theme=pastel], [data-bamboo-theme=pastel].dark, [data-bamboo-theme=pastel] .dark:not([data-bamboo-theme]), [data-bamboo-theme=pastel] :where([data-bamboo-theme].dark) {
          --colors-text: #eee
          }
      }"
    `)
  })

  // Each selector in the list meets the root on its own, and one written on the element itself,
  // `&.dark`, is one of those already.
  test('for each selector in a list', () => {
    const dark = '[data-theme=dark] &, .dark &, &.dark, &[data-theme=dark]'
    expect(themeCss(themed({ dark }, value))).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        [data-theme=dark] [data-bamboo-theme=pastel], [data-bamboo-theme=pastel][data-theme=dark], [data-bamboo-theme=pastel] [data-theme=dark]:not([data-bamboo-theme]), [data-bamboo-theme=pastel] :where([data-bamboo-theme][data-theme=dark]), .dark [data-bamboo-theme=pastel], [data-bamboo-theme=pastel].dark, [data-bamboo-theme=pastel] .dark:not([data-bamboo-theme]), [data-bamboo-theme=pastel] :where([data-bamboo-theme].dark) {
          --colors-text: #eee
          }
      }"
    `)
  })

  test('which may quote a comma or an `&`', () => {
    expect(themeCss(themed({ dark: '[data-mode="dark, dim & more"] &' }, value))).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        [data-mode="dark, dim & more"] [data-bamboo-theme=pastel], [data-bamboo-theme=pastel][data-mode="dark, dim & more"], [data-bamboo-theme=pastel] [data-mode="dark, dim & more"]:not([data-bamboo-theme]), [data-bamboo-theme=pastel] :where([data-bamboo-theme][data-mode="dark, dim & more"]) {
          --colors-text: #eee
          }
      }"
    `)
  })

  // `&body.print` is no selector, and `&.app .dark` would put the `.app` on the root.
  test('keeps a type, or a selector of several compounds, whole on the root and inside it', () => {
    expect(themeCss(themed({ dark: 'body.print &' }, value))).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        body.print [data-bamboo-theme=pastel], [data-bamboo-theme=pastel]:is(body.print), [data-bamboo-theme=pastel] body.print:not([data-bamboo-theme]), [data-bamboo-theme=pastel] :where([data-bamboo-theme]:is(body.print)) {
          --colors-text: #eee
          }
      }"
    `)
    expect(themeCss(themed({ dark: '.app .dark &' }, value))).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        .app .dark [data-bamboo-theme=pastel], [data-bamboo-theme=pastel]:is(.app .dark), [data-bamboo-theme=pastel] :is(.app .dark):not([data-bamboo-theme]), [data-bamboo-theme=pastel] :where([data-bamboo-theme]:is(.app .dark)) {
          --colors-text: #eee
          }
      }"
    `)
  })

  test('nests anything else as it is written', () => {
    expect(themeCss(themed({ dark: '.dark > &' }, value)), 'a combinator: above it alone').toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        .dark > [data-bamboo-theme=pastel] {
          --colors-text: #eee
          }
      }"
    `)
    expect(themeCss(themed({ dark: '.dark & .panel' }, value)), 'around it').toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        .dark [data-bamboo-theme=pastel] .panel {
          --colors-text: #eee
          }
      }"
    `)
    expect(themeCss(themed({ hover: '&:hover' }, { base: '#111', _hover: '#eee' })), 'on it').toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        [data-bamboo-theme=pastel]:hover {
          --colors-text: #eee
          }
      }"
    `)
  })

  // A pseudo-element takes no descendant and goes in no `:is()`: one invalid form would have the
  // browser drop the rule, every form with it.
  test('compounds a parent naming a pseudo-element onto the root, as it was', () => {
    expect(themeCss(themed({ dark: '.dark::part(x) &' }, value))).toContain(
      '[data-bamboo-theme=pastel].dark::part(x) {',
    )
    expect(themeCss(themed({ dark: '[data-x="a::b"] &' }, value)), 'not one in a quoted value').toContain(
      '[data-x="a::b"] [data-bamboo-theme=pastel],',
    )
  })

  // Inside a theme it would declare on each element what that element inherits.
  test('meets a universal parent from above alone', () => {
    expect(themeCss(themed({ dark: '* &' }, value))).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        * [data-bamboo-theme=pastel] {
          --colors-text: #eee
          }
      }"
    `)
  })

  test('and each condition after it', () => {
    const conditions = { dark: '.dark &', hc: '.hc &' }
    expect(themeCss(themed(conditions, { base: '#111', _dark: { _hc: '#eee' } }))).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        .hc .dark [data-bamboo-theme=pastel], .dark [data-bamboo-theme=pastel].hc, .dark [data-bamboo-theme=pastel] .hc:not([data-bamboo-theme]), .dark [data-bamboo-theme=pastel] :where([data-bamboo-theme].hc), .hc [data-bamboo-theme=pastel].dark, [data-bamboo-theme=pastel].dark.hc, [data-bamboo-theme=pastel].dark .hc:not([data-bamboo-theme]), [data-bamboo-theme=pastel].dark :where([data-bamboo-theme].hc), .hc [data-bamboo-theme=pastel] .dark:not([data-bamboo-theme]), [data-bamboo-theme=pastel] .dark:not([data-bamboo-theme]).hc, [data-bamboo-theme=pastel] .dark:not([data-bamboo-theme]) .hc:not([data-bamboo-theme]), [data-bamboo-theme=pastel] .dark:not([data-bamboo-theme]) :where([data-bamboo-theme].hc), .hc [data-bamboo-theme=pastel] :where([data-bamboo-theme].dark), [data-bamboo-theme=pastel] :where([data-bamboo-theme].dark).hc, [data-bamboo-theme=pastel] :where([data-bamboo-theme].dark) .hc:not([data-bamboo-theme]), [data-bamboo-theme=pastel] :where([data-bamboo-theme].dark) :where([data-bamboo-theme].hc) {
          --colors-text: #eee
              }
      }"
    `)
    expect(themeCss(themed(conditions, { base: '#111', _dark: { base: '#eee', md: '#ddd' } }))).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        .dark [data-bamboo-theme=pastel], [data-bamboo-theme=pastel].dark, [data-bamboo-theme=pastel] .dark:not([data-bamboo-theme]), [data-bamboo-theme=pastel] :where([data-bamboo-theme].dark) {
          --colors-text: #eee
          }

        @media (width >= 48rem) {
          .dark [data-bamboo-theme=pastel], [data-bamboo-theme=pastel].dark, [data-bamboo-theme=pastel] .dark:not([data-bamboo-theme]), [data-bamboo-theme=pastel] :where([data-bamboo-theme].dark) {
            --colors-text: #ddd
                  }
              }
      }"
    `)
  })

  // Each form is as specific as `.dark` and the root together, so it wins over the theme's own
  // values however the token orders its conditions.
  test('whatever the order the token writes its conditions in', () => {
    const ctx = themed({ dark: '.dark &' }, { _dark: '#eee', base: '#111' })
    const sheet = ctx.createSheet()
    ctx.appendCssOfType('tokens', sheet)
    const css = sheet.toCss()
    // The theme's dark values come first, and still outrank its root.
    expect(css.indexOf('[data-bamboo-theme=pastel].dark')).toBeLessThan(css.indexOf('[data-bamboo-theme=pastel] {'))
    expect(css).toContain('.dark [data-bamboo-theme=pastel], [data-bamboo-theme=pastel].dark,')
  })

  test('leaves a media query wrapping the root', () => {
    const css = themeCss(themed({ osDark: '@media (prefers-color-scheme: dark)' }, { base: '#111', _osDark: '#eee' }))
    expect(css).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
          --colors-text: #111
      }

        @media (prefers-color-scheme: dark) {
          [data-bamboo-theme=pastel] {
            --colors-text: #eee
              }
          }
      }"
    `)
  })

  // A condition the project named like a theme is none, and its tokens are written as any other's.
  // They were dropped, with those of every theme `staticCss.themes` leaves out.
  test('is not one of a condition named like a theme', () => {
    const ctx = createContext({
      presets: [],
      conditions: { themeDim: '.dim &', dark: '.dark &' },
      theme: {
        semanticTokens: { colors: { text: { value: { base: '#000', _themeDim: { base: '#333', _dark: '#444' } } } } },
      },
      outdir: '',
    } as Config)
    expect(ctx.conditions.isThemeCondition('_themeDim')).toBe(false)
    const sheet = ctx.createSheet()
    ctx.appendCssOfType('tokens', sheet)
    expect(sheet.toCss()).toMatchInlineSnapshot(`
      "@layer tokens {
        :where(html) {
          --colors-text: #000;
      }

        .dim {
          --colors-text: #333
      }

        .dark .dim, .dim.dark {
          --colors-text: #444
          }
      }"
    `)
  })
})

/**
 * Outside a theme, a condition after another selector condition, `.hc &` after `.dark &`, was
 * compounded onto the element the first declares on, `.dark.hc`, and held only where the two
 * classes share an element. An ordinary `css()` call nesting the two applies under `.hc .dark`, so a
 * page with `.hc` above `.dark` styled its elements for both and kept the token's dark value alone.
 */
describe('a parent condition after another, outside a theme', () => {
  const tokens = (conditions: Config['conditions'], value: unknown, variants?: Record<string, unknown>) => {
    const ctx = createContext({
      presets: [],
      conditions,
      theme: {
        breakpoints: { md: '768px' },
        semanticTokens: { colors: { text: { value } } },
        ...(variants ? { variants } : {}),
      },
      outdir: '',
    } as Config)
    const sheet = ctx.createSheet()
    ctx.appendCssOfType('tokens', sheet)
    return { ctx, css: sheet.toCss() }
  }
  const conditions = { dark: '.dark &', hc: '.hc &' }

  test('meets the element the first declares on from above, and on it', () => {
    expect(tokens(conditions, { base: '#000', _dark: { base: '#111', _hc: '#fff' } }).css).toMatchInlineSnapshot(`
      "@layer tokens {
        :where(html) {
          --breakpoints-md: 768px;
          --sizes-breakpoint-md: 768px;
          --colors-text: #000;
      }

        .dark {
          --colors-text: #111
      }

        .hc .dark, .dark.hc {
          --colors-text: #fff
          }
      }"
    `)
  })

  // Inside it, `.dark .hc` would declare on a `.light` panel, or on the root of a region of the
  // project's own, over the values that one has to keep: nothing tells such a root from another.
  test('and not inside it, even in a project with themes', () => {
    const { css } = tokens(conditions, { base: '#000', _dark: { _hc: '#fff' } }, { pastel: {} })
    expect(css).toContain('.hc .dark, .dark.hc {')
    expect(css).not.toContain('.dark .hc')
    expect(css).not.toContain(':not([data-bamboo-theme])')
  })

  // Wherever an ordinary `css()` call nesting the two applies, so does the token.
  test('where a css() call nesting the two applies', () => {
    const { ctx, css } = tokens(conditions, { base: '#000', _dark: { _hc: '#fff' } })
    ctx.encoder.processAtomic({ color: { _dark: { _hc: 'red' } } } as never)
    ctx.decoder.collect(ctx.encoder)
    const atomic = ctx.createSheet()
    atomic.processDecoder(ctx.decoder)
    expect(withoutMergeCodes(atomic.toCss())).toContain('.hc .dark .dark\\:hc\\:color_red')
    expect(css).toContain('.hc .dark, .dark.hc {')
  })

  test('through a media query between the two, and not after one alone', () => {
    expect(tokens(conditions, { base: '#000', _dark: { md: { _hc: '#fff' } }, md: { _dark: '#eee' } }).css)
      .toMatchInlineSnapshot(`
        "@layer tokens {
          :where(html) {
            --breakpoints-md: 768px;
            --sizes-breakpoint-md: 768px;
            --colors-text: #000;
        }

          @media (width >= 48rem) {
            .hc .dark, .dark.hc {
              --colors-text: #fff
                    }
            .dark {
              --colors-text: #eee
                }
            }
        }"
      `)
  })
})

describe('the css of a theme loaded on demand', () => {
  test('meets the root the same way, and holds that theme alone', () => {
    const ctx = themed({ dark: '.dark &' }, value, {
      pastelDark: { semanticTokens: { colors: { text: { value: { base: '#222', _dark: '#ddd' } } } } },
    })
    const themes = Object.fromEntries(
      (generateThemes(ctx) ?? []).map((file) => [file.name, JSON.parse(file.json).css as string]),
    )
    expect(themes['theme-pastel']).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastel] {
        --colors-text: #111
      }

      .dark [data-bamboo-theme=pastel], [data-bamboo-theme=pastel].dark, [data-bamboo-theme=pastel] .dark:not([data-bamboo-theme]), [data-bamboo-theme=pastel] :where([data-bamboo-theme].dark) {
          --colors-text: #eee
          }"
    `)
    expect(themes['theme-pastelDark']).toMatchInlineSnapshot(`
      "[data-bamboo-theme=pastelDark] {
        --colors-text: #222
      }

      .dark [data-bamboo-theme=pastelDark], [data-bamboo-theme=pastelDark].dark, [data-bamboo-theme=pastelDark] .dark:not([data-bamboo-theme]), [data-bamboo-theme=pastelDark] :where([data-bamboo-theme].dark) {
          --colors-text: #ddd
          }"
    `)
  })
})
