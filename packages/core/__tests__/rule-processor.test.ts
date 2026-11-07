import { createGeneratorContext } from '@bamboocss/fixture'
import { logger } from '@bamboocss/logger'
import type { Config, Dict, RecipeDefinition, SlotRecipeDefinition } from '@bamboocss/types'
import { describe, expect, test, vi } from 'vitest'
import { RuleProcessor } from '../src/rule-processor'
import { createRuleProcessor } from './fixture'

const css = (styles: Dict, config?: Config) => {
  const result = createRuleProcessor(config).css(styles)
  return { className: result.getClassNames(), css: result.toCss() }
}

const recipe = (name: string, styles: Dict) => {
  const result = createRuleProcessor().recipe(name, styles)!
  return { className: result.getClassNames(), css: result.toCss() }
}

const cva = (styles: RecipeDefinition) => {
  const result = createRuleProcessor().cva(styles)!
  return { className: result.getClassNames(), css: result.toCss() }
}

const sva = (styles: SlotRecipeDefinition) => {
  const result = createRuleProcessor().sva(styles)!
  return { className: result.getClassNames(), css: result.toCss() }
}

const buttonRecipe = {
  className: 'btn',
  base: {
    lineHeight: '1.2',
    _focusVisible: {
      boxShadow: 'outline',
    },
    _disabled: {
      opacity: 0.4,
    },
    _hover: {
      _disabled: { bg: 'initial' },
    },
    display: 'inline-flex',
    outline: 'none',
    _focus: {
      zIndex: 1,
    },
  },
}

