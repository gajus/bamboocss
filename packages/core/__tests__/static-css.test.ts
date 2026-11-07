import { fixtureDefaults } from '@bamboocss/fixture'
import { type StaticCssOptions } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { Context } from '../src/context'

describe('static-css', () => {
  // limit the number of tokens to speed up tests and make snapshots more readable
  const { hooks, ...defaults } = fixtureDefaults
  const conf = {
    hooks,
    ...defaults,
    config: {
      ...defaults.config,
      theme: JSON.parse(JSON.stringify(defaults.config.theme)),
    },
  } as typeof fixtureDefaults

  // @ts-expect-error
  conf.config.theme!.tokens.colors = {
    red: { 200: { value: 'red.200' } },
    blue: { 200: { value: 'blue.200' } },
    green: { 200: { value: 'green.200' } },
  }

  // @ts-expect-error
  conf.config.theme!.tokens.sizes = {
    20: { value: '20px' },
    40: { value: '40px' },
    60: { value: '60px' },
  }
  // @ts-expect-error
  conf.config.theme!.tokens.spacing = conf.config.theme!.tokens.sizes

  conf.config.theme!.semanticTokens = {}

  const ctx = new Context(conf)
  const getStaticCss = (options: StaticCssOptions) => {
    const engine = ctx.staticCss.clone().process(options)
    return { results: engine.results, css: engine.sheet.toCss() }
  }

  test('works', () => {
    expect(
      getStaticCss({
        css: [
          {
            conditions: ['sm', 'md'],
            properties: {
              margin: ['20px', '40px'],
              padding: ['20px', '40px', '60px'],
            },
          },
          {
            conditions: ['light', 'dark'],
            properties: {
              color: ['*'],
            },
          },
        ],
        recipes: {
          buttonStyle: [
            {
              size: ['sm', 'md'],
              conditions: ['sm', 'md'],
            },
            { variant: ['primary', 'secondary'] },
          ],
          tooltipStyle: ['*'],
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "css": "@layer recipes {
        .buttonStyle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
      }

        .buttonStyle:is(:hover, [data-hover]) {
          background-color: var(--colors-red-200);
          font-size: var(--font-sizes-3xl);
          color: white;
      }

        [data-theme=dark] .tooltipStyle[data-tooltip],.dark .tooltipStyle[data-tooltip],.tooltipStyle[data-tooltip].dark,.tooltipStyle[data-tooltip][data-theme=dark],[data-theme=dark] .tooltipStyle [data-tooltip],.dark .tooltipStyle [data-tooltip],.tooltipStyle [data-tooltip].dark,.tooltipStyle [data-tooltip][data-theme=dark] {
          color: red;
      }

        .buttonStyle--size_md {
          padding: 0 0.75rem;
          height: 3rem;
          min-width: 3rem;
      }

        .buttonStyle--variant_solid {
          background-color: blue;
          color: white;
      }

        .buttonStyle--variant_solid[data-disabled] {
          background-color: gray;
          color: black;
          font-size: var(--font-sizes-2xl);
      }

        .buttonStyle--variant_solid:is(:hover, [data-hover]) {
          background-color: darkblue;
      }

        .buttonStyle--size_sm {
          padding: 0 0.5rem;
          height: 2.5rem;
          min-width: 2.5rem;
      }

        @media (width >= 40rem) {
          .sm\\:buttonStyle--size_sm {
            padding: 0 0.5rem;
            height: 2.5rem;
            min-width: 2.5rem;
      }
          .sm\\:buttonStyle--size_md {
            padding: 0 0.75rem;
            height: 3rem;
            min-width: 3rem;
      }
      }

        @media (width >= 48rem) {
          .md\\:buttonStyle--size_sm {
            padding: 0 0.5rem;
            height: 2.5rem;
            min-width: 2.5rem;
      }
          .md\\:buttonStyle--size_md {
            padding: 0 0.75rem;
            height: 3rem;
            min-width: 3rem;
      }
      }
      }

      @layer utilities {
        @layer s010-c0-p1000, s010-c0-p3000, s010-c3-p1000, s010-c4-p1000, s020-c1-p3000, s020-c2-p3000;

        @layer s010-c0-p1000 {
          ._0OoTQY\\:m_20px {
            margin: 20px;
      }

          ._0OoTQY\\:m_40px {
            margin: 40px;
      }

          ._DJEIKl\\:p_20px {
            padding: 20px;
      }

          ._DJEIKl\\:p_40px {
            padding: 40px;
      }

          ._DJEIKl\\:p_60px {
            padding: 60px;
      }
        }

        @layer s010-c0-p3000 {
          ._Btm_AK\\:c_red\\.200 {
            color: var(--colors-red-200);
      }

          ._Btm_AK\\:c_blue\\.200 {
            color: var(--colors-blue-200);
      }

          ._Btm_AK\\:c_green\\.200 {
            color: var(--colors-green-200);
      }

          ._Btm_AK\\:c_colorPalette\\.200 {
            color: var(--colors-color-palette-200);
      }
        }

        @layer s010-c3-p1000 {
          @media (width >= 40rem) {
            ._pv27ho\\:sm\\:m_20px {
              margin: 20px;
      }
            ._pv27ho\\:sm\\:m_40px {
              margin: 40px;
      }
            ._v2fgvW\\:sm\\:p_20px {
              padding: 20px;
      }
            ._v2fgvW\\:sm\\:p_40px {
              padding: 40px;
      }
            ._v2fgvW\\:sm\\:p_60px {
              padding: 60px;
      }
      }
        }

        @layer s010-c4-p1000 {
          @media (width >= 48rem) {
            ._ncbIq-\\:md\\:m_20px {
              margin: 20px;
      }
            ._ncbIq-\\:md\\:m_40px {
              margin: 40px;
      }
            ._YjCOy4\\:md\\:p_20px {
              padding: 20px;
      }
            ._YjCOy4\\:md\\:p_40px {
              padding: 40px;
      }
            ._YjCOy4\\:md\\:p_60px {
              padding: 60px;
      }
      }
        }

        @layer s020-c1-p3000 {

          [data-theme=light] ._IcPIb3\\:light\\:c_red\\.200,.light ._IcPIb3\\:light\\:c_red\\.200,._IcPIb3\\:light\\:c_red\\.200.light,._IcPIb3\\:light\\:c_red\\.200[data-theme=light] {
            color: var(--colors-red-200);
      }

          [data-theme=light] ._IcPIb3\\:light\\:c_blue\\.200,.light ._IcPIb3\\:light\\:c_blue\\.200,._IcPIb3\\:light\\:c_blue\\.200.light,._IcPIb3\\:light\\:c_blue\\.200[data-theme=light] {
            color: var(--colors-blue-200);
      }

          [data-theme=light] ._IcPIb3\\:light\\:c_green\\.200,.light ._IcPIb3\\:light\\:c_green\\.200,._IcPIb3\\:light\\:c_green\\.200.light,._IcPIb3\\:light\\:c_green\\.200[data-theme=light] {
            color: var(--colors-green-200);
      }

          [data-theme=light] ._IcPIb3\\:light\\:c_colorPalette\\.200,.light ._IcPIb3\\:light\\:c_colorPalette\\.200,._IcPIb3\\:light\\:c_colorPalette\\.200.light,._IcPIb3\\:light\\:c_colorPalette\\.200[data-theme=light] {
            color: var(--colors-color-palette-200);
      }
        }

        @layer s020-c2-p3000 {

          [data-theme=dark] ._gtEApe\\:dark\\:c_red\\.200,.dark ._gtEApe\\:dark\\:c_red\\.200,._gtEApe\\:dark\\:c_red\\.200.dark,._gtEApe\\:dark\\:c_red\\.200[data-theme=dark] {
            color: var(--colors-red-200);
      }

          [data-theme=dark] ._gtEApe\\:dark\\:c_blue\\.200,.dark ._gtEApe\\:dark\\:c_blue\\.200,._gtEApe\\:dark\\:c_blue\\.200.dark,._gtEApe\\:dark\\:c_blue\\.200[data-theme=dark] {
            color: var(--colors-blue-200);
      }

          [data-theme=dark] ._gtEApe\\:dark\\:c_green\\.200,.dark ._gtEApe\\:dark\\:c_green\\.200,._gtEApe\\:dark\\:c_green\\.200.dark,._gtEApe\\:dark\\:c_green\\.200[data-theme=dark] {
            color: var(--colors-green-200);
      }

          [data-theme=dark] ._gtEApe\\:dark\\:c_colorPalette\\.200,.dark ._gtEApe\\:dark\\:c_colorPalette\\.200,._gtEApe\\:dark\\:c_colorPalette\\.200.dark,._gtEApe\\:dark\\:c_colorPalette\\.200[data-theme=dark] {
            color: var(--colors-color-palette-200);
      }
        }
      }",
        "results": {
          "css": [
            {
              "margin": {
                "base": "20px",
                "md": "20px",
                "sm": "20px",
              },
            },
            {
              "margin": {
                "base": "40px",
                "md": "40px",
                "sm": "40px",
              },
            },
            {
              "padding": {
                "base": "20px",
                "md": "20px",
                "sm": "20px",
              },
            },
            {
              "padding": {
                "base": "40px",
                "md": "40px",
                "sm": "40px",
              },
            },
            {
              "padding": {
                "base": "60px",
                "md": "60px",
                "sm": "60px",
              },
            },
            {
              "color": {
                "_dark": "red.200",
                "_light": "red.200",
                "base": "red.200",
              },
            },
            {
              "color": {
                "_dark": "blue.200",
                "_light": "blue.200",
                "base": "blue.200",
              },
            },
            {
              "color": {
                "_dark": "green.200",
                "_light": "green.200",
                "base": "green.200",
              },
            },
            {
              "color": {
                "_dark": "colorPalette.200",
                "_light": "colorPalette.200",
                "base": "colorPalette.200",
              },
            },
          ],
          "patterns": [],
          "recipes": [
            {
              "buttonStyle": {},
            },
            {
              "buttonStyle": {
                "size": {
                  "base": "sm",
                  "md": "sm",
                  "sm": "sm",
                },
              },
            },
            {
              "buttonStyle": {
                "size": {
                  "base": "md",
                  "md": "md",
                  "sm": "md",
                },
              },
            },
            {
              "buttonStyle": {
                "variant": "primary",
              },
            },
            {
              "buttonStyle": {
                "variant": "secondary",
              },
            },
            {
              "tooltipStyle": {},
            },
          ],
        },
      }
    `)
  })

  test('using * as RecipeRule', () => {
    expect(
      getStaticCss({
        css: [],
        recipes: {
          buttonStyle: ['*'],
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "css": "@layer recipes {
        .buttonStyle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
      }

        .buttonStyle:is(:hover, [data-hover]) {
          background-color: var(--colors-red-200);
          font-size: var(--font-sizes-3xl);
          color: white;
      }

        .buttonStyle--size_md {
          padding: 0 0.75rem;
          height: 3rem;
          min-width: 3rem;
      }

        .buttonStyle--variant_solid {
          background-color: blue;
          color: white;
      }

        .buttonStyle--variant_solid[data-disabled] {
          background-color: gray;
          color: black;
          font-size: var(--font-sizes-2xl);
      }

        .buttonStyle--variant_solid:is(:hover, [data-hover]) {
          background-color: darkblue;
      }

        .buttonStyle--size_sm {
          padding: 0 0.5rem;
          height: 2.5rem;
          min-width: 2.5rem;
      }

        .buttonStyle--variant_outline {
          border: 1px solid blue;
          background-color: transparent;
          color: blue;
      }

        .buttonStyle--variant_outline[data-disabled] {
          border: 1px solid gray;
          background-color: transparent;
          color: gray;
      }

        .buttonStyle--variant_outline:is(:hover, [data-hover]) {
          background-color: blue;
          color: white;
      }
      }",
        "results": {
          "css": [],
          "patterns": [],
          "recipes": [
            {
              "buttonStyle": {},
            },
            {
              "buttonStyle": {
                "size": "sm",
              },
            },
            {
              "buttonStyle": {
                "size": "md",
              },
            },
            {
              "buttonStyle": {
                "variant": "solid",
              },
            },
            {
              "buttonStyle": {
                "variant": "outline",
              },
            },
          ],
        },
      }
    `)
  })

  test('using * in CssRule', () => {
    expect(
      getStaticCss({
        css: [{ properties: { margin: ['*'] } }],
      }),
    ).toMatchInlineSnapshot(`
      {
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          ._0OoTQY\\:m_20 {
            margin: var(--spacing-20);
      }

          ._0OoTQY\\:m_40 {
            margin: var(--spacing-40);
      }

          ._0OoTQY\\:m_60 {
            margin: var(--spacing-60);
      }

          ._0OoTQY\\:m_auto {
            margin: auto;
      }

          ._0OoTQY\\:m_-20 {
            margin: calc(var(--spacing-20) * -1);
      }

          ._0OoTQY\\:m_-40 {
            margin: calc(var(--spacing-40) * -1);
      }

          ._0OoTQY\\:m_-60 {
            margin: calc(var(--spacing-60) * -1);
      }
        }
      }",
        "results": {
          "css": [
            {
              "margin": "20",
            },
            {
              "margin": "40",
            },
            {
              "margin": "60",
            },
            {
              "margin": "auto",
            },
            {
              "margin": "-20",
            },
            {
              "margin": "-40",
            },
            {
              "margin": "-60",
            },
          ],
          "patterns": [],
          "recipes": [],
        },
      }
    `)
  })

  test('using * in CssRule', () => {
    expect(
      getStaticCss({
        css: [{ properties: { padding: ['*'] } }],
      }),
    ).toMatchInlineSnapshot(`
      {
        "css": "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          ._DJEIKl\\:p_20 {
            padding: var(--spacing-20);
      }

          ._DJEIKl\\:p_40 {
            padding: var(--spacing-40);
      }

          ._DJEIKl\\:p_60 {
            padding: var(--spacing-60);
      }

          ._DJEIKl\\:p_-20 {
            padding: calc(var(--spacing-20) * -1);
      }

          ._DJEIKl\\:p_-40 {
            padding: calc(var(--spacing-40) * -1);
      }

          ._DJEIKl\\:p_-60 {
            padding: calc(var(--spacing-60) * -1);
      }
        }
      }",
        "results": {
          "css": [
            {
              "padding": "20",
            },
            {
              "padding": "40",
            },
            {
              "padding": "60",
            },
            {
              "padding": "-20",
            },
            {
              "padding": "-40",
            },
            {
              "padding": "-60",
            },
          ],
          "patterns": [],
          "recipes": [],
        },
      }
    `)
  })

  test('using * in CssRule and conditions list', () => {
    expect(
      getStaticCss({
        css: [{ properties: { color: ['*'] }, conditions: ['hover', 'focus'] }],
      }),
    ).toMatchInlineSnapshot(`
      {
        "css": "@layer utilities {
        @layer s010-c0-p3000, s020-c1-p3000, s020-c2-p3000;

        @layer s010-c0-p3000 {
          ._Btm_AK\\:c_red\\.200 {
            color: var(--colors-red-200);
      }

          ._Btm_AK\\:c_blue\\.200 {
            color: var(--colors-blue-200);
      }

          ._Btm_AK\\:c_green\\.200 {
            color: var(--colors-green-200);
      }

          ._Btm_AK\\:c_colorPalette\\.200 {
            color: var(--colors-color-palette-200);
      }
        }

        @layer s020-c1-p3000 {
          ._yZXLUJ\\:focus\\:c_red\\.200:is(:focus, [data-focus]) {
            color: var(--colors-red-200);
      }

          ._yZXLUJ\\:focus\\:c_blue\\.200:is(:focus, [data-focus]) {
            color: var(--colors-blue-200);
      }

          ._yZXLUJ\\:focus\\:c_green\\.200:is(:focus, [data-focus]) {
            color: var(--colors-green-200);
      }

          ._yZXLUJ\\:focus\\:c_colorPalette\\.200:is(:focus, [data-focus]) {
            color: var(--colors-color-palette-200);
      }
        }

        @layer s020-c2-p3000 {
          ._nRd69H\\:hover\\:c_red\\.200:is(:hover, [data-hover]) {
            color: var(--colors-red-200);
      }

          ._nRd69H\\:hover\\:c_blue\\.200:is(:hover, [data-hover]) {
            color: var(--colors-blue-200);
      }

          ._nRd69H\\:hover\\:c_green\\.200:is(:hover, [data-hover]) {
            color: var(--colors-green-200);
      }

          ._nRd69H\\:hover\\:c_colorPalette\\.200:is(:hover, [data-hover]) {
            color: var(--colors-color-palette-200);
      }
        }
      }",
        "results": {
          "css": [
            {
              "color": {
                "_focus": "red.200",
                "_hover": "red.200",
                "base": "red.200",
              },
            },
            {
              "color": {
                "_focus": "blue.200",
                "_hover": "blue.200",
                "base": "blue.200",
              },
            },
            {
              "color": {
                "_focus": "green.200",
                "_hover": "green.200",
                "base": "green.200",
              },
            },
            {
              "color": {
                "_focus": "colorPalette.200",
                "_hover": "colorPalette.200",
                "base": "colorPalette.200",
              },
            },
          ],
          "patterns": [],
          "recipes": [],
        },
      }
    `)
  })

  test('simple recipe', () => {
    expect(
      getStaticCss({
        recipes: {
          buttonStyle: [{ size: ['md'], conditions: ['md'] }],
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "css": "@layer recipes {
        .buttonStyle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
      }

        .buttonStyle:is(:hover, [data-hover]) {
          background-color: var(--colors-red-200);
          font-size: var(--font-sizes-3xl);
          color: white;
      }

        .buttonStyle--size_md {
          padding: 0 0.75rem;
          height: 3rem;
          min-width: 3rem;
      }

        .buttonStyle--variant_solid {
          background-color: blue;
          color: white;
      }

        .buttonStyle--variant_solid[data-disabled] {
          background-color: gray;
          color: black;
          font-size: var(--font-sizes-2xl);
      }

        .buttonStyle--variant_solid:is(:hover, [data-hover]) {
          background-color: darkblue;
      }

        @media (width >= 48rem) {
          .md\\:buttonStyle--size_md {
            padding: 0 0.75rem;
            height: 3rem;
            min-width: 3rem;
      }
      }
      }",
        "results": {
          "css": [],
          "patterns": [],
          "recipes": [
            {
              "buttonStyle": {},
            },
            {
              "buttonStyle": {
                "size": {
                  "base": "md",
                  "md": "md",
                },
              },
            },
          ],
        },
      }
    `)
  })

  test('slot recipe', () => {
    expect(
      getStaticCss({
        recipes: {
          checkbox: [{ size: ['lg'], conditions: ['lg'] }],
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "css": "@layer recipes.slots {
        .checkbox__root {
          gap: 2px;
          display: flex;
          align-items: center;
      }

        .checkbox__control {
          border-width: 1px;
          border-radius: var(--radii-sm);
      }

        .checkbox__label {
          margin-inline-start: 2px;
      }

        @scope (.checkbox__root--size_sm) to (.checkbox__root) {
          .checkbox__control {
            text-style: headline.h1;
            width: var(--sizes-8);
            height: var(--sizes-8);
      }

          .checkbox__label {
            font-size: var(--font-sizes-sm);
      }
      }

        @scope (.checkbox__root--size_lg) to (.checkbox__root) {
          .checkbox__control {
            width: var(--sizes-12);
            height: var(--sizes-12);
      }

          .checkbox__label {
            font-size: var(--font-sizes-lg);
      }

          @media (width >= 64rem) {
            .checkbox__control {
              width: var(--sizes-12);
              height: var(--sizes-12);
      }
            .checkbox__label {
              font-size: var(--font-sizes-lg);
      }
      }
      }
      }",
        "results": {
          "css": [],
          "patterns": [],
          "recipes": [
            {
              "checkbox": {},
            },
            {
              "checkbox": {
                "size": {
                  "base": "lg",
                  "lg": "lg",
                },
              },
            },
          ],
        },
      }
    `)
  })

  test('simple pattern', () => {
    expect(
      getStaticCss({
        patterns: {
          // type: 'number'
          aspectRatio: [
            { properties: { ratio: ['4/3', '16/9', '1/1'] } },
            { properties: { ratio: ['1/4'] }, conditions: ['md'] },
          ],
          // type: 'token'
          spacer: [{ properties: { size: ['sm', 'md', 'lg'] } }],
          // type: 'property'
          center: [{ properties: { size: ['sm', 'md', 'lg'] } }],
          bleed: [{ properties: { inline: ['*'] } }],
          // type: 'enum' + type: 'token'
          divider: [{ properties: { orientation: ['*'], thickness: ['*'] } }],
          float: ['*'],
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "css": "@layer utilities {
        @layer s010-c0-p1, s010-c0-p2000, s010-c0-p3000, s010-c0-p4000, s010-c1-p1000, s010-c1-p2000, s010-c1-p3000, s010-c1-p4000, s010-c4-p3000, s010-c5-p1000, s010-c5-p2000, s010-c5-p3000, s010-c5-p4000, s011-c2-p3000, s011-c3-p3000, s011-c2-p4000, s011-c6-p3000, s011-c7-p3000, s011-c6-p4000;

        @layer s010-c0-p1 {
          ._Mg_8tV\\:--bleed-x_var\\(--spacing-20\\) {
            --bleed-x: var(--spacing-20);
      }

          ._b2NXtV\\:--bleed-y_0 {
            --bleed-y: 0;
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-40\\) {
            --bleed-x: var(--spacing-40);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-60\\) {
            --bleed-x: var(--spacing-60);
      }

          ._Mg_8tV\\:--bleed-x_auto {
            --bleed-x: auto;
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-20\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-20) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-40\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-40) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-60\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-60) * -1);
      }

          ._XPmwuw\\:--thickness_1px {
            --thickness: 1px;
      }

          ._XPmwuw\\:--thickness_20 {
            --thickness: 20;
      }

          ._XPmwuw\\:--thickness_40 {
            --thickness: 40;
      }

          ._XPmwuw\\:--thickness_60 {
            --thickness: 60;
      }

          ._XPmwuw\\:--thickness_breakpoint-sm {
            --thickness: breakpoint-sm;
      }

          ._XPmwuw\\:--thickness_breakpoint-md {
            --thickness: breakpoint-md;
      }

          ._XPmwuw\\:--thickness_breakpoint-lg {
            --thickness: breakpoint-lg;
      }

          ._XPmwuw\\:--thickness_breakpoint-xl {
            --thickness: breakpoint-xl;
      }

          ._XPmwuw\\:--thickness_breakpoint-2xl {
            --thickness: breakpoint-2xl;
      }
        }

        @layer s010-c0-p2000 {
          ._cM4iKr\\:flex_0_0_sm {
            flex: 0 0 sm;
      }

          ._cM4iKr\\:flex_0_0_md {
            flex: 0 0 md;
      }

          ._cM4iKr\\:flex_0_0_lg {
            flex: 0 0 lg;
      }

          ._cM4iKr\\:flex_0_0_auto {
            flex: 0 0 auto;
      }

          ._0QmaUN\\:mx_calc\\(var\\(--bleed-x\\,_0\\)_\\*_-1\\) {
            margin-inline: calc(var(--bleed-x, 0) * -1);
      }

          ._F2GXY7\\:my_calc\\(var\\(--bleed-y\\,_0\\)_\\*_-1\\) {
            margin-block: calc(var(--bleed-y, 0) * -1);
      }
        }

        @layer s010-c0-p3000 {
          ._PHAS7x\\:pos_relative {
            position: relative;
      }

          ._a9lftO\\:as_stretch {
            align-self: stretch;
      }

          ._fDdPQa\\:justify-self_stretch {
            justify-self: stretch;
      }

          ._Fg8Gj5\\:d_flex {
            display: flex;
      }

          ._IS_uqi\\:ai_center {
            align-items: center;
      }

          ._syDQuH\\:jc_center {
            justify-content: center;
      }

          ._iDqfKY\\:bd-be-w_var\\(--thickness\\) {
            border-block-end-width: var(--thickness);
      }

          ._amUV18\\:bd-e-w_var\\(--thickness\\) {
            border-inline-end-width: var(--thickness);
      }

          ._Fg8Gj5\\:d_inline-flex {
            display: inline-flex;
      }

          ._PHAS7x\\:pos_absolute {
            position: absolute;
      }

          ._7xURoC\\:inset-bs_0 {
            inset-block-start: 0;
      }

          ._lFBHho\\:inset-be_auto {
            inset-block-end: auto;
      }

          ._oCxt6h\\:inset-s_auto {
            inset-inline-start: auto;
      }

          ._tikPb5\\:inset-e_20 {
            inset-inline-end: var(--spacing-20);
      }

          ._nZtn2j\\:translate_50\\%_-50\\% {
            translate: 50% -50%;
      }

          ._tikPb5\\:inset-e_40 {
            inset-inline-end: var(--spacing-40);
      }

          ._tikPb5\\:inset-e_60 {
            inset-inline-end: var(--spacing-60);
      }

          ._tikPb5\\:inset-e_-20 {
            inset-inline-end: calc(var(--spacing-20) * -1);
      }

          ._tikPb5\\:inset-e_-40 {
            inset-inline-end: calc(var(--spacing-40) * -1);
      }

          ._tikPb5\\:inset-e_-60 {
            inset-inline-end: calc(var(--spacing-60) * -1);
      }

          ._7xURoC\\:inset-bs_20 {
            inset-block-start: var(--spacing-20);
      }

          ._tikPb5\\:inset-e_0 {
            inset-inline-end: 0;
      }

          ._7xURoC\\:inset-bs_40 {
            inset-block-start: var(--spacing-40);
      }

          ._7xURoC\\:inset-bs_60 {
            inset-block-start: var(--spacing-60);
      }

          ._7xURoC\\:inset-bs_-20 {
            inset-block-start: calc(var(--spacing-20) * -1);
      }

          ._7xURoC\\:inset-bs_-40 {
            inset-block-start: calc(var(--spacing-40) * -1);
      }

          ._7xURoC\\:inset-bs_-60 {
            inset-block-start: calc(var(--spacing-60) * -1);
      }

          ._7xURoC\\:inset-bs_auto {
            inset-block-start: auto;
      }

          ._lFBHho\\:inset-be_0 {
            inset-block-end: 0;
      }

          ._nZtn2j\\:translate_50\\%_50\\% {
            translate: 50% 50%;
      }

          ._oCxt6h\\:inset-s_0 {
            inset-inline-start: 0;
      }

          ._tikPb5\\:inset-e_auto {
            inset-inline-end: auto;
      }

          ._nZtn2j\\:translate_-50\\%_50\\% {
            translate: -50% 50%;
      }

          ._nZtn2j\\:translate_-50\\%_-50\\% {
            translate: -50% -50%;
      }

          ._oCxt6h\\:inset-s_50\\% {
            inset-inline-start: 50%;
      }

          ._tikPb5\\:inset-e_50\\% {
            inset-inline-end: 50%;
      }

          ._7xURoC\\:inset-bs_50\\% {
            inset-block-start: 50%;
      }

          ._lFBHho\\:inset-be_50\\% {
            inset-block-end: 50%;
      }
        }

        @layer s010-c0-p4000 {
          ._RO16FJ\\:w_sm {
            width: sm;
      }

          ._97NnCm\\:h_sm {
            height: sm;
      }

          ._RO16FJ\\:w_md {
            width: md;
      }

          ._97NnCm\\:h_md {
            height: md;
      }

          ._RO16FJ\\:w_lg {
            width: lg;
      }

          ._97NnCm\\:h_lg {
            height: lg;
      }

          ._RO16FJ\\:w_100\\% {
            width: 100%;
      }

          ._97NnCm\\:h_100\\% {
            height: 100%;
      }
        }

        @layer s010-c1-p1000 {
          ._hmTE0v\\:\\[\\&\\>\\*\\]\\:inset_0>* {
            inset: 0;
      }
        }

        @layer s010-c1-p2000 {
          ._zrZbCi\\:\\[\\&\\>\\*\\]\\:ov_hidden>* {
            overflow: hidden;
      }
        }

        @layer s010-c1-p3000 {
          ._3fZ3gc\\:\\[\\&\\>\\*\\]\\:d_flex>* {
            display: flex;
      }

          .__FKBGf\\:\\[\\&\\>\\*\\]\\:jc_center>* {
            justify-content: center;
      }

          ._o2G1EI\\:\\[\\&\\>\\*\\]\\:ai_center>* {
            align-items: center;
      }

          ._SGTpQz\\:\\[\\&\\>\\*\\]\\:pos_absolute>* {
            position: absolute;
      }
        }

        @layer s010-c1-p4000 {
          ._EjoHtw\\:\\[\\&\\>\\*\\]\\:w_100\\%>* {
            width: 100%;
      }

          ._kZCYb_\\:\\[\\&\\>\\*\\]\\:h_100\\%>* {
            height: 100%;
      }
        }

        @layer s010-c4-p3000 {
          @media (width >= 48rem) {
            ._q3xf4A\\:md\\:pos_relative {
              position: relative;
      }
      }
        }

        @layer s010-c5-p1000 {
          @media (width >= 48rem) {
            ._k-kWTu\\:md\\:\\[\\&\\>\\*\\]\\:inset_0>* {
              inset: 0;
      }
      }
        }

        @layer s010-c5-p2000 {
          @media (width >= 48rem) {
            ._p6WVVL\\:md\\:\\[\\&\\>\\*\\]\\:ov_hidden>* {
              overflow: hidden;
      }
      }
        }

        @layer s010-c5-p3000 {
          @media (width >= 48rem) {
            ._Dg_3Th\\:md\\:\\[\\&\\>\\*\\]\\:d_flex>* {
              display: flex;
      }
            ._hXSLRu\\:md\\:\\[\\&\\>\\*\\]\\:jc_center>* {
              justify-content: center;
      }
            ._Px00gC\\:md\\:\\[\\&\\>\\*\\]\\:ai_center>* {
              align-items: center;
      }
            ._WqiaCC\\:md\\:\\[\\&\\>\\*\\]\\:pos_absolute>* {
              position: absolute;
      }
      }
        }

        @layer s010-c5-p4000 {
          @media (width >= 48rem) {
            ._ua3rr9\\:md\\:\\[\\&\\>\\*\\]\\:w_100\\%>* {
              width: 100%;
      }
            ._EuT1Bs\\:md\\:\\[\\&\\>\\*\\]\\:h_100\\%>* {
              height: 100%;
      }
      }
        }

        @layer s011-c2-p3000 {
          ._vya0vI\\:before\\:content_\\"\\"::before {
            content: "";
      }

          ._qGXZ6L\\:before\\:d_block::before {
            display: block;
      }
        }

        @layer s011-c3-p3000 {

          ._nwhM1X\\:\\[\\&\\>img\\,_\\&\\>video\\]\\:obj-f_cover>img,._nwhM1X\\:\\[\\&\\>img\\,_\\&\\>video\\]\\:obj-f_cover>video {
            object-fit: cover;
      }
        }

        @layer s011-c2-p4000 {
          ._LlFmNu\\:before\\:h_0::before {
            height: 0;
      }

          ._XLvIYN\\:before\\:pb_NaN\\%::before {
            padding-bottom: NaN%;
      }
        }

        @layer s011-c6-p3000 {
          @media (width >= 48rem) {
            ._hSnCzV\\:md\\:before\\:content_\\"\\"::before {
              content: "";
      }
            ._vusJpS\\:md\\:before\\:d_block::before {
              display: block;
      }
      }
        }

        @layer s011-c7-p3000 {
          @media (width >= 48rem) {
            ._UcZw4h\\:md\\:\\[\\&\\>img\\,_\\&\\>video\\]\\:obj-f_cover>img,._UcZw4h\\:md\\:\\[\\&\\>img\\,_\\&\\>video\\]\\:obj-f_cover>video {
              object-fit: cover;
      }
      }
        }

        @layer s011-c6-p4000 {
          @media (width >= 48rem) {
            ._OEc4P_\\:md\\:before\\:h_0::before {
              height: 0;
      }
            ._h64Bfy\\:md\\:before\\:pb_NaN\\%::before {
              padding-bottom: NaN%;
      }
      }
        }
      }",
        "results": {
          "css": [],
          "patterns": [
            {
              "&>*": {
                "alignItems": "center",
                "display": "flex",
                "height": "100%",
                "inset": "0",
                "justifyContent": "center",
                "overflow": "hidden",
                "position": "absolute",
                "width": "100%",
              },
              "&>img, &>video": {
                "objectFit": "cover",
              },
              "_before": {
                "content": """",
                "display": "block",
                "height": "0",
                "paddingBottom": "NaN%",
              },
              "position": "relative",
            },
            {
              "&>*": {
                "alignItems": "center",
                "display": "flex",
                "height": "100%",
                "inset": "0",
                "justifyContent": "center",
                "overflow": "hidden",
                "position": "absolute",
                "width": "100%",
              },
              "&>img, &>video": {
                "objectFit": "cover",
              },
              "_before": {
                "content": """",
                "display": "block",
                "height": "0",
                "paddingBottom": "NaN%",
              },
              "position": "relative",
            },
            {
              "&>*": {
                "alignItems": "center",
                "display": "flex",
                "height": "100%",
                "inset": "0",
                "justifyContent": "center",
                "overflow": "hidden",
                "position": "absolute",
                "width": "100%",
              },
              "&>img, &>video": {
                "objectFit": "cover",
              },
              "_before": {
                "content": """",
                "display": "block",
                "height": "0",
                "paddingBottom": "NaN%",
              },
              "position": "relative",
            },
            {
              "base": {
                "&>*": {
                  "alignItems": "center",
                  "display": "flex",
                  "height": "100%",
                  "inset": "0",
                  "justifyContent": "center",
                  "overflow": "hidden",
                  "position": "absolute",
                  "width": "100%",
                },
                "&>img, &>video": {
                  "objectFit": "cover",
                },
                "_before": {
                  "content": """",
                  "display": "block",
                  "height": "0",
                  "paddingBottom": "NaN%",
                },
                "position": "relative",
              },
              "md": {
                "&>*": {
                  "alignItems": "center",
                  "display": "flex",
                  "height": "100%",
                  "inset": "0",
                  "justifyContent": "center",
                  "overflow": "hidden",
                  "position": "absolute",
                  "width": "100%",
                },
                "&>img, &>video": {
                  "objectFit": "cover",
                },
                "_before": {
                  "content": """",
                  "display": "block",
                  "height": "0",
                  "paddingBottom": "NaN%",
                },
                "position": "relative",
              },
            },
            {
              "alignSelf": "stretch",
              "flex": "0 0 sm",
              "justifySelf": "stretch",
            },
            {
              "alignSelf": "stretch",
              "flex": "0 0 md",
              "justifySelf": "stretch",
            },
            {
              "alignSelf": "stretch",
              "flex": "0 0 lg",
              "justifySelf": "stretch",
            },
            {
              "alignItems": "center",
              "display": "flex",
              "flex": "0 0 auto",
              "height": "sm",
              "justifyContent": "center",
              "width": "sm",
            },
            {
              "alignItems": "center",
              "display": "flex",
              "flex": "0 0 auto",
              "height": "md",
              "justifyContent": "center",
              "width": "md",
            },
            {
              "alignItems": "center",
              "display": "flex",
              "flex": "0 0 auto",
              "height": "lg",
              "justifyContent": "center",
              "width": "lg",
            },
            {
              "--bleed-x": "var(--spacing-20)",
              "--bleed-y": "0",
              "marginBlock": "calc(var(--bleed-y, 0) * -1)",
              "marginInline": "calc(var(--bleed-x, 0) * -1)",
            },
            {
              "--bleed-x": "var(--spacing-40)",
              "--bleed-y": "0",
              "marginBlock": "calc(var(--bleed-y, 0) * -1)",
              "marginInline": "calc(var(--bleed-x, 0) * -1)",
            },
            {
              "--bleed-x": "var(--spacing-60)",
              "--bleed-y": "0",
              "marginBlock": "calc(var(--bleed-y, 0) * -1)",
              "marginInline": "calc(var(--bleed-x, 0) * -1)",
            },
            {
              "--bleed-x": "auto",
              "--bleed-y": "0",
              "marginBlock": "calc(var(--bleed-y, 0) * -1)",
              "marginInline": "calc(var(--bleed-x, 0) * -1)",
            },
            {
              "--bleed-x": "calc(var(--spacing-20) * -1)",
              "--bleed-y": "0",
              "marginBlock": "calc(var(--bleed-y, 0) * -1)",
              "marginInline": "calc(var(--bleed-x, 0) * -1)",
            },
            {
              "--bleed-x": "calc(var(--spacing-40) * -1)",
              "--bleed-y": "0",
              "marginBlock": "calc(var(--bleed-y, 0) * -1)",
              "marginInline": "calc(var(--bleed-x, 0) * -1)",
            },
            {
              "--bleed-x": "calc(var(--spacing-60) * -1)",
              "--bleed-y": "0",
              "marginBlock": "calc(var(--bleed-y, 0) * -1)",
              "marginInline": "calc(var(--bleed-x, 0) * -1)",
            },
            {
              "--thickness": "1px",
              "borderBlockEndWidth": "var(--thickness)",
              "borderColor": undefined,
              "borderInlineEndWidth": undefined,
              "height": undefined,
              "width": "100%",
            },
            {
              "--thickness": "1px",
              "borderBlockEndWidth": undefined,
              "borderColor": undefined,
              "borderInlineEndWidth": "var(--thickness)",
              "height": "100%",
              "width": undefined,
            },
            {
              "--thickness": "20",
              "borderBlockEndWidth": "var(--thickness)",
              "borderColor": undefined,
              "borderInlineEndWidth": undefined,
              "height": undefined,
              "width": "100%",
            },
            {
              "--thickness": "40",
              "borderBlockEndWidth": "var(--thickness)",
              "borderColor": undefined,
              "borderInlineEndWidth": undefined,
              "height": undefined,
              "width": "100%",
            },
            {
              "--thickness": "60",
              "borderBlockEndWidth": "var(--thickness)",
              "borderColor": undefined,
              "borderInlineEndWidth": undefined,
              "height": undefined,
              "width": "100%",
            },
            {
              "--thickness": "breakpoint-sm",
              "borderBlockEndWidth": "var(--thickness)",
              "borderColor": undefined,
              "borderInlineEndWidth": undefined,
              "height": undefined,
              "width": "100%",
            },
            {
              "--thickness": "breakpoint-md",
              "borderBlockEndWidth": "var(--thickness)",
              "borderColor": undefined,
              "borderInlineEndWidth": undefined,
              "height": undefined,
              "width": "100%",
            },
            {
              "--thickness": "breakpoint-lg",
              "borderBlockEndWidth": "var(--thickness)",
              "borderColor": undefined,
              "borderInlineEndWidth": undefined,
              "height": undefined,
              "width": "100%",
            },
            {
              "--thickness": "breakpoint-xl",
              "borderBlockEndWidth": "var(--thickness)",
              "borderColor": undefined,
              "borderInlineEndWidth": undefined,
              "height": undefined,
              "width": "100%",
            },
            {
              "--thickness": "breakpoint-2xl",
              "borderBlockEndWidth": "var(--thickness)",
              "borderColor": undefined,
              "borderInlineEndWidth": undefined,
              "height": undefined,
              "width": "100%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "0",
              "insetInlineEnd": "20",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "0",
              "insetInlineEnd": "40",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "0",
              "insetInlineEnd": "60",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "0",
              "insetInlineEnd": "-20",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "0",
              "insetInlineEnd": "-40",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "0",
              "insetInlineEnd": "-60",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "20",
              "insetInlineEnd": "0",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "40",
              "insetInlineEnd": "0",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "60",
              "insetInlineEnd": "0",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "-20",
              "insetInlineEnd": "0",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "-40",
              "insetInlineEnd": "0",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "-60",
              "insetInlineEnd": "0",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "20",
              "insetInlineEnd": "20",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "40",
              "insetInlineEnd": "40",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "60",
              "insetInlineEnd": "60",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "-20",
              "insetInlineEnd": "-20",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "-40",
              "insetInlineEnd": "-40",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "-60",
              "insetInlineEnd": "-60",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "0",
              "insetBlockStart": "auto",
              "insetInlineEnd": "0",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% 50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "0",
              "insetBlockStart": "auto",
              "insetInlineEnd": "auto",
              "insetInlineStart": "0",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "-50% 50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "0",
              "insetInlineEnd": "0",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "0",
              "insetInlineEnd": "auto",
              "insetInlineStart": "0",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "-50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "0",
              "insetBlockStart": "auto",
              "insetInlineEnd": "50%",
              "insetInlineStart": "50%",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "-50% 50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "auto",
              "insetBlockStart": "0",
              "insetInlineEnd": "50%",
              "insetInlineStart": "50%",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "-50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "50%",
              "insetBlockStart": "50%",
              "insetInlineEnd": "50%",
              "insetInlineStart": "50%",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "-50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "50%",
              "insetBlockStart": "50%",
              "insetInlineEnd": "0",
              "insetInlineStart": "auto",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "50% -50%",
            },
            {
              "alignItems": "center",
              "display": "inline-flex",
              "insetBlockEnd": "50%",
              "insetBlockStart": "50%",
              "insetInlineEnd": "auto",
              "insetInlineStart": "0",
              "justifyContent": "center",
              "position": "absolute",
              "translate": "-50% -50%",
            },
          ],
          "recipes": [],
        },
      }
    `)
  })

  test('all recipes', () => {
    expect(getStaticCss({ recipes: '*' })).toMatchInlineSnapshot(`
      {
        "css": "@layer recipes {
        .textStyle {
          font-family: var(--fonts-mono);
      }

        .textStyle > :not([hidden]) ~ :not([hidden]) {
          border-inline-start-width: 20px;
          border-inline-end-width: 0px;
      }

        [data-theme=dark] .tooltipStyle[data-tooltip],.dark .tooltipStyle[data-tooltip],.tooltipStyle[data-tooltip].dark,.tooltipStyle[data-tooltip][data-theme=dark],[data-theme=dark] .tooltipStyle [data-tooltip],.dark .tooltipStyle [data-tooltip],.tooltipStyle [data-tooltip].dark,.tooltipStyle [data-tooltip][data-theme=dark] {
          color: red;
      }

        .buttonStyle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
      }

        .buttonStyle:is(:hover, [data-hover]) {
          background-color: var(--colors-red-200);
          font-size: var(--font-sizes-3xl);
          color: white;
      }

        .textStyle--size_h1 {
          font-size: 5rem;
          line-height: 1em;
          font-weight: 800;
      }

        .textStyle--size_h2 {
          font-size: 3rem;
          line-height: 1.2em;
          font-weight: 700;
          letter-spacing: -0.03em;
      }

        .card--rounded_true {
          border-radius: 0.375rem;
      }

        .buttonStyle--size_md {
          padding: 0 0.75rem;
          height: 3rem;
          min-width: 3rem;
      }

        .buttonStyle--variant_solid {
          background-color: blue;
          color: white;
      }

        .buttonStyle--variant_solid[data-disabled] {
          background-color: gray;
          color: black;
          font-size: var(--font-sizes-2xl);
      }

        .buttonStyle--variant_solid:is(:hover, [data-hover]) {
          background-color: darkblue;
      }

        .buttonStyle--size_sm {
          padding: 0 0.5rem;
          height: 2.5rem;
          min-width: 2.5rem;
      }

        .buttonStyle--variant_outline {
          border: 1px solid blue;
          background-color: transparent;
          color: blue;
      }

        .buttonStyle--variant_outline[data-disabled] {
          border: 1px solid gray;
          background-color: transparent;
          color: gray;
      }

        .buttonStyle--variant_outline:is(:hover, [data-hover]) {
          background-color: blue;
          color: white;
      }
      }

      @layer recipes.slots {
        .checkbox__root {
          gap: 2px;
          display: flex;
          align-items: center;
      }

        .checkbox__control {
          border-width: 1px;
          border-radius: var(--radii-sm);
      }

        .checkbox__label {
          margin-inline-start: 2px;
      }

        .badge__title {
          background: red.300;
          border-radius: var(--radii-sm);
      }

        @scope (.checkbox__root--size_sm) to (.checkbox__root) {
          .checkbox__control {
            text-style: headline.h1;
            width: var(--sizes-8);
            height: var(--sizes-8);
      }

          .checkbox__label {
            font-size: var(--font-sizes-sm);
      }
      }

        @scope (.checkbox__root--size_md) to (.checkbox__root) {
          .checkbox__control {
            width: var(--sizes-10);
            height: var(--sizes-10);
      }

          .checkbox__label {
            font-size: var(--font-sizes-md);
      }
      }

        @scope (.checkbox__root--size_lg) to (.checkbox__root) {
          .checkbox__control {
            width: var(--sizes-12);
            height: var(--sizes-12);
      }

          .checkbox__label {
            font-size: var(--font-sizes-lg);
      }
      }

        .badge__title--raised_true.badge__title--size_sm {
          color: ButtonHighlight;
      }

        .badge__title--size_sm {
          padding-inline: var(--spacing-4);
      }

        .badge__body--size_sm {
          color: red;
      }

        .badge__title--raised_true {
          box-shadow: var(--shadows-md);
      }
      }

      @layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._Btm_AK\\:c_ButtonHighlight {
            color: ButtonHighlight;
      }
        }
      }",
        "results": {
          "css": [
            {
              "color": "ButtonHighlight",
            },
          ],
          "patterns": [],
          "recipes": [
            {
              "textStyle": {},
            },
            {
              "textStyle": {
                "size": "h1",
              },
            },
            {
              "textStyle": {
                "size": "h2",
              },
            },
            {
              "tooltipStyle": {},
            },
            {
              "cardStyle": {},
            },
            {
              "cardStyle": {
                "rounded": "true",
              },
            },
            {
              "buttonStyle": {},
            },
            {
              "buttonStyle": {
                "size": "sm",
              },
            },
            {
              "buttonStyle": {
                "size": "md",
              },
            },
            {
              "buttonStyle": {
                "variant": "solid",
              },
            },
            {
              "buttonStyle": {
                "variant": "outline",
              },
            },
            {
              "checkbox": {},
            },
            {
              "checkbox": {
                "size": "sm",
              },
            },
            {
              "checkbox": {
                "size": "md",
              },
            },
            {
              "checkbox": {
                "size": "lg",
              },
            },
            {
              "badge": {},
            },
            {
              "badge": {
                "size": "sm",
              },
            },
            {
              "badge": {
                "raised": "true",
              },
            },
          ],
        },
      }
    `)
  })

  test('recipe + compoundVariants', () => {
    const ctx = new Context({
      ...conf,
      config: {
        ...conf.config,
        theme: {
          recipes: {
            ...conf.config?.theme?.recipes,
            withCompound: {
              className: 'withCompound',
              base: {
                fontSize: '1px',
              },
              variants: {
                size: {
                  sm: {
                    fontSize: '2px',
                  },
                },
              },
              compoundVariants: [
                {
                  size: ['sm'],
                  css: {
                    fontSize: '3px',
                    _hover: {
                      fontSize: '4px',
                      _dark: {
                        fontSize: '5px',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })
    const getStaticCss = (options: StaticCssOptions) => {
      const engine = ctx.staticCss.clone().process(options)
      return { results: engine.results, css: engine.sheet.toCss() }
    }

    expect(
      getStaticCss({
        recipes: {
          withCompound: ['*'],
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "css": "@layer recipes {
        .withCompound {
          font-size: 1px;
      }

        .withCompound--size_sm {
          font-size: 3px;
      }

        .withCompound--size_sm:is(:hover, [data-hover]) {
          font-size: 4px;
      }

        [data-theme=dark] .withCompound--size_sm:is(:hover, [data-hover]),.dark .withCompound--size_sm:is(:hover, [data-hover]),.withCompound--size_sm:is(:hover, [data-hover]).dark,.withCompound--size_sm:is(:hover, [data-hover])[data-theme=dark] {
          font-size: 5px;
      }

        .withCompound--size_sm {
          font-size: 2px;
      }
      }

      @layer utilities {
        @layer s010-c0-p3000, s020-c1-p3000, s030-c2-p3000;

        @layer s010-c0-p3000 {
          ._Ocpc8R\\:fs_3px {
            font-size: 3px;
      }
        }

        @layer s020-c1-p3000 {
          ._4TVktq\\:hover\\:fs_4px:is(:hover, [data-hover]) {
            font-size: 4px;
      }
        }

        @layer s030-c2-p3000 {

          [data-theme=dark] ._r4zVNZ\\:hover\\:dark\\:fs_5px:is(:hover, [data-hover]),.dark ._r4zVNZ\\:hover\\:dark\\:fs_5px:is(:hover, [data-hover]),._r4zVNZ\\:hover\\:dark\\:fs_5px:is(:hover, [data-hover]).dark,._r4zVNZ\\:hover\\:dark\\:fs_5px:is(:hover, [data-hover])[data-theme=dark] {
            font-size: 5px;
      }
        }
      }",
        "results": {
          "css": [
            {
              "fontSize": "3px",
            },
            {
              "_hover": {
                "_dark": {
                  "fontSize": "5px",
                },
                "fontSize": "4px",
              },
            },
          ],
          "patterns": [],
          "recipes": [
            {
              "withCompound": {},
            },
            {
              "withCompound": {
                "size": "sm",
              },
            },
          ],
        },
      }
    `)
  })

  test('container query', () => {
    const ctx = new Context({
      ...conf,
      config: {
        ...conf.config,
        theme: {
          ...conf.config?.theme,
          containerNames: ['pb'],
        },
      },
    })

    const getStaticCss = (options: StaticCssOptions) => {
      const engine = ctx.staticCss.clone().process(options)
      return { results: engine.results, css: engine.sheet.toCss() }
    }

    const result = getStaticCss({
      css: [
        {
          properties: {
            fontSize: ['7xl', '8xl'],
            fontWeight: ['*'],
          },
          conditions: ['@pb/sm', '@pb/md'],
        },
      ],
    })

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000, s010-c1-p3000, s010-c2-p3000;

        @layer s010-c0-p3000 {
          ._Ocpc8R\\:fs_7xl {
            font-size: var(--font-sizes-7xl);
      }

          ._Ocpc8R\\:fs_8xl {
            font-size: var(--font-sizes-8xl);
      }

          ._0vvNua\\:fw_thin {
            font-weight: var(--font-weights-thin);
      }

          ._0vvNua\\:fw_extralight {
            font-weight: var(--font-weights-extralight);
      }

          ._0vvNua\\:fw_light {
            font-weight: var(--font-weights-light);
      }

          ._0vvNua\\:fw_normal {
            font-weight: var(--font-weights-normal);
      }

          ._0vvNua\\:fw_medium {
            font-weight: var(--font-weights-medium);
      }

          ._0vvNua\\:fw_semibold {
            font-weight: var(--font-weights-semibold);
      }

          ._0vvNua\\:fw_bold {
            font-weight: var(--font-weights-bold);
      }

          ._0vvNua\\:fw_extrabold {
            font-weight: var(--font-weights-extrabold);
      }

          ._0vvNua\\:fw_black {
            font-weight: var(--font-weights-black);
      }
        }

        @layer s010-c1-p3000 {
          @container pb (inline-size >= 24rem) {
            ._4XMPHy\\:\\@pb\\/sm\\:fs_7xl {
              font-size: var(--font-sizes-7xl);
      }
            ._4XMPHy\\:\\@pb\\/sm\\:fs_8xl {
              font-size: var(--font-sizes-8xl);
      }
            ._CTn_Dx\\:\\@pb\\/sm\\:fw_thin {
              font-weight: var(--font-weights-thin);
      }
            ._CTn_Dx\\:\\@pb\\/sm\\:fw_extralight {
              font-weight: var(--font-weights-extralight);
      }
            ._CTn_Dx\\:\\@pb\\/sm\\:fw_light {
              font-weight: var(--font-weights-light);
      }
            ._CTn_Dx\\:\\@pb\\/sm\\:fw_normal {
              font-weight: var(--font-weights-normal);
      }
            ._CTn_Dx\\:\\@pb\\/sm\\:fw_medium {
              font-weight: var(--font-weights-medium);
      }
            ._CTn_Dx\\:\\@pb\\/sm\\:fw_semibold {
              font-weight: var(--font-weights-semibold);
      }
            ._CTn_Dx\\:\\@pb\\/sm\\:fw_bold {
              font-weight: var(--font-weights-bold);
      }
            ._CTn_Dx\\:\\@pb\\/sm\\:fw_extrabold {
              font-weight: var(--font-weights-extrabold);
      }
            ._CTn_Dx\\:\\@pb\\/sm\\:fw_black {
              font-weight: var(--font-weights-black);
      }
      }
        }

        @layer s010-c2-p3000 {
          @container pb (inline-size >= 28rem) {
            ._WFkQvz\\:\\@pb\\/md\\:fs_7xl {
              font-size: var(--font-sizes-7xl);
      }
            ._WFkQvz\\:\\@pb\\/md\\:fs_8xl {
              font-size: var(--font-sizes-8xl);
      }
            ._eQsZkm\\:\\@pb\\/md\\:fw_thin {
              font-weight: var(--font-weights-thin);
      }
            ._eQsZkm\\:\\@pb\\/md\\:fw_extralight {
              font-weight: var(--font-weights-extralight);
      }
            ._eQsZkm\\:\\@pb\\/md\\:fw_light {
              font-weight: var(--font-weights-light);
      }
            ._eQsZkm\\:\\@pb\\/md\\:fw_normal {
              font-weight: var(--font-weights-normal);
      }
            ._eQsZkm\\:\\@pb\\/md\\:fw_medium {
              font-weight: var(--font-weights-medium);
      }
            ._eQsZkm\\:\\@pb\\/md\\:fw_semibold {
              font-weight: var(--font-weights-semibold);
      }
            ._eQsZkm\\:\\@pb\\/md\\:fw_bold {
              font-weight: var(--font-weights-bold);
      }
            ._eQsZkm\\:\\@pb\\/md\\:fw_extrabold {
              font-weight: var(--font-weights-extrabold);
      }
            ._eQsZkm\\:\\@pb\\/md\\:fw_black {
              font-weight: var(--font-weights-black);
      }
      }
        }
      }"
    `)
  })

  test('arbitrary condition or selector', () => {
    const result = getStaticCss({
      css: [
        {
          properties: {
            fontSize: ['7xl', '8xl'],
          },
          conditions: ['@media (min-width: 24rem)', '.mobile &'],
        },
      ],
    })

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000, s010-c2-p3000, s020-c1-p3000;

        @layer s010-c0-p3000 {
          ._Ocpc8R\\:fs_7xl {
            font-size: var(--font-sizes-7xl);
      }

          ._Ocpc8R\\:fs_8xl {
            font-size: var(--font-sizes-8xl);
      }
        }

        @layer s010-c2-p3000 {
          @media (min-width: 24rem) {
            ._Q5Xn0-\\:\\[\\@media_\\(min-width\\:_24rem\\)\\]\\:fs_7xl {
              font-size: var(--font-sizes-7xl);
      }
            ._Q5Xn0-\\:\\[\\@media_\\(min-width\\:_24rem\\)\\]\\:fs_8xl {
              font-size: var(--font-sizes-8xl);
      }
      }
        }

        @layer s020-c1-p3000 {
          .mobile ._Z0R2SH\\:\\[\\.mobile_\\&\\]\\:fs_7xl {
            font-size: var(--font-sizes-7xl);
      }

          .mobile ._Z0R2SH\\:\\[\\.mobile_\\&\\]\\:fs_8xl {
            font-size: var(--font-sizes-8xl);
      }
        }
      }"
    `)
  })

  describe('conditional values', () => {
    test('base comes first, then the conditions in the order the rule named them', () => {
      const { results } = getStaticCss({
        css: [{ properties: { color: ['red.200'] }, conditions: ['dark', 'md', 'light'] }],
      })

      // Position, not just presence. The conditions are keys on the same object as `base`, and
      // which one an object-merge sees last is decided by this order.
      expect(Object.keys(results.css[0]!.color)).toEqual(['base', '_dark', 'md', '_light'])
    })

    test('a condition named __proto__ becomes an own key, not a prototype', () => {
      // Building the object by assignment rather than by spread would run the setter on
      // `Object.prototype` here and reparent the result instead of adding a key —
      // the same hazard `mergeProps`, `cloneStyles` and `splitProps` each guard against.
      const { results } = getStaticCss({
        css: [{ properties: { color: ['red.200'] }, conditions: ['__proto__'] }],
      })

      const value = results.css[0]!.color
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
      expect(Object.getOwnPropertyNames(value)).toEqual(['base', '__proto__'])
    })
  })

  /**
   * `responsive` appends the breakpoints to the rule's conditions, and the rule handed in is
   * the one in the user's config — both callers of `process` pass `ctx.config.staticCss`
   * itself. Appending in place therefore grew the config's own array every run.
   *
   * Nothing covered `responsive` at all before this, and every example in the docs sets it on
   * a rule with no `conditions`, where the `|| []` default hides the aliasing.
   */
  describe('responsive leaves the rule it was given alone', () => {
    // The rule travels alongside the options so each case can assert on the object it put in,
    // rather than digging it back out by a hardcoded name.
    const cases: [string, StaticCssOptions, { conditions: string[] }][] = [
      (() => {
        const rule = { properties: { color: ['red.200'] }, conditions: ['light'], responsive: true }
        return ['css', { css: [rule] }, rule]
      })(),
      (() => {
        const rule = { size: ['sm'], conditions: ['light'], responsive: true }
        return ['recipe', { recipes: { buttonStyle: [rule] } }, rule]
      })(),
      (() => {
        const rule = { properties: { ratio: ['4/3'] }, conditions: ['light'], responsive: true }
        return ['pattern', { patterns: { aspectRatio: [rule] } }, rule]
      })(),
    ]

    test.each(cases)('%s rule', (_kind, options, rule) => {
      const conditions = [...rule.conditions]

      getStaticCss(options)
      expect(rule.conditions).toEqual(conditions)

      // Twice, because the damage compounds: a second run appended a second set of
      // breakpoints on top of the first.
      getStaticCss(options)
      expect(rule.conditions).toEqual(conditions)
    })

    test('a recipe wildcard leaves the shared variant key map alone', () => {
      // The worst form of it, and the reason `withBreakpoints` copies rather than pushes.
      //
      // Under `recipes: '*'` the rule destructured is the recipe's own `variantKeyMap`, so a
      // variant named `conditions` binds its list of values to the very array the breakpoints
      // were appended to — and a variant named `responsive` makes that happen, since the flag
      // is only ever tested for truthiness. `variantKeyMap` lives in module-level state and is
      // stringified into the generated recipe artifact, so this reached user-facing output.
      const { hooks: h, ...rest } = fixtureDefaults
      const local = new Context({
        hooks: h,
        ...rest,
        config: {
          ...rest.config,
          theme: {
            ...JSON.parse(JSON.stringify(rest.config.theme)),
            recipes: {
              oddNames: {
                className: 'oddNames',
                base: { display: 'flex' },
                variants: {
                  conditions: { a: { color: 'red' }, b: { color: 'blue' } },
                  responsive: { yes: { display: 'block' } },
                  size: { sm: { fontSize: '12px' } },
                },
              },
            },
          },
        },
      } as typeof fixtureDefaults)

      const node: any = local.recipes.getRecipe('oddNames')
      const before = JSON.parse(JSON.stringify(node.variantKeyMap))

      local.staticCss.clone().process({ recipes: '*' })
      local.staticCss.clone().process({ recipes: '*' })

      expect(node.variantKeyMap).toEqual(before)
    })

    test.each([
      ['with other conditions', ['light'], ['light\\:c_red', 'md\\:c_red']],
      // The shape every example in the docs uses, and the one where the old `|| []` default
      // hid the aliasing — so it is also the one nothing was checking.
      ['on its own', undefined, ['c_red', 'md\\:c_red']],
    ] as [string, string[] | undefined, string[]][])(
      'the breakpoints still reach the css, %s',
      (_k, conds, expected) => {
        const { css } = getStaticCss({
          css: [{ properties: { color: ['red.200'] }, ...(conds && { conditions: conds }), responsive: true }],
        })

        for (const cls of expected) expect(css).toContain(cls)
      },
    )
  })
})

describe('static-css caching', () => {
  // Setup with limited tokens for faster tests
  const { hooks, ...defaults } = fixtureDefaults
  const conf = {
    hooks,
    ...defaults,
    config: {
      ...defaults.config,
      theme: JSON.parse(JSON.stringify(defaults.config.theme)),
    },
  } as typeof fixtureDefaults

  // @ts-expect-error
  conf.config.theme!.tokens.colors = {
    red: { 200: { value: 'red.200' } },
    blue: { 200: { value: 'blue.200' } },
  }

  const ctx = new Context(conf)

  test('cache hit on unchanged staticCss config', () => {
    const options = {
      css: [{ properties: { color: ['*'] } }],
      recipes: {
        buttonStyle: [{ size: ['md'] }],
      },
    }

    // First call - cache miss, should process
    const result1 = ctx.staticCss.process(options)
    const css1 = result1.sheet.toCss()

    // Second call with same options - cache hit, should reuse
    const result2 = ctx.staticCss.process(options)
    const css2 = result2.sheet.toCss()

    // Results should be identical
    expect(css1).toBe(css2)
    expect(result1.results).toEqual(result2.results)
  })

  test('cache miss on changed CSS rules', () => {
    const options1 = {
      css: [{ properties: { color: ['red.200'] } }],
    }

    const options2 = {
      css: [{ properties: { color: ['blue.200'] } }],
    }

    // Use a fresh clone to test cache miss detection
    const staticCss = ctx.staticCss.clone()

    const result1 = staticCss.process(options1)
    const css1 = result1.sheet.toCss()

    const result2 = staticCss.process(options2)
    const css2 = result2.sheet.toCss()

    // Results should be different
    expect(css1).not.toBe(css2)
    expect(css1).toContain('red')
    expect(css2).toContain('blue')
  })

  test('cache handles wildcard expansions', () => {
    const options = {
      css: [{ properties: { color: ['*'] } }],
    }

    // First call - expands wildcards
    const result1 = ctx.staticCss.process(options)
    expect(result1.results.css.length).toBeGreaterThan(0)

    // Second call with same options - should use cache
    const result2 = ctx.staticCss.process(options)
    expect(result1.results).toEqual(result2.results)
  })

  test('cache persists across multiple calls', () => {
    const options = {
      css: [{ properties: { margin: ['20px', '40px'] } }],
    }

    // Multiple calls with same options
    const result1 = ctx.staticCss.process(options)
    const result2 = ctx.staticCss.process(options)
    const result3 = ctx.staticCss.process(options)

    // All should produce identical results
    expect(result1.results).toEqual(result2.results)
    expect(result2.results).toEqual(result3.results)
  })

  test('wildcard expansion is memoized across calls', () => {
    const options = {
      css: [{ properties: { fontSize: ['*'] } }],
    }

    const staticCss = ctx.staticCss.clone()

    // First call expands wildcards
    const result1 = staticCss.process(options)
    const count1 = result1.results.css.length

    // Second call should reuse memoized expansion
    const result2 = staticCss.process(options)
    const count2 = result2.results.css.length

    // Should produce same results
    expect(count1).toBe(count2)
    expect(count1).toBeGreaterThan(0)
  })

  test('recipes: "*" should override individual recipe staticCss config', () => {
    // Create a context with a recipe that has its own staticCss config
    const confWithRecipeStaticCss = {
      hooks,
      ...defaults,
      config: {
        ...defaults.config,
        theme: {
          ...JSON.parse(JSON.stringify(defaults.config.theme)),
          recipes: {
            testRecipe: {
              className: 'testRecipe',
              base: { display: 'flex' },
              variants: {
                size: {
                  sm: { fontSize: '12px' },
                  md: { fontSize: '14px' },
                  lg: { fontSize: '16px' },
                },
                variant: {
                  primary: { color: 'blue' },
                  secondary: { color: 'gray' },
                },
              },
              // This recipe has its own staticCss config that only includes 'sm' size
              staticCss: [{ size: ['sm'] }],
            },
          },
        },
      },
    } as typeof fixtureDefaults

    const ctxWithStaticCss = new Context(confWithRecipeStaticCss)
    const getStaticCssWithCtx = (options: StaticCssOptions) => {
      const engine = ctxWithStaticCss.staticCss.clone().process(options)
      return { results: engine.results, css: engine.sheet.toCss() }
    }

    // When using recipes: "*", ALL variants should be generated
    // even though the recipe's staticCss only specifies ['sm']
    const result = getStaticCssWithCtx({ recipes: '*' })

    // Should include all size variants (sm, md, lg), not just sm
    expect(result.css).toContain('testRecipe--size_sm')
    expect(result.css).toContain('testRecipe--size_md')
    expect(result.css).toContain('testRecipe--size_lg')

    // Should include all variant variants (primary, secondary)
    expect(result.css).toContain('testRecipe--variant_primary')
    expect(result.css).toContain('testRecipe--variant_secondary')
  })
})
