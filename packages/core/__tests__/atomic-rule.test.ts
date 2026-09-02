import { describe, expect, test } from 'vitest'
import { createRuleProcessor } from './fixture'
import type { Config, SystemStyleObject } from '@bamboocss/types'

const css = (styles: SystemStyleObject, config?: Config) => {
  return createRuleProcessor(config).css(styles).toCss()
}

describe('atomic / with basic style object', () => {
  test('respect important syntax', () => {
    expect(
      css({
        color: 'red !important',
        fontSize: '30px!',
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer important;

        @layer important {
          .c_red\\! {
            color: red !important;
      }

          .fs_30px\\! {
            font-size: 30px !important;
      }
        }
      }"
    `)
  })

  test('should work with basic', () => {
    expect(css({ bg: 'red.300' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_red\\.300 {
            background: var(--colors-red-300);
      }
        }
      }"
    `)
  })

  test('should resolve shorthand', () => {
    expect(css({ width: '50px', w: '20px' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p4000;

        @layer s010-c0-p4000 {
          .w_20px {
            width: 20px;
      }
        }
      }"
    `)

    expect(css({ width: { base: '50px', md: '60px' }, w: '70px' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p4000;

        @layer s010-c0-p4000 {
          .w_70px {
            width: 70px;
      }
        }
      }"
    `)
  })

  test('should work with negative tokens', () => {
    expect(css({ mx: -2 })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000;

        @layer s010-c0-p2000 {
          .mx_-2 {
            margin-inline: calc(var(--spacing-2) * -1);
      }
        }
      }"
    `)
  })

  test('should reject an array, naming the property', () => {
    // It used to mean one value per breakpoint, which made a font stack written the way CSS
    // writes one into `Inter` at base and `sans-serif` at `sm`, silently.
    expect(() => css({ width: ['50px', '60px'] as any })).toThrowError('An array is not a style value: "width".')
  })

  test('should work with inner responsive', () => {
    expect(
      css({
        ml: { _ltr: { sm: '4' }, _rtl: '-4' },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p4000, s010-c1-p4000;

        @layer s010-c0-p4000 {
          :where([dir=rtl], :dir(rtl)) .rtl\\:ml_-4 {
            margin-left: calc(var(--spacing-4) * -1);
      }
        }

        @layer s010-c1-p4000 {
          @media (width >= 40rem) {
            :where([dir=ltr], :dir(ltr)) .ltr\\:sm\\:ml_4 {
              margin-left: var(--spacing-4);
      }
      }
        }
      }"
    `)
  })

  test('respect color mode', () => {
    expect(
      css({
        color: { _light: 'red', _dark: 'green' },
        opacity: { _dark: 'slate400' },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p3000, s020-c1-p3000;

        @layer s020-c0-p3000 {

          [data-theme=light] .light\\:c_red,.light .light\\:c_red,.light\\:c_red.light,.light\\:c_red[data-theme=light] {
            color: red;
      }
        }

        @layer s020-c1-p3000 {

          [data-theme=dark] .dark\\:c_green,.dark .dark\\:c_green,.dark\\:c_green.dark,.dark\\:c_green[data-theme=dark] {
            color: green;
      }

          [data-theme=dark] .dark\\:op_slate400,.dark .dark\\:op_slate400,.dark\\:op_slate400.dark,.dark\\:op_slate400[data-theme=dark] {
            opacity: slate400;
      }
        }
      }"
    `)
  })

  test('should work with outer responsive', () => {
    expect(
      css({
        top: { sm: { _rtl: '20px', _hover: '50px' }, lg: '120px' },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p4000, s010-c2-p4000, s020-c1-p4000;

        @layer s010-c0-p4000 {
          @media (width >= 40rem) {
            :where([dir=rtl], :dir(rtl)) .sm\\:rtl\\:top_20px {
              top: 20px;
      }
      }
        }

        @layer s010-c2-p4000 {
          @media (width >= 64rem) {
            .lg\\:top_120px {
              top: 120px;
      }
      }
        }

        @layer s020-c1-p4000 {
          @media (width >= 40rem) {
            .sm\\:hover\\:top_50px:is(:hover, [data-hover]) {
              top: 50px;
      }
      }
        }
      }"
    `)
  })

  test('should skip `_` notation', () => {
    expect(
      css({
        left: { base: '20px', md: '40px' },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p4000, s010-c1-p4000;

        @layer s010-c0-p4000 {
          .left_20px {
            left: 20px;
      }
        }

        @layer s010-c1-p4000 {
          @media (width >= 48rem) {
            .md\\:left_40px {
              left: 40px;
      }
      }
        }
      }"
    `)
  })
})

describe('atomic / with nesting scope', () => {
  test('[pseudo] should work with nested selector', () => {
    expect(
      css({
        '& > p': {
          left: { base: '20px', md: '40px' },
          bg: { _light: 'red400', _dark: 'green500' },
          font: { _rtl: 'sans', _ltr: { _dark: { sm: { _hover: 'serif' } } } },
        },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s011-c0-p4000, s011-c1-p1000, s011-c5-p4000, s021-c2-p1000, s021-c3-p1000, s031-c4-p1000;

        @layer s011-c0-p4000 {
          .\\[\\&_\\>_p\\]\\:left_20px > p {
            left: 20px;
      }
        }

        @layer s011-c1-p1000 {
          :where([dir=rtl], :dir(rtl)) .\\[\\&_\\>_p\\]\\:rtl\\:font_sans > p {
            font: sans;
      }
        }

        @layer s011-c5-p4000 {
          @media (width >= 48rem) {
            .\\[\\&_\\>_p\\]\\:md\\:left_40px > p {
              left: 40px;
      }
      }
        }

        @layer s021-c2-p1000 {

          [data-theme=light] .\\[\\&_\\>_p\\]\\:light\\:bg_red400 > p,.light .\\[\\&_\\>_p\\]\\:light\\:bg_red400 > p,.\\[\\&_\\>_p\\]\\:light\\:bg_red400 > p.light,.\\[\\&_\\>_p\\]\\:light\\:bg_red400 > p[data-theme=light] {
            background: red400;
      }
        }

        @layer s021-c3-p1000 {

          [data-theme=dark] .\\[\\&_\\>_p\\]\\:dark\\:bg_green500 > p,.dark .\\[\\&_\\>_p\\]\\:dark\\:bg_green500 > p,.\\[\\&_\\>_p\\]\\:dark\\:bg_green500 > p.dark,.\\[\\&_\\>_p\\]\\:dark\\:bg_green500 > p[data-theme=dark] {
            background: green500;
      }
        }

        @layer s031-c4-p1000 {
          @media (width >= 40rem) {
            [data-theme=dark] :where([dir=ltr], :dir(ltr)) .\\[\\&_\\>_p\\]\\:ltr\\:dark\\:sm\\:hover\\:font_serif > p:is(:hover, [data-hover]),.dark :where([dir=ltr], :dir(ltr)) .\\[\\&_\\>_p\\]\\:ltr\\:dark\\:sm\\:hover\\:font_serif > p:is(:hover, [data-hover]),:where([dir=ltr], :dir(ltr)) .\\[\\&_\\>_p\\]\\:ltr\\:dark\\:sm\\:hover\\:font_serif > p.dark:is(:hover, [data-hover]),:where([dir=ltr], :dir(ltr)) .\\[\\&_\\>_p\\]\\:ltr\\:dark\\:sm\\:hover\\:font_serif > p[data-theme=dark]:is(:hover, [data-hover]) {
              font: serif;
      }
      }
        }
      }"
    `)
  })

  test('[parent selector] should work with nested selector', () => {
    expect(
      css({
        'input:hover &': {
          bg: 'red400',
          fontSize: { sm: '14px', lg: '18px' },
        },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s021-c0-p1000, s021-c1-p3000, s021-c2-p3000;

        @layer s021-c0-p1000 {
          input:hover .\\[input\\:hover_\\&\\]\\:bg_red400 {
            background: red400;
      }
        }

        @layer s021-c1-p3000 {
          @media (width >= 40rem) {
            input:hover .\\[input\\:hover_\\&\\]\\:sm\\:fs_14px {
              font-size: 14px;
      }
      }
        }

        @layer s021-c2-p3000 {
          @media (width >= 64rem) {
            input:hover .\\[input\\:hover_\\&\\]\\:lg\\:fs_18px {
              font-size: 18px;
      }
      }
        }
      }"
    `)
  })

  test('[selector] should work with nested selector', () => {
    expect(
      css({
        '&::placeholder': {
          left: '40px',
          bg: 'red400',
          textAlign: { sm: 'left' },
        },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s011-c0-p1000, s011-c0-p4000, s011-c1-p3000;

        @layer s011-c0-p1000 {
          .\\[\\&\\:\\:placeholder\\]\\:bg_red400::placeholder {
            background: red400;
      }
        }

        @layer s011-c0-p4000 {
          .\\[\\&\\:\\:placeholder\\]\\:left_40px::placeholder {
            left: 40px;
      }
        }

        @layer s011-c1-p3000 {
          @media (width >= 40rem) {
            .\\[\\&\\:\\:placeholder\\]\\:sm\\:ta_left::placeholder {
              text-align: left;
      }
      }
        }
      }"
    `)
  })

  test('[@media] should work with nested selector', () => {
    expect(
      css({
        '@media base': {
          left: '40px',
          textAlign: { sm: 'left' },
        },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p4000, s010-c1-p3000;

        @layer s010-c0-p4000 {
          @media base {
            .\\[\\@media_base\\]\\:left_40px {
              left: 40px;
      }
      }
        }

        @layer s010-c1-p3000 {
          @media base {
            @media (width >= 40rem) {
              .\\[\\@media_base\\]\\:sm\\:ta_left {
                text-align: left;
      }
      }
      }
        }
      }"
    `)
  })
})

describe('atomic / with grouped conditions styles', () => {
  test('simple', () => {
    expect(
      css({
        _hover: { bg: 'pink.400' },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p1000;

        @layer s020-c0-p1000 {
          .hover\\:bg_pink\\.400:is(:hover, [data-hover]) {
            background: var(--colors-pink-400);
      }
        }
      }"
    `)
  })

  test('nested > property', () => {
    expect(
      css({
        _hover: { bg: { sm: { _dark: 'red.300' } }, color: 'pink.400' },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p3000, s030-c1-p1000;

        @layer s020-c0-p3000 {
          .hover\\:c_pink\\.400:is(:hover, [data-hover]) {
            color: var(--colors-pink-400);
      }
        }

        @layer s030-c1-p1000 {
          @media (width >= 40rem) {
            [data-theme=dark] .hover\\:sm\\:dark\\:bg_red\\.300:is(:hover, [data-hover]),.dark .hover\\:sm\\:dark\\:bg_red\\.300:is(:hover, [data-hover]),.hover\\:sm\\:dark\\:bg_red\\.300:is(:hover, [data-hover]).dark,.hover\\:sm\\:dark\\:bg_red\\.300:is(:hover, [data-hover])[data-theme=dark] {
              background: var(--colors-red-300);
      }
      }
        }
      }"
    `)
  })

  test('nested > nested > property', () => {
    expect(
      css({
        _hover: { _disabled: { bg: { sm: 'red.300' } } },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s030-c0-p1000;

        @layer s030-c0-p1000 {
          @media (width >= 40rem) {
            .hover\\:disabled\\:sm\\:bg_red\\.300:is(:hover, [data-hover]):is(:disabled, [disabled], [data-disabled], [aria-disabled=true]) {
              background: var(--colors-red-300);
      }
      }
        }
      }"
    `)
  })

  test('multiple scopes', () => {
    expect(
      css({
        '@media base': {
          '&:hover': {
            left: '40px',
            textAlign: { sm: 'left' },
          },
        },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s020-c0-p4000, s020-c1-p3000;

        @layer s020-c0-p4000 {
          @media base {
            .\\[\\@media_base\\]\\:\\[\\&\\:hover\\]\\:left_40px:hover {
              left: 40px;
      }
      }
        }

        @layer s020-c1-p3000 {
          @media base {
            @media (width >= 40rem) {
              .\\[\\@media_base\\]\\:\\[\\&\\:hover\\]\\:sm\\:ta_left:hover {
                text-align: left;
      }
      }
      }
        }
      }"
    `)
  })
})

describe('atomic / with direct nesting', () => {
  test('should work for inline media', () => {
    expect(
      css({
        '@media (min-width: 768px)': {
          backgroundColor: 'green',
        },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          @media (min-width: 768px) {
            .\\[\\@media_\\(min-width\\:_768px\\)\\]\\:bg-c_green {
              background-color: green;
      }
      }
        }
      }"
    `)
  })

  test('outlier: should work with basic', () => {
    expect(
      css({
        all: 'unset',
        backgroundColor: 'red',
        border: 'none',
        padding: '$3 $3',
        borderRadius: '$button',
        fontSize: '$xsmall',
        cursor: 'pointer',
        '& + span': {
          marginLeft: '$2',
        },
        '&:focus, &:hover': {
          boxShadow: 'none',
        },
        '.test &': {
          backgroundColor: 'blue',
        },
        '& .my-class': {
          color: 'red',
        },
        ':focus > &': {
          color: 'white',
        },
        '@media (min-width: 768px)': {
          backgroundColor: 'green',
          fontSize: '$small',
          '&:hover': {
            backgroundColor: 'yellow',
          },
        },
        '& span': {
          color: 'red',
        },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p0, s010-c0-p1000, s010-c0-p2000, s010-c0-p3000, s010-c7-p3000, s011-c1-p3000, s011-c2-p4000, s020-c3-p3000, s020-c4-p3000, s020-c5-p3000, s020-c6-p3000, s020-c8-p3000;

        @layer s010-c0-p0 {
          .all_unset {
            all: unset;
      }
        }

        @layer s010-c0-p1000 {
          .bd_none {
            border: var(--borders-none);
      }

          .p_\\$3_\\$3 {
            padding: $3 $3;
      }
        }

        @layer s010-c0-p2000 {
          .bdr_\\$button {
            border-radius: $button;
      }
        }

        @layer s010-c0-p3000 {
          .bg-c_red {
            background-color: red;
      }

          .fs_\\$xsmall {
            font-size: $xsmall;
      }

          .cursor_pointer {
            cursor: pointer;
      }
        }

        @layer s010-c7-p3000 {
          @media (min-width: 768px) {
            .\\[\\@media_\\(min-width\\:_768px\\)\\]\\:bg-c_green {
              background-color: green;
      }
            .\\[\\@media_\\(min-width\\:_768px\\)\\]\\:fs_\\$small {
              font-size: $small;
      }
      }
        }

        @layer s011-c1-p3000 {
          .\\[\\&_span\\]\\:c_red span {
            color: red;
      }
        }

        @layer s011-c2-p4000 {
          .\\[\\&_\\+_span\\]\\:ml_\\$2 + span {
            margin-left: $2;
      }
        }

        @layer s020-c3-p3000 {
          .test .\\[\\.test_\\&\\]\\:bg-c_blue {
            background-color: blue;
      }
        }

        @layer s020-c4-p3000 {
          .\\[\\&_\\.my-class\\]\\:c_red .my-class {
            color: red;
      }
        }

        @layer s020-c5-p3000 {

          .\\[\\&\\:focus\\,_\\&\\:hover\\]\\:bx-sh_none:focus,.\\[\\&\\:focus\\,_\\&\\:hover\\]\\:bx-sh_none:hover {
            box-shadow: none;
      }
        }

        @layer s020-c6-p3000 {
          :focus > .\\[\\:focus_\\>_\\&\\]\\:c_white {
            color: var(--colors-white);
      }
        }

        @layer s020-c8-p3000 {
          @media (min-width: 768px) {
            .\\[\\@media_\\(min-width\\:_768px\\)\\]\\:\\[\\&\\:hover\\]\\:bg-c_yellow:hover {
              background-color: yellow;
      }
      }
        }
      }"
    `)
  })

  test('simple nesting', () => {
    expect(
      css({
        '& kbd': {
          color: 'red',
        },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s011-c0-p3000;

        @layer s011-c0-p3000 {
          .\\[\\&_kbd\\]\\:c_red kbd {
            color: red;
      }
        }
      }"
    `)
  })

  test('should sort mobile first', () => {
    expect(
      css({
        '@media screen and (max-width: 640px)': {
          margin: '8',
        },
        '@media screen and (min-width: 980px)': {
          margin: '3',
        },
        '@media screen and (max-width: 980px)': {
          margin: '6',
        },
        '@supports (display: grid)': {
          backgroundColor: 'red',
        },
        '@media screen and (max-width: 768px)': {
          margin: '7',
        },
        '@media screen and (min-width: 640px)': {
          margin: '1',
        },
        '@supports not (display: grid)': {
          backgroundColor: 'green',
        },
        '@media screen and (min-width: 1280px)': {
          margin: '4',
        },
        '@supports (display: flex)': {
          backgroundColor: 'blue',
        },
        '@media screen and (min-width: 768px)': {
          margin: '2',
        },
        '@media screen and (max-width: 1280px)': {
          margin: '5',
        },
      }),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000, s010-c1-p1000, s010-c2-p1000, s010-c3-p1000, s010-c4-p1000, s010-c5-p1000, s010-c6-p1000, s010-c7-p1000, s010-c8-p3000, s010-c9-p3000, s010-c10-p3000;

        @layer s010-c0-p1000 {
          @media screen and (min-width: 640px) {
            .\\[\\@media_screen_and_\\(min-width\\:_640px\\)\\]\\:m_1 {
              margin: var(--spacing-1);
      }
      }
        }

        @layer s010-c1-p1000 {
          @media screen and (min-width: 768px) {
            .\\[\\@media_screen_and_\\(min-width\\:_768px\\)\\]\\:m_2 {
              margin: var(--spacing-2);
      }
      }
        }

        @layer s010-c2-p1000 {
          @media screen and (min-width: 980px) {
            .\\[\\@media_screen_and_\\(min-width\\:_980px\\)\\]\\:m_3 {
              margin: var(--spacing-3);
      }
      }
        }

        @layer s010-c3-p1000 {
          @media screen and (min-width: 1280px) {
            .\\[\\@media_screen_and_\\(min-width\\:_1280px\\)\\]\\:m_4 {
              margin: var(--spacing-4);
      }
      }
        }

        @layer s010-c4-p1000 {
          @media screen and (max-width: 1280px) {
            .\\[\\@media_screen_and_\\(max-width\\:_1280px\\)\\]\\:m_5 {
              margin: var(--spacing-5);
      }
      }
        }

        @layer s010-c5-p1000 {
          @media screen and (max-width: 980px) {
            .\\[\\@media_screen_and_\\(max-width\\:_980px\\)\\]\\:m_6 {
              margin: var(--spacing-6);
      }
      }
        }

        @layer s010-c6-p1000 {
          @media screen and (max-width: 768px) {
            .\\[\\@media_screen_and_\\(max-width\\:_768px\\)\\]\\:m_7 {
              margin: var(--spacing-7);
      }
      }
        }

        @layer s010-c7-p1000 {
          @media screen and (max-width: 640px) {
            .\\[\\@media_screen_and_\\(max-width\\:_640px\\)\\]\\:m_8 {
              margin: var(--spacing-8);
      }
      }
        }

        @layer s010-c8-p3000 {
          @supports (display: flex) {
            .\\[\\@supports_\\(display\\:_flex\\)\\]\\:bg-c_blue {
              background-color: blue;
      }
      }
        }

        @layer s010-c9-p3000 {
          @supports (display: grid) {
            .\\[\\@supports_\\(display\\:_grid\\)\\]\\:bg-c_red {
              background-color: red;
      }
      }
        }

        @layer s010-c10-p3000 {
          @supports not (display: grid) {
            .\\[\\@supports_not_\\(display\\:_grid\\)\\]\\:bg-c_green {
              background-color: green;
      }
      }
        }
      }"
    `)
  })

  test('with custom formatTokenName and formatCssVar', () => {
    expect(
      css(
        { bg: '$blue-400' },
        {
          plugins: [
            {
              name: 'test',
              hooks: {
                'tokens:created': ({ configure }) => {
                  configure({
                    formatTokenName: (path) => '$' + path.join('-'),
                    formatCssVar: (path) => {
                      const variable = path.join('---')
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
        },
      ),
    ).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000;

        @layer s010-c0-p1000 {
          .bg_\\$blue-400 {
            background: var(--colors---blue---400);
      }
        }
      }"
    `)
  })

  // These were the `hideFrom` / `hideBelow` utilities, which said nothing the breakpoint
  // conditions did not. The media queries below are the ones those utilities emitted.
  test('hiding by breakpoint', () => {
    expect(css({ sm: { display: 'none' } })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          @media (width >= 40rem) {
            .sm\\:d_none {
              display: none;
      }
      }
        }
      }"
    `)

    expect(css({ lgDown: { display: 'none' } })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          @media (width < 64rem) {
            .lgDown\\:d_none {
              display: none;
      }
      }
        }
      }"
    `)
  })
})