describe('rule processor', () => {
  test('simple', () => {
    const result = css({
      margin: 2,
      mx: 'token(spacing.2)',
      my: '-2',
      color: 'blue.300',
    })
    expect(result.className).toMatchInlineSnapshot(`
      [
        "_0OoTQY\\:m_2",
        "_0QmaUN\\:mx_token\\(spacing\\.2\\)",
        "_F2GXY7\\:my_-2",
        "_Btm_AK\\:c_blue\\.300",
      ]
    `)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000, s010-c0-p2000, s010-c0-p3000;

        @layer s010-c0-p1000 {
          ._0OoTQY\\:m_2 {
            margin: var(--spacing-2);
      }
        }

        @layer s010-c0-p2000 {
          ._0QmaUN\\:mx_token\\(spacing\\.2\\) {
            margin-inline: var(--spacing-2);
      }

          ._F2GXY7\\:my_-2 {
            margin-block: calc(var(--spacing-2) * -1);
      }
        }

        @layer s010-c0-p3000 {
          ._Btm_AK\\:c_blue\\.300 {
            color: var(--colors-blue-300);
      }
        }
      }"
    `)
  })

  test('simple with formatTokenName', () => {
    const result = css(
      {
        margin: '$2',
        mx: 'token($spacing-2)',
        my: '-$2',
        color: '$blue-300',
      },
      {
        plugins: [
          {
            name: 'test',
            hooks: {
              'tokens:created': ({ configure }) => {
                configure({
                  formatTokenName: (path: string[]) => '$' + path.join('-'),
                })
              },
            },
          },
        ],
      },
    )
    expect(result.className).toMatchInlineSnapshot(`
      [
        "_0OoTQY\\:m_\\$2",
        "_0QmaUN\\:mx_token\\(\\$spacing-2\\)",
        "_F2GXY7\\:my_-\\$2",
        "_Btm_AK\\:c_\\$blue-300",
      ]
    `)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000, s010-c0-p2000, s010-c0-p3000;

        @layer s010-c0-p1000 {
          ._0OoTQY\\:m_\\$2 {
            margin: var(--spacing-2);
      }
        }

        @layer s010-c0-p2000 {
          ._0QmaUN\\:mx_token\\(\\$spacing-2\\) {
            margin-inline: var(--spacing-2);
      }

          ._F2GXY7\\:my_-\\$2 {
            margin-block: calc(var(--spacing-2) * -1);
      }
        }

        @layer s010-c0-p3000 {
          ._Btm_AK\\:c_\\$blue-300 {
            color: var(--colors-blue-300);
      }
        }
      }"
    `)
  })

  test('token() with formatTokenName', () => {
    const result = css(
      {
        mx: 'token($spacing-2)',
      },
      {
        plugins: [
          {
            name: 'test',
            hooks: {
              'tokens:created': ({ configure }) => {
                configure({
                  formatTokenName: (path: string[]) => '$' + path.join('-'),
                })
              },
            },
          },
        ],
      },
    )
    expect(result.className).toMatchInlineSnapshot(`
      [
        "_0QmaUN\\:mx_token\\(\\$spacing-2\\)",
      ]
    `)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000;

        @layer s010-c0-p2000 {
          ._0QmaUN\\:mx_token\\(\\$spacing-2\\) {
            margin-inline: var(--spacing-2);
      }
        }
      }"
    `)
  })

  test('simple - hash: true', () => {
    const result = css(
      {
        margin: 2,
        mx: 'token(spacing.2)',
        my: '-2',
        color: 'blue.300',
      },
      { hash: true },
    )
    expect(result.className).toMatchInlineSnapshot(`
      [
        "_0OoTQY\\:0o9xc",
        "_0QmaUN\\:saVJp",
        "_F2GXY7\\:814sY",
        "_Btm_AK\\:Me-Ah",
      ]
    `)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000, s010-c0-p2000, s010-c0-p3000;

        @layer s010-c0-p1000 {
          ._0OoTQY\\:0o9xc {
            margin: var(--ebuyxV);
      }
        }

        @layer s010-c0-p2000 {
          ._0QmaUN\\:saVJp {
            margin-inline: var(--ebuyxV);
      }

          ._F2GXY7\\:814sY {
            margin-block: calc(var(--ebuyxV) * -1);
      }
        }

        @layer s010-c0-p3000 {
          ._Btm_AK\\:Me-Ah {
            color: var(--bMEoOM);
      }
        }
      }"
    `)
  })

  // A utility class has the fixed shape the runtime `cx` merges by, so a hook's hash cannot name
  // it. Ignoring the hook with nothing said would leave the config claiming otherwise; it is
  // reported as the config's other problems are.
  test('a custom toHash is reported, not used', () => {
    const plugins: Config['plugins'] = [
      {
        name: 'test',
        hooks: {
          'utility:created': ({ configure }) => {
            configure({ toHash: (paths, toHash) => `x${toHash(paths.join(':'))}` })
          },
        },
      },
    ]

    expect(() => css({ color: 'blue.300' }, { hash: true, validation: 'error', plugins })).toThrow(
      'configures `toHash`, which is no longer used',
    )
    expect(css({ color: 'blue.300' }, { hash: true, plugins }).className).toEqual(
      css({ color: 'blue.300' }, { hash: true }).className,
    )
  })

  // Hooks of one name run in plugin order. Run across microtasks, a later plugin configured after
  // the context had looked, and its `toHash` passed unreported even under `validation: 'error'`.
  test('a custom toHash is reported whichever plugin configures it', () => {
    const plugins: Config['plugins'] = [
      { name: 'first', hooks: { 'utility:created': () => {} } },
      {
        name: 'second',
        hooks: {
          'utility:created': ({ configure }) => {
            configure({ toHash: (paths, toHash) => `x${toHash(paths.join(':'))}` })
          },
        },
      },
    ]

    expect(() => css({ color: 'blue.300' }, { validation: 'error', plugins })).toThrow(
      'configures `toHash`, which is no longer used',
    )
  })

  test('a custom toHash configured past an await is still reported, as a warning', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const plugins: Config['plugins'] = [
      {
        name: 'async',
        hooks: {
          'utility:created': async ({ configure }) => {
            await Promise.resolve()
            configure({ toHash: (paths, toHash) => `x${toHash(paths.join(':'))}` })
          },
        },
      },
    ]

    try {
      // Too late to fail: the context is built by then.
      expect(() => css({ color: 'blue.300' }, { validation: 'error', plugins })).not.toThrow()
      await new Promise((resolve) => setTimeout(resolve))
      expect(warn).toHaveBeenCalledWith(
        'config',
        expect.stringContaining('configures `toHash`, which is no longer used'),
      )
    } finally {
      warn.mockRestore()
    }
  })

  test('css', () => {
    const result = css({
      color: 'red !important',
      border: '1px solid token(colors.red.100)',
      bg: 'blue.300',
      textStyle: 'headline.h1',
      w: { base: 1, sm: 2, xl: 3 },
      fontSize: {
        base: 'xs',
        sm: 'sm',
        _hover: {
          base: 'md',
          md: 'lg',
          _focus: 'xl',
        },
        _dark: '2xl',
      },
      sm: {
        color: 'yellow',
        backgroundColor: {
          base: 'red',
          _hover: 'green',
        },
      },
      "&[data-attr='test']": {
        color: 'green',
        _expanded: {
          color: 'purple',
          '.target &': {
            color: {
              base: 'cyan',
              _open: 'orange',
              xl: 'pink',
            },
          },
        },
      },
    })

    expect(result.className).toMatchInlineSnapshot(
      `
      [
        "_Ucco6y\\:bd_1px_solid_token\\(colors\\.red\\.100\\)",
        "_w1ddk4\\:bg_blue\\.300",
        "_Btm_AK\\:c_red",
        "_NCgunH\\:text-style_headline\\.h1",
        "_Ocpc8R\\:fs_xs",
        "_RO16FJ\\:w_1",
        "_x8EGI-\\:dark\\:fs_2xl",
        "_7PVsr_\\:\\[\\&\\[data-attr\\=\\'test\\'\\]\\]\\:c_green",
        "_4TVktq\\:hover\\:fs_md",
        "_JmDpTb\\:\\[\\&\\[data-attr\\=\\'test\\'\\]\\]\\:expanded\\:c_purple",
        "_Pkd43n\\:hover\\:focus\\:fs_xl",
        "_9RXBzD\\:\\[\\&\\[data-attr\\=\\'test\\'\\]\\]\\:expanded\\:\\[\\.target_\\&\\]\\:c_cyan",
        "_ox3CAu\\:\\[\\&\\[data-attr\\=\\'test\\'\\]\\]\\:expanded\\:\\[\\.target_\\&\\]\\:open\\:c_orange",
        "_EL8lrA\\:sm\\:fs_sm",
        "_8AVSDl\\:sm\\:c_yellow",
        "_esN9BA\\:sm\\:bg-c_red",
        "_R1Rk0r\\:sm\\:w_2",
        "_R_1T2h\\:sm\\:hover\\:bg-c_green",
        "_O5rls-\\:hover\\:md\\:fs_lg",
        "_gLb3Mu\\:xl\\:w_3",
        "_b1qsXj\\:\\[\\&\\[data-attr\\=\\'test\\'\\]\\]\\:expanded\\:\\[\\.target_\\&\\]\\:xl\\:c_pink",
      ]
    `,
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000, s010-c0-p3000, s010-c0-p4000, s010-c8-p3000, s010-c8-p4000, s010-c11-p4000, s020-c1-p3000, s020-c2-p3000, s020-c3-p3000, s020-c9-p3000, s020-c10-p3000, s030-c4-p3000, s030-c5-p3000, s040-c6-p3000, s040-c12-p3000, s050-c7-p3000, important;

        @layer s010-c0-p1000 {
          ._Ucco6y\\:bd_1px_solid_token\\(colors\\.red\\.100\\) {
            border: 1px solid var(--colors-red-100);
      }

          ._w1ddk4\\:bg_blue\\.300 {
            background: var(--colors-blue-300);
      }
        }

        @layer s010-c0-p3000 {
          ._NCgunH\\:text-style_headline\\.h1 {
            text-style: headline.h1;
      }

          ._Ocpc8R\\:fs_xs {
            font-size: var(--font-sizes-xs);
      }
        }

        @layer s010-c0-p4000 {
          ._RO16FJ\\:w_1 {
            width: var(--sizes-1);
      }
        }

        @layer s010-c8-p3000 {
          @media (width >= 40rem) {
            ._EL8lrA\\:sm\\:fs_sm {
              font-size: var(--font-sizes-sm);
      }
            ._8AVSDl\\:sm\\:c_yellow {
              color: yellow;
      }
            ._esN9BA\\:sm\\:bg-c_red {
              background-color: red;
      }
      }
        }

        @layer s010-c8-p4000 {
          @media (width >= 40rem) {
            ._R1Rk0r\\:sm\\:w_2 {
              width: var(--sizes-2);
      }
      }
        }

        @layer s010-c11-p4000 {
          @media (width >= 80rem) {
            ._gLb3Mu\\:xl\\:w_3 {
              width: var(--sizes-3);
      }
      }
        }

        @layer s020-c1-p3000 {

          [data-theme=dark] ._x8EGI-\\:dark\\:fs_2xl,.dark ._x8EGI-\\:dark\\:fs_2xl,._x8EGI-\\:dark\\:fs_2xl.dark,._x8EGI-\\:dark\\:fs_2xl[data-theme=dark] {
            font-size: var(--font-sizes-2xl);
      }
        }

        @layer s020-c2-p3000 {
          ._7PVsr_\\:\\[\\&\\[data-attr\\=\\'test\\'\\]\\]\\:c_green[data-attr='test'] {
            color: green;
      }
        }

        @layer s020-c3-p3000 {
          ._4TVktq\\:hover\\:fs_md:is(:hover, [data-hover]) {
            font-size: var(--font-sizes-md);
      }
        }

        @layer s020-c9-p3000 {
          @media (width >= 40rem) {
            ._R_1T2h\\:sm\\:hover\\:bg-c_green:is(:hover, [data-hover]) {
              background-color: green;
      }
      }
        }

        @layer s020-c10-p3000 {
          @media (width >= 48rem) {
            ._O5rls-\\:hover\\:md\\:fs_lg:is(:hover, [data-hover]) {
              font-size: var(--font-sizes-lg);
      }
      }
        }

        @layer s030-c4-p3000 {
          ._JmDpTb\\:\\[\\&\\[data-attr\\=\\'test\\'\\]\\]\\:expanded\\:c_purple[data-attr='test']:is([aria-expanded=true], [data-expanded], [data-state="expanded"]) {
            color: purple;
      }
        }

        @layer s030-c5-p3000 {
          ._Pkd43n\\:hover\\:focus\\:fs_xl:is(:hover, [data-hover]):is(:focus, [data-focus]) {
            font-size: var(--font-sizes-xl);
      }
        }

        @layer s040-c6-p3000 {
          .target ._9RXBzD\\:\\[\\&\\[data-attr\\=\\'test\\'\\]\\]\\:expanded\\:\\[\\.target_\\&\\]\\:c_cyan[data-attr='test']:is([aria-expanded=true], [data-expanded], [data-state="expanded"]) {
            color: cyan;
      }
        }

        @layer s040-c12-p3000 {
          @media (width >= 80rem) {
            .target ._b1qsXj\\:\\[\\&\\[data-attr\\=\\'test\\'\\]\\]\\:expanded\\:\\[\\.target_\\&\\]\\:xl\\:c_pink[data-attr='test']:is([aria-expanded=true], [data-expanded], [data-state="expanded"]) {
              color: pink;
      }
      }
        }

        @layer s050-c7-p3000 {
          .target ._ox3CAu\\:\\[\\&\\[data-attr\\=\\'test\\'\\]\\]\\:expanded\\:\\[\\.target_\\&\\]\\:open\\:c_orange[data-attr='test']:is([aria-expanded=true], [data-expanded], [data-state="expanded"]):is([open], [data-open], [data-state="open"], :popover-open) {
            color: orange;
      }
        }

        @layer important {
          ._Btm_AK\\:c_red\\! {
            color: red !important;
      }
        }
      }"
    `)
  })

  test('recipe', () => {
    const result = recipe('buttonStyle', { size: { base: 'sm', md: 'md' } })

    expect(result.className).toMatchInlineSnapshot(`
      [
        "buttonStyle--size_sm",
        "md\\:buttonStyle--size_md",
        "buttonStyle--variant_solid",
        "buttonStyle",
      ]
    `)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer recipes {
        .buttonStyle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
      }

        .buttonStyle:is(:hover, [data-hover]) {
          background-color: var(--colors-red-200);
          font-size: var(--font-sizes-3xl);
          color: var(--colors-white);
      }

        .buttonStyle--size_sm {
          padding: 0 0.5rem;
          height: 2.5rem;
          min-width: 2.5rem;
      }

        .buttonStyle--variant_solid {
          background-color: blue;
          color: var(--colors-white);
      }

        .buttonStyle--variant_solid[data-disabled] {
          background-color: gray;
          color: var(--colors-black);
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
      }"
    `)
  })

  test('cva', () => {
    // packages/fixture/src/recipes.ts
    const buttonStyle = cva({
      base: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      variants: {
        size: {
          sm: {
            textStyle: 'headline.h1',
            height: '2.5rem',
            minWidth: '2.5rem',
            padding: '0 0.5rem',
          },
          md: {
            height: '3rem',
            minWidth: '3rem',
            padding: '0 0.75rem',
          },
        },
        variant: {
          solid: {
            backgroundColor: 'blue',
            color: 'white',
            _hover: {
              backgroundColor: 'darkblue',
            },
            '&[data-disabled]': {
              backgroundColor: 'gray',
              color: 'black',
            },
          },
          outline: {
            backgroundColor: 'transparent',
            border: '1px solid blue',
            color: 'blue',
            _hover: {
              backgroundColor: 'blue',
              color: 'white',
            },
            '&[data-disabled]': {
              backgroundColor: 'transparent',
              border: '1px solid gray',
              color: 'gray',
            },
          },
        },
      },
      defaultVariants: {
        size: 'md',
        variant: 'solid',
      },
    })

    expect(buttonStyle.className).toMatchInlineSnapshot(`
      [
        "cva_ikTMbL--size_sm",
        "cva_ikTMbL--size_md",
        "cva_ikTMbL--variant_solid",
        "cva_ikTMbL--variant_outline",
        "cva_ikTMbL",
      ]
    `)
    expect(buttonStyle.css).toMatchInlineSnapshot(`
      "@layer recipes {
        .cva_ikTMbL {
          display: inline-flex;
          align-items: center;
          justify-content: center;
      }

        .cva_ikTMbL--size_sm {
          padding: 0 0.5rem;
          text-style: headline.h1;
          height: 2.5rem;
          min-width: 2.5rem;
      }

        .cva_ikTMbL--size_md {
          padding: 0 0.75rem;
          height: 3rem;
          min-width: 3rem;
      }

        .cva_ikTMbL--variant_solid {
          background-color: blue;
          color: var(--colors-white);
      }

        .cva_ikTMbL--variant_solid[data-disabled] {
          background-color: gray;
          color: var(--colors-black);
      }

        .cva_ikTMbL--variant_solid:is(:hover, [data-hover]) {
          background-color: darkblue;
      }

        .cva_ikTMbL--variant_outline {
          border: 1px solid blue;
          background-color: var(--colors-transparent);
          color: blue;
      }

        .cva_ikTMbL--variant_outline[data-disabled] {
          border: 1px solid gray;
          background-color: var(--colors-transparent);
          color: gray;
      }

        .cva_ikTMbL--variant_outline:is(:hover, [data-hover]) {
          background-color: blue;
          color: var(--colors-white);
      }
      }"
    `)
  })

  test('slot recipe', () => {
    const result = recipe('checkbox', { size: { base: 'sm', md: 'md' } })

    expect(result.className).toMatchInlineSnapshot(`
      [
        "checkbox__root--size_sm",
        "md\\:checkbox__root--size_md",
        "checkbox__root",
        "checkbox__control",
        "checkbox__label",
      ]
    `)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer recipes.slots {
        .checkbox__root {
          gap: var(--spacing-2);
          display: flex;
          align-items: center;
      }

        .checkbox__control {
          border-width: 1px;
          border-radius: var(--radii-sm);
      }

        .checkbox__label {
          margin-inline-start: var(--spacing-2);
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
          @media (width >= 48rem) {
            .checkbox__control {
              width: var(--sizes-10);
              height: var(--sizes-10);
      }
            .checkbox__label {
              font-size: var(--font-sizes-md);
      }
      }
      }
      }"
    `)
  })

  test('sva', () => {
    // packages/fixture/src/slot-recipes.ts
    const checkbox = sva({
      slots: ['root', 'control', 'label'],
      base: {
        root: { display: 'flex', alignItems: 'center', gap: '2' },
        control: { borderWidth: '1px', borderRadius: 'sm' },
        label: { marginStart: '2' },
      },
      variants: {
        size: {
          sm: {
            control: { width: '8', height: '8' },
            label: { fontSize: 'sm' },
          },
          md: {
            control: { width: '10', height: '10' },
            label: { fontSize: 'md' },
          },
          lg: {
            control: { width: '12', height: '12' },
            label: { fontSize: 'lg' },
          },
        },
      },
      defaultVariants: {
        size: 'sm',
      },
    })

    expect(checkbox.className).toMatchInlineSnapshot(`
      [
        "sva_jyzfQI__root--size_sm",
        "sva_jyzfQI__root--size_md",
        "sva_jyzfQI__root--size_lg",
        "sva_jyzfQI__root",
        "sva_jyzfQI__control",
        "sva_jyzfQI__label",
      ]
    `)
    expect(checkbox.css).toMatchInlineSnapshot(`
      "@layer recipes.slots {
        .sva_jyzfQI__root {
          gap: var(--spacing-2);
          display: flex;
          align-items: center;
      }

        .sva_jyzfQI__control {
          border-width: 1px;
          border-radius: var(--radii-sm);
      }

        .sva_jyzfQI__label {
          margin-inline-start: var(--spacing-2);
      }

        @scope (.sva_jyzfQI__root--size_sm) to (.sva_jyzfQI__root) {
          .sva_jyzfQI__control {
            width: var(--sizes-8);
            height: var(--sizes-8);
      }

          .sva_jyzfQI__label {
            font-size: var(--font-sizes-sm);
      }
      }

        @scope (.sva_jyzfQI__root--size_md) to (.sva_jyzfQI__root) {
          .sva_jyzfQI__control {
            width: var(--sizes-10);
            height: var(--sizes-10);
      }

          .sva_jyzfQI__label {
            font-size: var(--font-sizes-md);
      }
      }

        @scope (.sva_jyzfQI__root--size_lg) to (.sva_jyzfQI__root) {
          .sva_jyzfQI__control {
            width: var(--sizes-12);
            height: var(--sizes-12);
      }

          .sva_jyzfQI__label {
            font-size: var(--font-sizes-lg);
      }
      }
      }"
    `)
  })

  test('simple recipe with alterning no-condition/condition props', () => {
    const processor = createRuleProcessor({
      theme: {
        extend: {
          recipes: {
            button: buttonRecipe,
          },
        },
      },
    })

    const result = processor.recipe('button', {})!
    expect(result.getClassNames()).toMatchInlineSnapshot(`
      [
        "btn",
      ]
    `)
    expect(result.toCss()).toMatchInlineSnapshot(`
      "@layer recipes {
        .btn {
          outline: 2px solid transparent;
          outline-offset: 2px;
          line-height: 1.2;
          display: inline-flex;
      }

        .btn:is(:disabled, [disabled], [data-disabled], [aria-disabled=true]) {
          opacity: 0.4;
      }

        .btn:is(:focus, [data-focus]) {
          z-index: 1;
      }

        .btn:is(:focus-visible, [data-focus-visible]) {
          box-shadow: outline;
      }

        .btn:is(:hover, [data-hover]):is(:disabled, [disabled], [data-disabled], [aria-disabled=true]) {
          background: initial;
      }
      }"
    `)
  })

  test('mixed together', () => {
    const processor = createRuleProcessor({
      theme: {
        extend: {
          recipes: {
            button: buttonRecipe,
          },
        },
      },
    })
    processor.clone()
    processor.css({
      color: 'blue.300',
      _hover: {
        color: 'red.400',
      },
    })

    processor.recipe('button', {
      size: {
        base: 'sm',
        md: 'md',
      },
      variant: 'solid',
    })

    processor.cva({
      base: {
        fontSize: '12px',
      },
      variants: {
        size: {
          sm: {
            fontSize: '14px',
          },
          md: {
            fontSize: '16px',
          },
        },
      },
      compoundVariants: [
        {
          size: 'sm',
          css: {
            border: '2px solid token(colors.green.100)',
          } as any,
        },
      ],
    })

    expect(processor.toCss()).toMatchInlineSnapshot(`
      "@layer recipes {
        .btn {
          outline: 2px solid transparent;
          outline-offset: 2px;
          line-height: 1.2;
          display: inline-flex;
      }

        .btn:is(:disabled, [disabled], [data-disabled], [aria-disabled=true]) {
          opacity: 0.4;
      }

        .btn:is(:focus, [data-focus]) {
          z-index: 1;
      }

        .btn:is(:focus-visible, [data-focus-visible]) {
          box-shadow: outline;
      }

        .btn:is(:hover, [data-hover]):is(:disabled, [disabled], [data-disabled], [aria-disabled=true]) {
          background: initial;
      }

        .cva_kmejoV {
          font-size: 12px;
      }

        .cva_kmejoV--size_sm {
          font-size: 14px;
      }

        .cva_kmejoV--size_md {
          font-size: 16px;
      }

        .cva_kmejoV--size_sm {
          border: 2px solid var(--colors-green-100);
      }
      }

      @layer utilities {
        @layer s010-c0-p3000, s020-c1-p3000;

        @layer s010-c0-p3000 {
          ._Btm_AK\\:c_blue\\.300 {
            color: var(--colors-blue-300);
      }
        }

        @layer s020-c1-p3000 {
          ._nRd69H\\:hover\\:c_red\\.400:is(:hover, [data-hover]) {
            color: var(--colors-red-400);
      }
        }
      }"
    `)
  })

  test('fromJSON', () => {
    const ctx = createGeneratorContext()
    const processor = new RuleProcessor(ctx as any)

    const step1 = processor.clone()

    step1.encoder.fromJSON({
      schemaVersion: 'x',
      styles: { atomic: ['color]___[value:red', 'color]___[value:blue'] },
    })

    step1.decoder.collect(step1.encoder)

    expect(processor.toCss()).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._Btm_AK\\:c_red {
            color: red;
      }

          ._Btm_AK\\:c_blue {
            color: blue;
      }
        }
      }"
    `)

    const step2 = processor.clone()

    step2.encoder.fromJSON({
      schemaVersion: 'x',
      styles: { recipes: { buttonStyle: ['variant]___[value:solid'] } },
    })

    step2.decoder.collect(step2.encoder)

    expect(processor.toCss()).toMatchInlineSnapshot(`
      "@layer recipes {
        .buttonStyle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
      }

        .buttonStyle:is(:hover, [data-hover]) {
          background-color: var(--colors-red-200);
          font-size: var(--font-sizes-3xl);
          color: var(--colors-white);
      }

        ._ilERhA\\:variant_solid {
          variant: solid;
      }
      }"
    `)

    const step3 = processor.clone()

    step3.encoder.fromJSON({
      schemaVersion: 'x',
      styles: {
        atomic: [
          'display]___[value:none',
          'height]___[value:100%',
          'transition]___[value:all .3s ease-in-out',
          'opacity]___[value:0 !important',
          'opacity]___[value:1',
          'height]___[value:10px',
          'backgroundGradient]___[value:to-b',
          'gradientFrom]___[value:rgb(200 200 200 / .4)',
        ],
        recipes: {
          checkbox: [
            'size]___[value:md]___[recipe:checkbox]___[slot:container',
            'size]___[value:md]___[recipe:checkbox]___[slot:control',
            'size]___[value:md]___[recipe:checkbox]___[slot:label',
          ],
        },
      },
    })

    step3.decoder.collect(step3.encoder)
    expect(step3.toCss()).toMatchInlineSnapshot(`
      "@layer recipes.slots {
        .checkbox__root {
          gap: var(--spacing-2);
          display: flex;
          align-items: center;
      }

        .checkbox__control {
          border-width: 1px;
          border-radius: var(--radii-sm);
      }

        .checkbox__label {
          margin-inline-start: var(--spacing-2);
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
      }

      @layer utilities {
        @layer s010-c0-p2000, s010-c0-p3000, s010-c0-p4000, important;

        @layer s010-c0-p2000 {
          ._drhFNn\\:trs_all_0\\.3s_ease-in-out {
            transition: all 0.3s ease-in-out;
      }
        }

        @layer s010-c0-p3000 {
          ._Fg8Gj5\\:d_none {
            display: none;
      }

          ._eEO7Qc\\:op_1 {
            opacity: 1;
      }

          ._tMsygv\\:bg-grad_to-b {
            --gradient-stops: var(--gradient-via-stops, var(--gradient-position), var(--gradient-from) var(--gradient-from-position, ), var(--gradient-to) var(--gradient-to-position, ));
            --gradient-position: to bottom;
            background-image: linear-gradient(var(--gradient-stops));
      }

          ._dkehTS\\:grad-from_rgb\\(200_200_200_\\/_0\\.4\\) {
            --gradient-from: rgb(200 200 200 / 0.4);
      }
        }

        @layer s010-c0-p4000 {
          ._97NnCm\\:h_100\\% {
            height: 100%;
      }

          ._97NnCm\\:h_10px {
            height: 10px;
      }
        }

        @layer important {
          ._eEO7Qc\\:op_0\\! {
            opacity: 0 !important;
      }
        }
      }"
    `)
  })

  test('css - boolean utility', () => {
    const result = css({ truncate: false })
    expect(result).toMatchInlineSnapshot(`
      {
        "className": [
          "_ahCW1T\\:trunc_false",
        ],
        "css": "",
      }
    `)

    const result2 = css({ truncate: true })
    expect(result2).toMatchInlineSnapshot(`
      {
        "className": [
          "_ahCW1T\\:trunc_true",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._ahCW1T\\:trunc_true {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
      }
        }
      }",
      }
    `)
  })

  test('cva - boolean variant', () => {
    const result = cva({
      base: {
        color: '#fff',
      },
      variants: {
        checked: {
          true: {
            display: 'block',
          },
          false: {
            display: 'none',
          },
        },
      },
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "className": [
          "cva_fAqhGZ--checked_true",
          "cva_fAqhGZ--checked_false",
          "cva_fAqhGZ",
        ],
        "css": "@layer recipes {
        .cva_fAqhGZ {
          color: #fff;
      }

        .cva_fAqhGZ--checked_true {
          display: block;
      }

        .cva_fAqhGZ--checked_false {
          display: none;
      }
      }",
      }
    `)
  })
})

describe('js to css', () => {
  test('ignores declarations with null', () => {
    const result = css({
      font: undefined,
      color: null,
      background: false,
    })

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {}
      }"
    `)
  })

  test('unitless', () => {
    const result = css({
      '--foo': 42,
      width: 42,
      opacity: 1,
      zIndex: 0,
    })

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1, s010-c0-p3000, s010-c0-p4000;

        @layer s010-c0-p1 {
          ._xcmuKg\\:--foo_42 {
            --foo: 42;
      }
        }

        @layer s010-c0-p3000 {
          ._eEO7Qc\\:op_1 {
            opacity: 1;
      }

          ._Fmfkg3\\:z_0 {
            z-index: 0;
      }
        }

        @layer s010-c0-p4000 {
          ._RO16FJ\\:w_42 {
            width: 42px;
      }
        }
      }"
    `)
  })

  test('preserves casing for css variable', () => {
    const result = css({
      '--testVariable0': '0',
      '--test-Variable-1': '1',
      '--test-variable-2': '2',
    })

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1;

        @layer s010-c0-p1 {
          ._wgYpz2\\:--testVariable0_0 {
            --testVariable0: 0;
      }

          ._ZoaNGs\\:--test-Variable-1_1 {
            --test-Variable-1: 1;
      }

          ._AiKdN4\\:--test-variable-2_2 {
            --test-variable-2: 2;
      }
        }
      }"
    `)
  })

  test('parses declarations with !important', () => {
    const result = css({
      borderColor: 'red !important',
      color: 'pink!',
      background: 'white!IMPORTANT  ',
      fontFamily: 'A',
    })

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000, important;

        @layer s010-c0-p3000 {
          ._XRP-xG\\:ff_A {
            font-family: A;
      }
        }

        @layer important {
          ._w1ddk4\\:bg_white\\! {
            background: var(--colors-white) !important;
      }

          ._3r1mEt\\:bd-c_red\\! {
            border-color: red !important;
      }

          ._Btm_AK\\:c_pink\\! {
            color: pink !important;
      }
        }
      }"
    `)
  })

  test('color mix', () => {
    expect(css({ bg: 'red.300/40', color: 'white' })).toMatchInlineSnapshot(`
      {
        "className": [
          "_w1ddk4\\:bg_red\\.300\\/40",
          "_Btm_AK\\:c_white",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p1000, s010-c0-p3000;

        @layer s010-c0-p1000 {
          ._w1ddk4\\:bg_red\\.300\\/40 {
            background: color-mix(in srgb, var(--colors-red-300) 40%, transparent);
      }
        }

        @layer s010-c0-p3000 {
          ._Btm_AK\\:c_white {
            color: var(--colors-white);
      }
        }
      }",
      }
    `)
  })

  test('resolve property conflicts and order - border example', () => {
    const result = css({
      borderWidth: '1px',
      borderTopRadius: '0px',
      borderBottomWidth: '3px',
      overflow: 'hidden',
      base: {
        borderWidth: '2px',
      },
    })
    expect(result.className).toMatchInlineSnapshot(`
      [
        "_WSEF0_\\:bd-w_1px",
        "_2EQUH3\\:ov_hidden",
        "_WSEF0_\\:bd-w_2px",
        "_-SUxCQ\\:bdr-t_0px",
        "__XJ_UB\\:bd-b-w_3px",
      ]
    `)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000, s010-c0-p3000, s010-c0-p4000;

        @layer s010-c0-p2000 {
          ._WSEF0_\\:bd-w_1px {
            border-width: 1px;
      }

          ._2EQUH3\\:ov_hidden {
            overflow: hidden;
      }

          ._WSEF0_\\:bd-w_2px {
            border-width: 2px;
      }
        }

        @layer s010-c0-p3000 {
          ._-SUxCQ\\:bdr-t_0px {
            border-top-left-radius: 0px;
            border-top-right-radius: 0px;
      }
        }

        @layer s010-c0-p4000 {
          .__XJ_UB\\:bd-b-w_3px {
            border-bottom-width: 3px;
      }
        }
      }"
    `)
  })

  test('resolve property conflicts and order - padding example', () => {
    const result = css({
      padding: '1px',
      paddingTop: '3px',
      paddingBottom: '4px',
      base: {
        padding: '2px',
      },
    })
    expect(result.className).toMatchInlineSnapshot(`
      [
        "_DJEIKl\\:p_1px",
        "_DJEIKl\\:p_2px",
        "_8vGfGg\\:pt_3px",
        "_JZNFJc\\:pb_4px",
      ]
    `)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000, s010-c0-p4000;

        @layer s010-c0-p1000 {
          ._DJEIKl\\:p_1px {
            padding: 1px;
      }

          ._DJEIKl\\:p_2px {
            padding: 2px;
      }
        }

        @layer s010-c0-p4000 {
          ._8vGfGg\\:pt_3px {
            padding-top: 3px;
      }

          ._JZNFJc\\:pb_4px {
            padding-bottom: 4px;
      }
        }
      }"
    `)
  })

  test('more specific should always be last (red then blue)', () => {
    const result = css({
      backgroundColor: 'blue',
      background: 'red',
      _hover: {
        background: 'red',
        backgroundColor: 'blue',
      },
      _focus: {
        background: 'red',
        backgroundColor: 'blue',
      },
      _dark: {
        backgroundColor: 'blue',
        background: 'red',
      },
      md: {
        backgroundColor: 'blue',
        background: 'red',
        _light: {
          backgroundColor: 'blue',
          background: 'red',
          _hover: {
            backgroundColor: 'blue',
            background: 'red',
          },
          _focus: {
            background: 'red',
            backgroundColor: 'blue',
          },
          _active: {
            bgColor: 'blue',
            bg: 'red',
          },
        },
      },
    })
    expect(result.className).toMatchInlineSnapshot(`
      [
        "_w1ddk4\\:bg_red",
        "_ZeI045\\:bg-c_blue",
        "_NfyePv\\:dark\\:bg_red",
        "_rRbOfZ\\:dark\\:bg-c_blue",
        "_7e46V-\\:focus\\:bg_red",
        "_9BodNj\\:focus\\:bg-c_blue",
        "_LjjoSS\\:hover\\:bg_red",
        "_HtlNuq\\:hover\\:bg-c_blue",
        "_ehaG7M\\:md\\:bg_red",
        "_CZ9EbT\\:md\\:bg-c_blue",
        "_ryu-bb\\:md\\:light\\:bg_red",
        "_hOaN1s\\:md\\:light\\:bg-c_blue",
        "_I11Ywz\\:md\\:light\\:focus\\:bg_red",
        "_hRzWme\\:md\\:light\\:focus\\:bg-c_blue",
        "_ik0AdU\\:md\\:light\\:hover\\:bg_red",
        "_1ILGkh\\:md\\:light\\:hover\\:bg-c_blue",
        "_Egd0vX\\:md\\:light\\:active\\:bg_red",
        "_K3hdWH\\:md\\:light\\:active\\:bg-c_blue",
      ]
    `)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000, s010-c0-p3000, s010-c4-p1000, s010-c4-p3000, s020-c1-p1000, s020-c1-p3000, s020-c2-p1000, s020-c2-p3000, s020-c3-p1000, s020-c3-p3000, s020-c5-p1000, s020-c5-p3000, s030-c6-p1000, s030-c6-p3000, s030-c7-p1000, s030-c7-p3000, s030-c8-p1000, s030-c8-p3000;

        @layer s010-c0-p1000 {
          ._w1ddk4\\:bg_red {
            background: red;
      }
        }

        @layer s010-c0-p3000 {
          ._ZeI045\\:bg-c_blue {
            background-color: blue;
      }
        }

        @layer s010-c4-p1000 {
          @media (width >= 48rem) {
            ._ehaG7M\\:md\\:bg_red {
              background: red;
      }
      }
        }

        @layer s010-c4-p3000 {
          @media (width >= 48rem) {
            ._CZ9EbT\\:md\\:bg-c_blue {
              background-color: blue;
      }
      }
        }

        @layer s020-c1-p1000 {

          [data-theme=dark] ._NfyePv\\:dark\\:bg_red,.dark ._NfyePv\\:dark\\:bg_red,._NfyePv\\:dark\\:bg_red.dark,._NfyePv\\:dark\\:bg_red[data-theme=dark] {
            background: red;
      }
        }

        @layer s020-c1-p3000 {

          [data-theme=dark] ._rRbOfZ\\:dark\\:bg-c_blue,.dark ._rRbOfZ\\:dark\\:bg-c_blue,._rRbOfZ\\:dark\\:bg-c_blue.dark,._rRbOfZ\\:dark\\:bg-c_blue[data-theme=dark] {
            background-color: blue;
      }
        }

        @layer s020-c2-p1000 {
          ._7e46V-\\:focus\\:bg_red:is(:focus, [data-focus]) {
            background: red;
      }
        }

        @layer s020-c2-p3000 {
          ._9BodNj\\:focus\\:bg-c_blue:is(:focus, [data-focus]) {
            background-color: blue;
      }
        }

        @layer s020-c3-p1000 {
          ._LjjoSS\\:hover\\:bg_red:is(:hover, [data-hover]) {
            background: red;
      }
        }

        @layer s020-c3-p3000 {
          ._HtlNuq\\:hover\\:bg-c_blue:is(:hover, [data-hover]) {
            background-color: blue;
      }
        }

        @layer s020-c5-p1000 {
          @media (width >= 48rem) {
            [data-theme=light] ._ryu-bb\\:md\\:light\\:bg_red,.light ._ryu-bb\\:md\\:light\\:bg_red,._ryu-bb\\:md\\:light\\:bg_red.light,._ryu-bb\\:md\\:light\\:bg_red[data-theme=light] {
              background: red;
      }
      }
        }

        @layer s020-c5-p3000 {
          @media (width >= 48rem) {
            [data-theme=light] ._hOaN1s\\:md\\:light\\:bg-c_blue,.light ._hOaN1s\\:md\\:light\\:bg-c_blue,._hOaN1s\\:md\\:light\\:bg-c_blue.light,._hOaN1s\\:md\\:light\\:bg-c_blue[data-theme=light] {
              background-color: blue;
      }
      }
        }

        @layer s030-c6-p1000 {
          @media (width >= 48rem) {
            [data-theme=light] ._I11Ywz\\:md\\:light\\:focus\\:bg_red:is(:focus, [data-focus]),.light ._I11Ywz\\:md\\:light\\:focus\\:bg_red:is(:focus, [data-focus]),._I11Ywz\\:md\\:light\\:focus\\:bg_red.light:is(:focus, [data-focus]),._I11Ywz\\:md\\:light\\:focus\\:bg_red[data-theme=light]:is(:focus, [data-focus]) {
              background: red;
      }
      }
        }

        @layer s030-c6-p3000 {
          @media (width >= 48rem) {
            [data-theme=light] ._hRzWme\\:md\\:light\\:focus\\:bg-c_blue:is(:focus, [data-focus]),.light ._hRzWme\\:md\\:light\\:focus\\:bg-c_blue:is(:focus, [data-focus]),._hRzWme\\:md\\:light\\:focus\\:bg-c_blue.light:is(:focus, [data-focus]),._hRzWme\\:md\\:light\\:focus\\:bg-c_blue[data-theme=light]:is(:focus, [data-focus]) {
              background-color: blue;
      }
      }
        }

        @layer s030-c7-p1000 {
          @media (width >= 48rem) {
            [data-theme=light] ._ik0AdU\\:md\\:light\\:hover\\:bg_red:is(:hover, [data-hover]),.light ._ik0AdU\\:md\\:light\\:hover\\:bg_red:is(:hover, [data-hover]),._ik0AdU\\:md\\:light\\:hover\\:bg_red.light:is(:hover, [data-hover]),._ik0AdU\\:md\\:light\\:hover\\:bg_red[data-theme=light]:is(:hover, [data-hover]) {
              background: red;
      }
      }
        }

        @layer s030-c7-p3000 {
          @media (width >= 48rem) {
            [data-theme=light] ._1ILGkh\\:md\\:light\\:hover\\:bg-c_blue:is(:hover, [data-hover]),.light ._1ILGkh\\:md\\:light\\:hover\\:bg-c_blue:is(:hover, [data-hover]),._1ILGkh\\:md\\:light\\:hover\\:bg-c_blue.light:is(:hover, [data-hover]),._1ILGkh\\:md\\:light\\:hover\\:bg-c_blue[data-theme=light]:is(:hover, [data-hover]) {
              background-color: blue;
      }
      }
        }

        @layer s030-c8-p1000 {
          @media (width >= 48rem) {
            [data-theme=light] ._Egd0vX\\:md\\:light\\:active\\:bg_red:is(:active, [data-active]),.light ._Egd0vX\\:md\\:light\\:active\\:bg_red:is(:active, [data-active]),._Egd0vX\\:md\\:light\\:active\\:bg_red.light:is(:active, [data-active]),._Egd0vX\\:md\\:light\\:active\\:bg_red[data-theme=light]:is(:active, [data-active]) {
              background: red;
      }
      }
        }

        @layer s030-c8-p3000 {
          @media (width >= 48rem) {
            [data-theme=light] ._K3hdWH\\:md\\:light\\:active\\:bg-c_blue:is(:active, [data-active]),.light ._K3hdWH\\:md\\:light\\:active\\:bg-c_blue:is(:active, [data-active]),._K3hdWH\\:md\\:light\\:active\\:bg-c_blue.light:is(:active, [data-active]),._K3hdWH\\:md\\:light\\:active\\:bg-c_blue[data-theme=light]:is(:active, [data-active]) {
              background-color: blue;
      }
      }
        }
      }"
    `)
  })

  test('pseudo conditions sorting', () => {
    const result = css(
      {
        _focus: {
          width: '2px',
        },
        _custom: {
          width: '3px',
        },
        _active: {
          width: '3px',
        },
        _hover: {
          width: '1px',
        },
      },
      {
        conditions: {
          custom: '&[data-attr="custom"]',
        },
      },
    )

    expect(result.className).toMatchInlineSnapshot(
      `
      [
        "_7QBfyy\\:custom\\:w_3px",
        "_k8Ryfm\\:focus\\:w_2px",
        "_dpwS-p\\:hover\\:w_1px",
        "_2vPfAL\\:active\\:w_3px",
      ]
    `,
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p4000, s020-c1-p4000, s020-c2-p4000, s020-c3-p4000;

        @layer s020-c0-p4000 {
          ._7QBfyy\\:custom\\:w_3px[data-attr="custom"] {
            width: 3px;
      }
        }

        @layer s020-c1-p4000 {
          ._k8Ryfm\\:focus\\:w_2px:is(:focus, [data-focus]) {
            width: 2px;
      }
        }

        @layer s020-c2-p4000 {
          ._dpwS-p\\:hover\\:w_1px:is(:hover, [data-hover]) {
            width: 1px;
      }
        }

        @layer s020-c3-p4000 {
          ._2vPfAL\\:active\\:w_3px:is(:active, [data-active]) {
            width: 3px;
      }
        }
      }"
    `)
  })

  test('at-rules pseudo conditions sorting', () => {
    const result = css(
      {
        sm: {
          _focus: {
            width: '22px',
          },
          _custom: {
            width: '33px',
          },
          _active: {
            width: '44px',
          },
          _hover: {
            width: '11px',
          },
        },
      },
      {
        conditions: {
          custom: '&[data-attr="custom"]',
        },
      },
    )

    expect(result.className).toMatchInlineSnapshot(
      `
      [
        "_OBbnkj\\:sm\\:custom\\:w_33px",
        "_378jBy\\:sm\\:focus\\:w_22px",
        "_Cwx8uo\\:sm\\:hover\\:w_11px",
        "_lphLFD\\:sm\\:active\\:w_44px",
      ]
    `,
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p4000, s020-c1-p4000, s020-c2-p4000, s020-c3-p4000;

        @layer s020-c0-p4000 {
          @media (width >= 40rem) {
            ._OBbnkj\\:sm\\:custom\\:w_33px[data-attr="custom"] {
              width: 33px;
      }
      }
        }

        @layer s020-c1-p4000 {
          @media (width >= 40rem) {
            ._378jBy\\:sm\\:focus\\:w_22px:is(:focus, [data-focus]) {
              width: 22px;
      }
      }
        }

        @layer s020-c2-p4000 {
          @media (width >= 40rem) {
            ._Cwx8uo\\:sm\\:hover\\:w_11px:is(:hover, [data-hover]) {
              width: 11px;
      }
      }
        }

        @layer s020-c3-p4000 {
          @media (width >= 40rem) {
            ._lphLFD\\:sm\\:active\\:w_44px:is(:active, [data-active]) {
              width: 44px;
      }
      }
        }
      }"
    `)
  })

  test('nested conditions sorting', () => {
    const result = css(
      {
        md: {
          width: '3px',
        },
        _hover: {
          md: {
            width: '5px',
          },
          _focus: {
            width: '2px',
          },
          _custom: {
            color: 'blue',
          },
        },
      },
      {
        conditions: {
          custom: '&[data-attr="custom"]',
        },
      },
    )

    expect(result.className).toMatchInlineSnapshot(
      `
      [
        "_8Gs0Z9\\:hover\\:custom\\:c_blue",
        "_wVJFpB\\:hover\\:focus\\:w_2px",
        "_AQSe3b\\:md\\:w_3px",
        "_ZT-h3A\\:hover\\:md\\:w_5px",
      ]
    `,
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c2-p4000, s020-c3-p4000, s030-c0-p3000, s030-c1-p4000;

        @layer s010-c2-p4000 {
          @media (width >= 48rem) {
            ._AQSe3b\\:md\\:w_3px {
              width: 3px;
      }
      }
        }

        @layer s020-c3-p4000 {
          @media (width >= 48rem) {
            ._ZT-h3A\\:hover\\:md\\:w_5px:is(:hover, [data-hover]) {
              width: 5px;
      }
      }
        }

        @layer s030-c0-p3000 {
          ._8Gs0Z9\\:hover\\:custom\\:c_blue:is(:hover, [data-hover])[data-attr="custom"] {
            color: blue;
      }
        }

        @layer s030-c1-p4000 {
          ._wVJFpB\\:hover\\:focus\\:w_2px:is(:hover, [data-hover]):is(:focus, [data-focus]) {
            width: 2px;
      }
        }
      }"
    `)
  })

  test('nested mixed conditions sorting', () => {
    const result = css(
      {
        _hover: {
          md: {
            width: '5px',
          },
          _mixed: {
            color: 'green',
          },
          _mixedMd: {
            color: '6px',
          },
          _custom: {
            color: 'blue',
          },
        },
      },
      {
        conditions: {
          custom: '&[data-attr="custom"]',
          mixed: ['&[data-attr="custom"]'],
          mixedMd: ['@media screen and (min-width: 48em)', '&[data-attr="custom"]'],
        },
      },
    )

    expect(result.className).toMatchInlineSnapshot(
      `
      [
        "_bmi5pj\\:hover\\:mixed\\:c_green",
        "_8Gs0Z9\\:hover\\:custom\\:c_blue",
        "_ZT-h3A\\:hover\\:md\\:w_5px",
        "_qHHjtY\\:hover\\:mixedMd\\:c_6px",
      ]
    `,
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c1-p4000, s030-c0-p3000, s030-c2-p3000;

        @layer s020-c1-p4000 {
          @media (width >= 48rem) {
            ._ZT-h3A\\:hover\\:md\\:w_5px:is(:hover, [data-hover]) {
              width: 5px;
      }
      }
        }

        @layer s030-c0-p3000 {
          ._bmi5pj\\:hover\\:mixed\\:c_green:is(:hover, [data-hover])[data-attr="custom"] {
            color: green;
      }

          ._8Gs0Z9\\:hover\\:custom\\:c_blue:is(:hover, [data-hover])[data-attr="custom"] {
            color: blue;
      }
        }

        @layer s030-c2-p3000 {
          @media screen and (min-width: 48em) {
            ._qHHjtY\\:hover\\:mixedMd\\:c_6px:is(:hover, [data-hover])[data-attr="custom"] {
              color: 6px;
      }
      }
        }
      }"
    `)
  })

  test('at-rules conditions sorting', () => {
    const result = css({
      md: {
        color: '3px',
      },
      sm: {
        width: '1px',
      },
      xl: {
        width: '4px',
      },
      lg: {
        color: '2px',
      },
    })

    expect(result.className).toMatchInlineSnapshot(
      `
      [
        "_R1Rk0r\\:sm\\:w_1px",
        "_jFsXI8\\:md\\:c_3px",
        "_rJOpRH\\:lg\\:c_2px",
        "_gLb3Mu\\:xl\\:w_4px",
      ]
    `,
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p4000, s010-c1-p3000, s010-c2-p3000, s010-c3-p4000;

        @layer s010-c0-p4000 {
          @media (width >= 40rem) {
            ._R1Rk0r\\:sm\\:w_1px {
              width: 1px;
      }
      }
        }

        @layer s010-c1-p3000 {
          @media (width >= 48rem) {
            ._jFsXI8\\:md\\:c_3px {
              color: 3px;
      }
      }
        }

        @layer s010-c2-p3000 {
          @media (width >= 64rem) {
            ._rJOpRH\\:lg\\:c_2px {
              color: 2px;
      }
      }
        }

        @layer s010-c3-p4000 {
          @media (width >= 80rem) {
            ._gLb3Mu\\:xl\\:w_4px {
              width: 4px;
      }
      }
        }
      }"
    `)
  })

  test('at-rules + mixed conditions sorting', () => {
    const result = css(
      {
        md: {
          color: '3px',
        },
        _mixedSupportMd: {
          color: 'yellow',
        },
        sm: {
          width: '1px',
        },
        _mixedMd: {
          color: 'blue',
        },
        xl: {
          width: '4px',
        },
        _mixedSupportSm: {
          color: 'green',
        },
        lg: {
          color: '2px',
        },
        _mixedSm: {
          color: 'red',
        },
      },
      {
        conditions: {
          mixedSm: ['@media screen and (min-width: 40em)', '&[data-attr="custom"]'],
          mixedSupportSm: ['@media screen and (min-width: 40em)', '@support (display: flex)', '&[data-attr="custom"]'],
          mixedMd: ['@media screen and (min-width: 48em)', '&[data-attr="custom"]'],
          mixedSupportMd: ['@media screen and (min-width: 48em)', '@support (display: flex)', '&[data-attr="custom"]'],
        },
      },
    )

    expect(result.className).toMatchInlineSnapshot(
      `
      [
        "_R1Rk0r\\:sm\\:w_1px",
        "_64rnai\\:mixedSm\\:c_red",
        "_8NpePD\\:mixedSupportSm\\:c_green",
        "_jFsXI8\\:md\\:c_3px",
        "_K6wVU0\\:mixedMd\\:c_blue",
        "_g6l2If\\:mixedSupportMd\\:c_yellow",
        "_rJOpRH\\:lg\\:c_2px",
        "_gLb3Mu\\:xl\\:w_4px",
      ]
    `,
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p4000, s010-c3-p3000, s010-c6-p3000, s010-c7-p4000, s020-c1-p3000, s020-c2-p3000, s020-c4-p3000, s020-c5-p3000;

        @layer s010-c0-p4000 {
          @media (width >= 40rem) {
            ._R1Rk0r\\:sm\\:w_1px {
              width: 1px;
      }
      }
        }

        @layer s010-c3-p3000 {
          @media (width >= 48rem) {
            ._jFsXI8\\:md\\:c_3px {
              color: 3px;
      }
      }
        }

        @layer s010-c6-p3000 {
          @media (width >= 64rem) {
            ._rJOpRH\\:lg\\:c_2px {
              color: 2px;
      }
      }
        }

        @layer s010-c7-p4000 {
          @media (width >= 80rem) {
            ._gLb3Mu\\:xl\\:w_4px {
              width: 4px;
      }
      }
        }

        @layer s020-c1-p3000 {
          @media screen and (min-width: 40em) {
            ._64rnai\\:mixedSm\\:c_red[data-attr="custom"] {
              color: red;
      }
      }
        }

        @layer s020-c2-p3000 {
          @media screen and (min-width: 40em) {
            @support (display: flex) {
              ._8NpePD\\:mixedSupportSm\\:c_green[data-attr="custom"] {
                color: green;
      }
      }
      }
        }

        @layer s020-c4-p3000 {
          @media screen and (min-width: 48em) {
            ._K6wVU0\\:mixedMd\\:c_blue[data-attr="custom"] {
              color: blue;
      }
      }
        }

        @layer s020-c5-p3000 {
          @media screen and (min-width: 48em) {
            @support (display: flex) {
              ._g6l2If\\:mixedSupportMd\\:c_yellow[data-attr="custom"] {
                color: yellow;
      }
      }
      }
        }
      }"
    `)
  })

  test('mixed vs at-rule sorting', () => {
    const result = css(
      {
        width: {
          _mdHover: '6px',
          md: '4.5px',
          _hover: {
            md: '5px',
          },
        },
      },
      {
        conditions: {
          mdHover: ['@media screen and (min-width: 48em)', '@supports (display: flex)', '&:hover'],
        },
      },
    )

    expect(result.className).toMatchInlineSnapshot(
      `
      [
        "_AQSe3b\\:md\\:w_4\\.5px",
        "_ZT-h3A\\:hover\\:md\\:w_5px",
        "_NfIquT\\:mdHover\\:w_6px",
      ]
    `,
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p4000, s020-c1-p4000, s020-c2-p4000;

        @layer s010-c0-p4000 {
          @media (width >= 48rem) {
            ._AQSe3b\\:md\\:w_4\\.5px {
              width: 4.5px;
      }
      }
        }

        @layer s020-c1-p4000 {
          @media (width >= 48rem) {
            ._ZT-h3A\\:hover\\:md\\:w_5px:is(:hover, [data-hover]) {
              width: 5px;
      }
      }
        }

        @layer s020-c2-p4000 {
          @media screen and (min-width: 48em) {
            @supports (display: flex) {
              ._NfIquT\\:mdHover\\:w_6px:hover {
                width: 6px;
      }
      }
      }
        }
      }"
    `)
  })

  test('mixed conditions sorting', () => {
    const result = css(
      {
        width: {
          _supportHover: '6px',
          base: '0px',
          _mdHover: '8px',
          sm: '4px',
          md: '4.5px',
          _smHover: '7px',
          _hover: {
            base: '2px',
            md: '5px',
            _focus: '3px',
          },
          _dark: '1px',
        },
        _suppportHover: {
          _custom: {
            color: 'red',
          },
        },
        _hover: {
          _custom: {
            color: 'blue',
          },
        },
      },
      {
        conditions: {
          custom: ['&[data-attr="custom"]'],
          supportHover: ['@media (hover: hover) and (pointer: fine)', '@supports (display: table-cell)', '&:hover'],
          smHover: ['@media screen and (min-width: 40em)', '@supports (display: grid)', '&:hover'],
          mdHover: ['@media screen and (min-width: 48em)', '@supports (display: flex)', '&:hover'],
        },
      },
    )

    expect(result.className).toMatchInlineSnapshot(
      `
      [
        "_RO16FJ\\:w_0px",
        "_5RdAUu\\:custom\\:c_red",
        "_Zc7fYl\\:dark\\:w_1px",
        "_dpwS-p\\:hover\\:w_2px",
        "_8Gs0Z9\\:hover\\:custom\\:c_blue",
        "_wVJFpB\\:hover\\:focus\\:w_3px",
        "_R1Rk0r\\:sm\\:w_4px",
        "_-COiun\\:smHover\\:w_7px",
        "_AQSe3b\\:md\\:w_4\\.5px",
        "_ZT-h3A\\:hover\\:md\\:w_5px",
        "_NfIquT\\:mdHover\\:w_8px",
        "_Mlkq2r\\:supportHover\\:w_6px",
      ]
    `,
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p4000, s010-c6-p4000, s010-c8-p4000, s020-c1-p3000, s020-c2-p4000, s020-c3-p4000, s020-c7-p4000, s020-c9-p4000, s020-c10-p4000, s020-c11-p4000, s030-c4-p3000, s030-c5-p4000;

        @layer s010-c0-p4000 {
          ._RO16FJ\\:w_0px {
            width: 0px;
      }
        }

        @layer s010-c6-p4000 {
          @media (width >= 40rem) {
            ._R1Rk0r\\:sm\\:w_4px {
              width: 4px;
      }
      }
        }

        @layer s010-c8-p4000 {
          @media (width >= 48rem) {
            ._AQSe3b\\:md\\:w_4\\.5px {
              width: 4.5px;
      }
      }
        }

        @layer s020-c1-p3000 {
          ._5RdAUu\\:custom\\:c_red[data-attr="custom"] {
            color: red;
      }
        }

        @layer s020-c2-p4000 {

          [data-theme=dark] ._Zc7fYl\\:dark\\:w_1px,.dark ._Zc7fYl\\:dark\\:w_1px,._Zc7fYl\\:dark\\:w_1px.dark,._Zc7fYl\\:dark\\:w_1px[data-theme=dark] {
            width: 1px;
      }
        }

        @layer s020-c3-p4000 {
          ._dpwS-p\\:hover\\:w_2px:is(:hover, [data-hover]) {
            width: 2px;
      }
        }

        @layer s020-c7-p4000 {
          @media screen and (min-width: 40em) {
            @supports (display: grid) {
              ._-COiun\\:smHover\\:w_7px:hover {
                width: 7px;
      }
      }
      }
        }

        @layer s020-c9-p4000 {
          @media (width >= 48rem) {
            ._ZT-h3A\\:hover\\:md\\:w_5px:is(:hover, [data-hover]) {
              width: 5px;
      }
      }
        }

        @layer s020-c10-p4000 {
          @media screen and (min-width: 48em) {
            @supports (display: flex) {
              ._NfIquT\\:mdHover\\:w_8px:hover {
                width: 8px;
      }
      }
      }
        }

        @layer s020-c11-p4000 {
          @media (hover: hover) and (pointer: fine) {
            @supports (display: table-cell) {
              ._Mlkq2r\\:supportHover\\:w_6px:hover {
                width: 6px;
      }
      }
      }
        }

        @layer s030-c4-p3000 {
          ._8Gs0Z9\\:hover\\:custom\\:c_blue:is(:hover, [data-hover])[data-attr="custom"] {
            color: blue;
      }
        }

        @layer s030-c5-p4000 {
          ._wVJFpB\\:hover\\:focus\\:w_3px:is(:hover, [data-hover]):is(:focus, [data-focus]) {
            width: 3px;
      }
        }
      }"
    `)
  })

  test('issue 3462 - mixed condition (array format) with child selector', () => {
    const result = css(
      {
        _hover: {
          '& > :where(svg)': { color: 'green' },
        },
      },
      {
        conditions: {
          hover: ['&:hover'],
        },
      },
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p3000;

        @layer s020-c0-p3000 {
          ._ZgWWOD\\:hover\\:\\[\\&_\\>_\\:where\\(svg\\)\\]\\:c_green:hover > :where(svg) {
            color: green;
      }
        }
      }"
    `)
  })

  test('issue 3462 - mixed condition with at-rule should still sort correctly', () => {
    const result = css(
      {
        _hoverMedia: {
          '& > :where(svg)': {
            color: 'blue',
          },
        },
      },
      {
        conditions: {
          hoverMedia: ['@media (hover: hover)', '&:hover'],
        },
      },
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p3000;

        @layer s020-c0-p3000 {
          @media (hover: hover) {
            ._1a0-nT\\:hoverMedia\\:\\[\\&_\\>_\\:where\\(svg\\)\\]\\:c_blue:hover > :where(svg) {
              color: blue;
      }
      }
        }
      }"
    `)
  })
})

