import { createGeneratorContext } from '@bamboocss/fixture'
import { logger } from '@bamboocss/logger'
import type { Dict } from '@bamboocss/types'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { findGlobalCssMistakes } from '../src/serialize'
import { stringify } from '../src/stringify'

/** The rules `global.css` writes, without the registrations every sheet carries beside them. */
const globalCss = (css: Dict) => stringify(createGeneratorContext().createSheet().serialize(css))

const mistakesIn = (css: Dict) => findGlobalCssMistakes(createGeneratorContext(), css)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('global.css keys', () => {
  test('a key named like a property is a selector when it holds styles', () => {
    // `p` is the padding shorthand, `filter` and `font` properties, and all three name elements.
    expect(
      globalCss({
        '.prose': {
          p: { color: 'red' },
          filter: { color: 'blue' },
          font: { color: 'green' },
        },
      }),
    ).toMatchInlineSnapshot(`
      ".prose p {color: red;
      }
      .prose filter {color: blue;
      }
      .prose font {color: green;
      }
      "
    `)
  })

  test('a key named like a property is that property when it holds conditions', () => {
    expect(
      globalCss({
        '.prose': {
          p: { base: '2', md: '4' },
          m: { _hover: '1' },
          color: { base: 'red', _focus: { base: 'blue', md: 'green' } },
        },
      }),
    ).toMatchInlineSnapshot(`
      ".prose {padding: var(--spacing-2);
      color: red;
      }.prose:is(:focus, [data-focus]) {color: blue;
      }
      .prose:is(:hover, [data-hover]) {margin: var(--spacing-1);
      }
      @media (width >= 48rem) {.prose {padding: var(--spacing-4);
      }.prose:is(:focus, [data-focus]) {color: green;
      }
      }
      "
    `)
  })

  test('a selector named like a property, under a condition, an at-rule and a selector', () => {
    expect(
      globalCss({
        '.prose': { p: { _hover: { color: 'red' } } },
        '@media (min-width: 40em)': { p: { color: 'blue' } },
        '.x': { _dark: { p: { color: 'green' } } },
      }),
    ).toMatchInlineSnapshot(`
      ".prose p:is(:hover, [data-hover]) {color: red;
      }
      @media (min-width: 40em) {p {color: blue;
      }
      }
      [data-theme=dark] .x p,.dark .x p,.x.dark p,.x[data-theme=dark] p {color: green;
      }
      "
    `)
  })

  test('a condition that opens a rule is written at the top as what it stands for', () => {
    expect(
      globalCss({
        md: { body: { color: 'red' } },
        _print: { body: { color: 'blue' } },
        _groupHover: { a: { color: 'green' } },
      }),
    ).toMatchInlineSnapshot(`
      "@media (width >= 48rem) {body {color: red;
      }
      }
      @media print {body {color: blue;
      }
      }
      .group:is(:hover, [data-hover]) a {color: green;
      }
      "
    `)
  })
})

describe('global.css mistakes', () => {
  test('a condition at the top that adds to an element', () => {
    expect(mistakesIn({ _dark: { span: { color: 'red' } }, _hover: { color: 'blue' } })).toMatchInlineSnapshot(`
      [
        "\`global.css._dark\` is a condition, and at the top there is no element for it to apply to, so it is written as a selector named \`_dark\`, which matches nothing. Write it inside the selector it applies to: \`span: { _dark: { … } }\`.",
        "\`global.css._hover\` is a condition, and at the top there is no element for it to apply to, so it is written as a selector named \`_hover\`, which matches nothing. Write it inside the selector it applies to: \`html: { _hover: { … } }\`.",
      ]
    `)
  })

  test('a key read as an element no document has', () => {
    expect(
      mistakesIn({
        '.typo': { _hovr: { color: 'pink' } },
        '.card': { has: { svg: { color: 'blue' } } },
        body: { _notACondition: { color: 'red' }, not: { color: 'red' } },
        _hovr: { a: { color: 'red' } },
      }),
    ).toMatchInlineSnapshot(`
      [
        "\`global.css['.typo']._hovr\` is not a condition, so it is read as an element named \`_hovr\`, which matches nothing. Did you mean \`_hover\`?",
        "\`global.css['.card'].has\` is read as an element named \`has\`, which matches nothing. Did you mean \`'&:has(svg)'\`?",
        "\`global.css.body._notACondition\` is not a condition, so it is read as an element named \`_notACondition\`, which matches nothing.",
        "\`global.css.body.not\` is read as an element named \`not\`, which matches nothing. Did you mean \`'&:not(…)'\`?",
        "\`global.css._hovr\` is not a condition, so it is read as an element named \`_hovr\`, which matches nothing. Did you mean \`_hover\`?",
      ]
    `)
  })

  test('a declaration with no rule to sit in', () => {
    expect(
      mistakesIn({
        color: 'red',
        '@media print': { color: 'red', '@supports (display: grid)': { fontSize: '12px' } },
        md: { color: { base: 'red', _hover: 'blue' } },
      }),
    ).toMatchInlineSnapshot(`
      [
        "\`global.css.color\` is a declaration with no selector above it, so it applies to nothing. Write it inside the selector it applies to.",
        "\`global.css['@media print'].color\` is a declaration with no selector above it, so it applies to nothing. Write it inside the selector it applies to.",
        "\`global.css['@media print']['@supports (display: grid)'].fontSize\` is a declaration with no selector above it, so it applies to nothing. Write it inside the selector it applies to.",
        "\`global.css.md.color\` is a declaration with no selector above it, so it applies to nothing. Write it inside the selector it applies to.",
      ]
    `)
  })

  test('shapes that mean what they say report nothing', () => {
    expect(
      mistakesIn({
        body: { color: 'red', p: { color: 'blue' }, '& p': { color: 'blue' }, _dark: { color: 'white' } },
        '.prose': { p: { base: '2', md: '4' }, filter: { color: 'red' }, ':hover': { color: 'red' } },
        md: { body: { color: 'red' } },
        _groupHover: { a: { color: 'green' } },
        '.dark &': { span: { color: 'red' } },
        '&:hover': { a: { color: 'red' } },
        '@font-face': { fontFamily: 'Inter', src: 'url(inter.woff2)' },
        '@media print': { body: { color: 'red' }, _dark: { body: { color: 'red' } } },
        '@scope (.card)': { color: 'red' },
        html: { mixin: 'body', '--global-font-body': 'Inter' },
      }),
    ).toEqual([])
  })

  test('warned about once, as the config is, failing under validation: error and silent under off', () => {
    const css = { '.typo': { _hovr: { color: 'pink' } } }

    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    createGeneratorContext({ global: { css } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toMatchInlineSnapshot(`
      [
        "config",
        "⚠️ Invalid config:
      - [global.css] \`global.css['.typo']._hovr\` is not a condition, so it is read as an element named \`_hovr\`, which matches nothing. Did you mean \`_hover\`?
      ",
      ]
    `)

    expect(() => createGeneratorContext({ validation: 'error', global: { css } })).toThrowErrorMatchingInlineSnapshot(`
      [Error: ⚠️ Invalid config:
      - [global.css] \`global.css['.typo']._hovr\` is not a condition, so it is read as an element named \`_hovr\`, which matches nothing. Did you mean \`_hover\`?
      ]
    `)

    warn.mockClear()
    createGeneratorContext({ validation: 'off', global: { css } })
    expect(warn).not.toHaveBeenCalled()
  })
})
