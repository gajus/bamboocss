import { createGeneratorContext } from '@bamboocss/fixture'
import { createCss } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'

describe('generate classnames', () => {
  test('css variables', () => {
    const css = createCss(createGeneratorContext().baseSheetContext)

    const result = css({
      '--testVariable0': '0',
      '--test-Variable-1': '1',
      '--test-variable-2': '2',
    })

    expect(result).toMatchInlineSnapshot(
      `"_wgYpz2:--testVariable0_0 _ZoaNGs:--test-Variable-1_1 _AiKdN4:--test-variable-2_2"`,
    )
  })

  test('should convert object to class', () => {
    const css = createCss(createGeneratorContext().baseSheetContext)
    expect(
      css({
        color: { _light: 'red', _dark: 'green' },
        opacity: { _dark: 'slate400' },
      }),
    ).toMatchInlineSnapshot(`"_IcPIb3:light:c_red _gtEApe:dark:c_green _aN2f-D:dark:op_slate400"`)

    expect(
      css({
        top: { sm: { _rtl: '20px', _hover: '50px' }, lg: '120px' },
      }),
    ).toMatchInlineSnapshot(`"_fYp5xA:sm:rtl:top_20px _n3U4vc:sm:hover:top_50px _rbF1Op:lg:top_120px"`)

    expect(
      css({
        left: { base: '20px', md: '40px' },
      }),
    ).toMatchInlineSnapshot(`"_3Cthvj:left_20px _QhKjJy:md:left_40px"`)
  })

  test('should expand shorthand before processing', () => {
    const css = createCss(createGeneratorContext().baseSheetContext)
    expect(
      css({
        w: '40px',
        width: '80px',
      }),
    ).toMatchInlineSnapshot(`"_RO16FJ:w_80px"`)

    // override even responsive values
    expect(
      css({
        width: { base: '50px', md: '60px' },
        w: '70px',
      }),
    ).toMatchInlineSnapshot(`"_RO16FJ:w_70px"`)

    // override in nested condition
    expect(
      css({
        _hover: { width: '40px', w: '90px' },
      }),
    ).toMatchInlineSnapshot(`"_dpwS-p:hover:w_90px"`)
  })

  test('should respect important', () => {
    const css = createCss(createGeneratorContext().baseSheetContext)
    expect(
      css({
        color: 'red !important',
        fontSize: '30px!',
      }),
    ).toMatchInlineSnapshot(`"_Btm_AK:c_red! _Ocpc8R:fs_30px!"`)
  })

  test('should omit spaces in nested selectors', () => {
    const css = createCss(createGeneratorContext().baseSheetContext)
    expect(
      css({
        '& span': {
          fontSize: '20px',
        },
        '.bold &': {
          fontWeight: 'bold',
        },
        fontSize: { sm: '50px' },
        '@media print': {
          fontSize: '40px',
        },
      }),
    ).toMatchInlineSnapshot(
      `"_ATQPsE:[&_span]:fs_20px _6Iya86:[.bold_&]:fw_bold _EL8lrA:sm:fs_50px __-WJL5:[@media_print]:fs_40px"`,
    )
  })

  test('should use dash for negative tokens', () => {
    const css = createCss(createGeneratorContext().baseSheetContext)
    expect(css({ mx: '-2' })).toMatchInlineSnapshot(`"_0QmaUN:mx_-2"`)
  })

  test('should not format the class name', () => {
    const css = createCss(
      createGeneratorContext({
        plugins: [
          {
            name: 'test',
            hooks: {
              'tokens:created': ({ configure }) => {
                configure({
                  formatTokenName: (path) => '$' + path.join('-'),
                  formatCssVar: (path) => {
                    const variable = path.join('-').replace('$', '').replace('.', '')
                    return {
                      var: variable as any,
                      ref: `var(--${variable})`,
                    }
                  },
                })
              },
            },
          },
        ],
      }).baseSheetContext,
    )
    expect(
      css({
        background: '$pink.400',
        mx: '-$2',
      }),
    ).toMatchInlineSnapshot(`"_w1ddk4:bg_$pink.400 _0QmaUN:mx_-$2"`)
  })

  test('should format the non-string values', () => {
    const css = createCss(
      createGeneratorContext({
        plugins: [
          {
            name: 'test',
            hooks: {
              'tokens:created': ({ configure }) => {
                configure({
                  formatTokenName: (path) => '$' + path.join('-'),
                  formatCssVar: (path) => {
                    const variable = path.join('-').replace('$', '').replace('.', '')
                    return {
                      var: variable as any,
                      ref: `var(--${variable})`,
                    }
                  },
                })
              },
            },
          },
        ],
      }).baseSheetContext,
    )
    expect(
      css({
        debug: true,
        padding: 40,
      }),
    ).toMatchInlineSnapshot(`"_apQiK1:debug_true _DJEIKl:p_40"`)
  })
})