describe('multi-block conditions (object syntax with @slot)', () => {
  test('basic multi-block condition with two at-rule blocks', () => {
    const result = css(
      {
        _hoverActive: {
          background: 'red',
        },
      },
      {
        conditions: {
          hoverActive: {
            '@media (hover: hover)': {
              '&:is(:hover, [data-hover])': '@slot',
            },
            '@media (hover: none)': {
              '&:is(:active, [data-active])': '@slot',
            },
          },
        },
      },
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p1000;

        @layer s020-c0-p1000 {
          @media (hover: hover) {
            ._ugV3UM\\:hoverActive\\:bg_red:is(:hover, [data-hover]) {
              background: red;
      }
      }

          @media (hover: none) {
            ._ugV3UM\\:hoverActive\\:bg_red:is(:active, [data-active]) {
              background: red;
      }
      }
        }
      }"
    `)
  })

  test('single-block object condition (backward compat)', () => {
    const result = css(
      {
        _anyHover: {
          color: 'blue',
        },
      },
      {
        conditions: {
          anyHover: {
            '@media (hover: hover)': {
              '&:hover': '@slot',
            },
          },
        },
      },
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p3000;

        @layer s020-c0-p3000 {
          @media (hover: hover) {
            ._vtUPSo\\:anyHover\\:c_blue:hover {
              color: blue;
      }
      }
        }
      }"
    `)
  })

  test('multi-block condition with multiple properties', () => {
    const result = css(
      {
        _hoverActive: {
          background: 'red',
          color: 'white',
        },
      },
      {
        conditions: {
          hoverActive: {
            '@media (hover: hover)': {
              '&:is(:hover, [data-hover])': '@slot',
            },
            '@media (hover: none)': {
              '&:is(:active, [data-active])': '@slot',
            },
          },
        },
      },
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p1000, s020-c0-p3000;

        @layer s020-c0-p1000 {
          @media (hover: hover) {
            ._ugV3UM\\:hoverActive\\:bg_red:is(:hover, [data-hover]) {
              background: red;
      }
      }

          @media (hover: none) {
            ._ugV3UM\\:hoverActive\\:bg_red:is(:active, [data-active]) {
              background: red;
      }
      }
        }

        @layer s020-c0-p3000 {
          @media (hover: hover) {
            ._az8_NL\\:hoverActive\\:c_white:is(:hover, [data-hover]) {
              color: var(--colors-white);
      }
      }

          @media (hover: none) {
            ._az8_NL\\:hoverActive\\:c_white:is(:active, [data-active]) {
              color: var(--colors-white);
      }
      }
        }
      }"
    `)
  })

  test('single-@slot object is equivalent to mixed-array form', () => {
    const objectForm = css(
      { _anyHover: { color: 'blue' } },
      {
        conditions: {
          anyHover: { '@media (hover: hover)': { '&:hover': '@slot' } },
        },
      },
    )
    const arrayForm = css(
      { _anyHover: { color: 'blue' } },
      {
        conditions: {
          anyHover: ['@media (hover: hover)', '&:hover'],
        },
      },
    )

    expect(objectForm.css).toBe(arrayForm.css)
    expect(objectForm.className).toEqual(arrayForm.className)
  })

  test('multi-block stacked with a parent-nesting condition combines correctly', () => {
    const result = css(
      {
        _dark: {
          _hoverActive: { background: 'red' },
        },
      },
      {
        conditions: {
          dark: '.dark &',
          hoverActive: {
            '@media (hover: hover)': { '&:is(:hover, [data-hover])': '@slot' },
            '@media (hover: none)': { '&:is(:active, [data-active])': '@slot' },
          },
        },
      },
    )

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s030-c0-p1000;

        @layer s030-c0-p1000 {
          @media (hover: hover) {
            .dark ._UIk9Oq\\:dark\\:hoverActive\\:bg_red:is(:hover, [data-hover]) {
              background: red;
      }
      }

          @media (hover: none) {
            .dark ._UIk9Oq\\:dark\\:hoverActive\\:bg_red:is(:active, [data-active]) {
              background: red;
      }
      }
        }
      }"
    `)
  })

  test('multi-block emission preserves a deterministic at-rule order', () => {
    const result = css(
      {
        _hoverActive: { background: 'red' },
      },
      {
        conditions: {
          hoverActive: {
            '@media (hover: hover)': { '&:is(:hover, [data-hover])': '@slot' },
            '@media (hover: none)': { '&:is(:active, [data-active])': '@slot' },
          },
        },
      },
    )

    // Inline snapshot pins the full block layout, so a future at-rule sort
    // change that flipped `(hover: hover)` and `(hover: none)` would diff loudly.
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p1000;

        @layer s020-c0-p1000 {
          @media (hover: hover) {
            ._ugV3UM\\:hoverActive\\:bg_red:is(:hover, [data-hover]) {
              background: red;
      }
      }

          @media (hover: none) {
            ._ugV3UM\\:hoverActive\\:bg_red:is(:active, [data-active]) {
              background: red;
      }
      }
        }
      }"
    `)
  })

  test('stacking two multi-block conditions produces cartesian product of blocks', () => {
    const result = css(
      {
        _hoverActive: {
          _lightDark: {
            background: 'red',
          },
        },
      },
      {
        conditions: {
          hoverActive: {
            '@media (hover: hover)': { '&:is(:hover, [data-hover])': '@slot' },
            '@media (hover: none)': { '&:is(:active, [data-active])': '@slot' },
          },
          lightDark: {
            '@media (prefers-color-scheme: light)': { '&[data-mode="light"]': '@slot' },
            '@media (prefers-color-scheme: dark)': { '&[data-mode="dark"]': '@slot' },
          },
        },
      },
    )

    // 2 (hoverActive) × 2 (lightDark) = 4 selector combinations expected.
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s030-c0-p1000;

        @layer s030-c0-p1000 {
          @media (hover: hover) {
            @media (prefers-color-scheme: light) {
              ._uIVX3F\\:hoverActive\\:lightDark\\:bg_red:is(:hover, [data-hover])[data-mode="light"] {
                background: red;
      }
      }
      }

          @media (hover: hover) {
            @media (prefers-color-scheme: dark) {
              ._uIVX3F\\:hoverActive\\:lightDark\\:bg_red:is(:hover, [data-hover])[data-mode="dark"] {
                background: red;
      }
      }
      }

          @media (hover: none) {
            @media (prefers-color-scheme: light) {
              ._uIVX3F\\:hoverActive\\:lightDark\\:bg_red:is(:active, [data-active])[data-mode="light"] {
                background: red;
      }
      }
      }

          @media (hover: none) {
            @media (prefers-color-scheme: dark) {
              ._uIVX3F\\:hoverActive\\:lightDark\\:bg_red:is(:active, [data-active])[data-mode="dark"] {
                background: red;
      }
      }
      }
        }
      }"
    `)
  })
})
