import { createGeneratorContext } from '@bamboocss/fixture'
import type { Dict } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'

function globalCss(values: Dict) {
  const ctx = createGeneratorContext()
  const sheet = ctx.createSheet()
  sheet.processGlobalCss(values)
  return sheet.toCss()
}

describe('Global css', () => {
  test('with direct nesting + conditional value', () => {
    const sheet = globalCss({
      '.btn': {
        width: { base: '40px', lg: '90px' },
        '&:hover': {
          divideX: '40px',
          '& > span': {
            color: 'pink',
          },
        },
        _focus: {
          color: 'red.200',
          _hover: {
            backgroundColor: 'red.400',
          },
        },
        sm: {
          fontSize: '12px',
        },
        '& .aaa': {
          color: 'blue.200',
          '& .bbb': {
            color: 'blue.300',
            '& .ccc': {
              color: 'blue.400',
            },
          },
        },
        '.yyy': {
          color: 'blue.300',
          '.zzz': {
            color: 'green.400',
            '.zzzzzzz': {
              color: 'green.500',
            },
          },
        },
      },
    })

    expect(sheet).toMatchInlineSnapshot(`
      "@layer base {
        .btn {
          width: 40px;
      }

        .btn .aaa {
          color: var(--colors-blue-200);
      }

        .btn .aaa .bbb {
          color: var(--colors-blue-300);
      }

        .btn .aaa .bbb .ccc {
          color: var(--colors-blue-400);
      }

        .btn .yyy {
          color: var(--colors-blue-300);
      }

        .btn .yyy .zzz {
          color: var(--colors-green-400);
      }

        .btn .yyy .zzz .zzzzzzz {
          color: var(--colors-green-500);
      }

        .btn:is(:focus, [data-focus]) {
          color: var(--colors-red-200);
      }

        .btn:is(:focus, [data-focus]):is(:hover, [data-hover]) {
          background-color: var(--colors-red-400);
      }

        .btn:hover > :not([hidden]) ~ :not([hidden]) {
          border-inline-start-width: 40px;
          border-inline-end-width: 0px;
      }

        .btn:hover > span {
          color: pink;
      }

        @property --focus-ring-color {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-position {
          syntax: '*';

          inherits: false;
        }

        @property --blur {
          syntax: '*';

          inherits: false;
        }

        @property --brightness {
          syntax: '*';

          inherits: false;
        }

        @property --contrast {
          syntax: '*';

          inherits: false;
        }

        @property --drop-shadow {
          syntax: '*';

          inherits: false;
        }

        @property --grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --invert {
          syntax: '*';

          inherits: false;
        }

        @property --saturate {
          syntax: '*';

          inherits: false;
        }

        @property --sepia {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-blur {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-brightness {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-contrast {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-invert {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-opacity {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-saturate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-sepia {
          syntax: '*';

          inherits: false;
        }

        @property --border-spacing-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --border-spacing-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --transition-easing {
          syntax: '*';

          inherits: false;
        }

        @property --transition-duration {
          syntax: '*';

          inherits: false;
        }

        @property --transition-prop {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-x {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-y {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-z {
          syntax: '*';

          inherits: false;
        }

        @property --scale-x {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --scale-y {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --translate-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-z {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --scrollbar-thumb {
          syntax: '*';

          inherits: false;
        }

        @property --scrollbar-track {
          syntax: '*';

          inherits: false;
        }

        @property --scroll-snap-strictness {
          syntax: '*';

          inherits: false;

          initial-value: proximity;
        }

        @property --mask-linear {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-linear-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-linear-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-linear-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-linear-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-radial {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-radial-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-radial-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-radial-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-radial-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-conic {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-conic-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-conic-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-conic-from-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-conic-to-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-left {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-left-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-left-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-left-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-left-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-right {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-right-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-right-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-right-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-right-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-bottom {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-bottom-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-bottom-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-bottom-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-bottom-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-top {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-top-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-top-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-top-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-top-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-linear-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-radial-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-conic-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-linear-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-conic-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-radial-position {
          syntax: '*';

          inherits: false;

          initial-value: center;
        }

        @property --mask-radial-shape {
          syntax: '*';

          inherits: false;

          initial-value: ellipse;
        }

        @property --mask-radial-size {
          syntax: '*';

          inherits: false;

          initial-value: farthest-corner;
        }

        @property --mask-composite {
          syntax: '*';

          inherits: false;

          initial-value: intersect;
        }

        @property --mask-composite-webkit {
          syntax: '*';

          inherits: false;

          initial-value: source-in;
        }

        @media (width >= 40rem) {
          .btn {
            font-size: 12px;
      }
      }

        @media (width >= 64rem) {
          .btn {
            width: 90px;
      }
      }
      }"
    `)
  })

  test('classic style object', () => {
    const sheet = globalCss({
      html: {
        scrollPaddingTop: '80px',
        '&.dragging-ew': {
          userSelect: 'none !important',
          '& *': {
            cursor: 'ew-resize !important',
          },
          _hover: {
            color: 'red',
          },
        },
      },
      '.content-dark::-webkit-scrollbar-thumb': {
        backgroundColor: 'var(--colors-bg, #000) !important',
        borderColor: 'var(--colors-fg, #333) !important',
        borderRadius: '9px',
        border: '2px solid',
      },
      '#corner': {
        position: 'fixed',
        right: 0,
        bottom: 0,
        cursor: 'nwse-resize',
      },
      '.color-picker .react-colorful': {
        width: '100%',
      },
    })

    expect(sheet).toMatchInlineSnapshot(`
      "@layer base {
        html {
          scroll-padding-top: 80px;
      }

        html.dragging-ew {
          -webkit-user-select: none !important;
          user-select: none !important;
      }

        html.dragging-ew * {
          cursor: ew-resize !important;
      }

        html.dragging-ew:is(:hover, [data-hover]) {
          color: red;
      }

        .content-dark::-webkit-scrollbar-thumb {
          border: 2px solid;
          border-color: var(--colors-fg, #333) !important;
          border-radius: 9px;
          background-color: var(--colors-bg, #000) !important;
      }

        #corner {
          position: fixed;
          cursor: nwse-resize;
          right: 0rem;
          bottom: 0rem;
      }

        .color-picker .react-colorful {
          width: 100%;
      }

        @property --focus-ring-color {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-position {
          syntax: '*';

          inherits: false;
        }

        @property --blur {
          syntax: '*';

          inherits: false;
        }

        @property --brightness {
          syntax: '*';

          inherits: false;
        }

        @property --contrast {
          syntax: '*';

          inherits: false;
        }

        @property --drop-shadow {
          syntax: '*';

          inherits: false;
        }

        @property --grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --invert {
          syntax: '*';

          inherits: false;
        }

        @property --saturate {
          syntax: '*';

          inherits: false;
        }

        @property --sepia {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-blur {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-brightness {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-contrast {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-invert {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-opacity {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-saturate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-sepia {
          syntax: '*';

          inherits: false;
        }

        @property --border-spacing-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --border-spacing-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --transition-easing {
          syntax: '*';

          inherits: false;
        }

        @property --transition-duration {
          syntax: '*';

          inherits: false;
        }

        @property --transition-prop {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-x {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-y {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-z {
          syntax: '*';

          inherits: false;
        }

        @property --scale-x {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --scale-y {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --translate-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-z {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --scrollbar-thumb {
          syntax: '*';

          inherits: false;
        }

        @property --scrollbar-track {
          syntax: '*';

          inherits: false;
        }

        @property --scroll-snap-strictness {
          syntax: '*';

          inherits: false;

          initial-value: proximity;
        }

        @property --mask-linear {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-linear-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-linear-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-linear-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-linear-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-radial {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-radial-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-radial-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-radial-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-radial-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-conic {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-conic-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-conic-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-conic-from-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-conic-to-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-left {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-left-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-left-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-left-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-left-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-right {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-right-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-right-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-right-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-right-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-bottom {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-bottom-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-bottom-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-bottom-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-bottom-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-top {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-top-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-top-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-top-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-top-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-linear-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-radial-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-conic-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-linear-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-conic-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-radial-position {
          syntax: '*';

          inherits: false;

          initial-value: center;
        }

        @property --mask-radial-shape {
          syntax: '*';

          inherits: false;

          initial-value: ellipse;
        }

        @property --mask-radial-size {
          syntax: '*';

          inherits: false;

          initial-value: farthest-corner;
        }

        @property --mask-composite {
          syntax: '*';

          inherits: false;

          initial-value: intersect;
        }

        @property --mask-composite-webkit {
          syntax: '*';

          inherits: false;

          initial-value: source-in;
        }
      }"
    `)
  })

  test('autoprefixed', () => {
    const sheet = globalCss({
      'x-element': {
        tabSize: 'none',
      },
    })

    expect(sheet).toMatchInlineSnapshot(`
      "@layer base {
        x-element {
          tab-size: none;
      }

        @property --focus-ring-color {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-position {
          syntax: '*';

          inherits: false;
        }

        @property --blur {
          syntax: '*';

          inherits: false;
        }

        @property --brightness {
          syntax: '*';

          inherits: false;
        }

        @property --contrast {
          syntax: '*';

          inherits: false;
        }

        @property --drop-shadow {
          syntax: '*';

          inherits: false;
        }

        @property --grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --invert {
          syntax: '*';

          inherits: false;
        }

        @property --saturate {
          syntax: '*';

          inherits: false;
        }

        @property --sepia {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-blur {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-brightness {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-contrast {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-invert {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-opacity {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-saturate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-sepia {
          syntax: '*';

          inherits: false;
        }

        @property --border-spacing-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --border-spacing-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --transition-easing {
          syntax: '*';

          inherits: false;
        }

        @property --transition-duration {
          syntax: '*';

          inherits: false;
        }

        @property --transition-prop {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-x {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-y {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-z {
          syntax: '*';

          inherits: false;
        }

        @property --scale-x {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --scale-y {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --translate-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-z {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --scrollbar-thumb {
          syntax: '*';

          inherits: false;
        }

        @property --scrollbar-track {
          syntax: '*';

          inherits: false;
        }

        @property --scroll-snap-strictness {
          syntax: '*';

          inherits: false;

          initial-value: proximity;
        }

        @property --mask-linear {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-linear-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-linear-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-linear-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-linear-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-radial {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-radial-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-radial-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-radial-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-radial-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-conic {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-conic-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-conic-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-conic-from-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-conic-to-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-left {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-left-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-left-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-left-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-left-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-right {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-right-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-right-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-right-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-right-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-bottom {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-bottom-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-bottom-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-bottom-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-bottom-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-top {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-top-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-top-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-top-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-top-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-linear-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-radial-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-conic-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-linear-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-conic-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-radial-position {
          syntax: '*';

          inherits: false;

          initial-value: center;
        }

        @property --mask-radial-shape {
          syntax: '*';

          inherits: false;

          initial-value: ellipse;
        }

        @property --mask-radial-size {
          syntax: '*';

          inherits: false;

          initial-value: farthest-corner;
        }

        @property --mask-composite {
          syntax: '*';

          inherits: false;

          initial-value: intersect;
        }

        @property --mask-composite-webkit {
          syntax: '*';

          inherits: false;

          initial-value: source-in;
        }
      }"
    `)
  })

  test('nesting rules', () => {
    const sheet = globalCss({
      'body > a': {
        '&:not(:hover)': {
          textDecoration: 'none',
        },
      },
    })

    expect(sheet).toMatchInlineSnapshot(`
      "@layer base {
        body > a:not(:hover) {
          text-decoration: none;
      }

        @property --focus-ring-color {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-position {
          syntax: '*';

          inherits: false;
        }

        @property --blur {
          syntax: '*';

          inherits: false;
        }

        @property --brightness {
          syntax: '*';

          inherits: false;
        }

        @property --contrast {
          syntax: '*';

          inherits: false;
        }

        @property --drop-shadow {
          syntax: '*';

          inherits: false;
        }

        @property --grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --invert {
          syntax: '*';

          inherits: false;
        }

        @property --saturate {
          syntax: '*';

          inherits: false;
        }

        @property --sepia {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-blur {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-brightness {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-contrast {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-invert {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-opacity {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-saturate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-sepia {
          syntax: '*';

          inherits: false;
        }

        @property --border-spacing-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --border-spacing-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --transition-easing {
          syntax: '*';

          inherits: false;
        }

        @property --transition-duration {
          syntax: '*';

          inherits: false;
        }

        @property --transition-prop {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-x {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-y {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-z {
          syntax: '*';

          inherits: false;
        }

        @property --scale-x {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --scale-y {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --translate-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-z {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --scrollbar-thumb {
          syntax: '*';

          inherits: false;
        }

        @property --scrollbar-track {
          syntax: '*';

          inherits: false;
        }

        @property --scroll-snap-strictness {
          syntax: '*';

          inherits: false;

          initial-value: proximity;
        }

        @property --mask-linear {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-linear-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-linear-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-linear-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-linear-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-radial {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-radial-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-radial-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-radial-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-radial-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-conic {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-conic-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-conic-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-conic-from-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-conic-to-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-left {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-left-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-left-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-left-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-left-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-right {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-right-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-right-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-right-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-right-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-bottom {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-bottom-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-bottom-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-bottom-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-bottom-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-top {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-top-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-top-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-top-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-top-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-linear-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-radial-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-conic-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-linear-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-conic-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-radial-position {
          syntax: '*';

          inherits: false;

          initial-value: center;
        }

        @property --mask-radial-shape {
          syntax: '*';

          inherits: false;

          initial-value: ellipse;
        }

        @property --mask-radial-size {
          syntax: '*';

          inherits: false;

          initial-value: farthest-corner;
        }

        @property --mask-composite {
          syntax: '*';

          inherits: false;

          initial-value: intersect;
        }

        @property --mask-composite-webkit {
          syntax: '*';

          inherits: false;

          initial-value: source-in;
        }
      }"
    `)
  })

  test('with recursive nesting rule', () => {
    const sheet = globalCss({
      p: {
        margin: 0,
        '& ~ &': {
          marginTop: 0,
        },
      },
    })

    expect(sheet).toMatchInlineSnapshot(`
      "@layer base {
        p {
          margin: 0rem;
      }

        p ~ p {
          margin-top: 0rem;
      }

        @property --focus-ring-color {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-position {
          syntax: '*';

          inherits: false;
        }

        @property --blur {
          syntax: '*';

          inherits: false;
        }

        @property --brightness {
          syntax: '*';

          inherits: false;
        }

        @property --contrast {
          syntax: '*';

          inherits: false;
        }

        @property --drop-shadow {
          syntax: '*';

          inherits: false;
        }

        @property --grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --invert {
          syntax: '*';

          inherits: false;
        }

        @property --saturate {
          syntax: '*';

          inherits: false;
        }

        @property --sepia {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-blur {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-brightness {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-contrast {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-invert {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-opacity {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-saturate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-sepia {
          syntax: '*';

          inherits: false;
        }

        @property --border-spacing-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --border-spacing-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --transition-easing {
          syntax: '*';

          inherits: false;
        }

        @property --transition-duration {
          syntax: '*';

          inherits: false;
        }

        @property --transition-prop {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-x {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-y {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-z {
          syntax: '*';

          inherits: false;
        }

        @property --scale-x {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --scale-y {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --translate-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-z {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --scrollbar-thumb {
          syntax: '*';

          inherits: false;
        }

        @property --scrollbar-track {
          syntax: '*';

          inherits: false;
        }

        @property --scroll-snap-strictness {
          syntax: '*';

          inherits: false;

          initial-value: proximity;
        }

        @property --mask-linear {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-linear-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-linear-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-linear-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-linear-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-radial {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-radial-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-radial-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-radial-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-radial-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-conic {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-conic-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-conic-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-conic-from-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-conic-to-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-left {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-left-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-left-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-left-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-left-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-right {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-right-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-right-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-right-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-right-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-bottom {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-bottom-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-bottom-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-bottom-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-bottom-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-top {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-top-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-top-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-top-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-top-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-linear-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-radial-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-conic-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-linear-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-conic-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-radial-position {
          syntax: '*';

          inherits: false;

          initial-value: center;
        }

        @property --mask-radial-shape {
          syntax: '*';

          inherits: false;

          initial-value: ellipse;
        }

        @property --mask-radial-size {
          syntax: '*';

          inherits: false;

          initial-value: farthest-corner;
        }

        @property --mask-composite {
          syntax: '*';

          inherits: false;

          initial-value: intersect;
        }

        @property --mask-composite-webkit {
          syntax: '*';

          inherits: false;

          initial-value: source-in;
        }
      }"
    `)
  })

  test('with complex recursive nesting rule + numeric value', () => {
    const sheet = globalCss({
      'body > p, body > ul': {
        margin: 0,
        '& ~ &': {
          marginTop: 10,
        },
      },
    })

    expect(sheet).toMatchInlineSnapshot(`
      "@layer base {
        body > p,body > ul {
          margin: 0rem;
      }

        :is(body > p) ~ :is(body > p),:is(body > ul) ~ :is(body > ul) {
          margin-top: var(--spacing-10);
      }

        @property --focus-ring-color {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-position {
          syntax: '*';

          inherits: false;
        }

        @property --blur {
          syntax: '*';

          inherits: false;
        }

        @property --brightness {
          syntax: '*';

          inherits: false;
        }

        @property --contrast {
          syntax: '*';

          inherits: false;
        }

        @property --drop-shadow {
          syntax: '*';

          inherits: false;
        }

        @property --grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --invert {
          syntax: '*';

          inherits: false;
        }

        @property --saturate {
          syntax: '*';

          inherits: false;
        }

        @property --sepia {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-blur {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-brightness {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-contrast {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-invert {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-opacity {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-saturate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-sepia {
          syntax: '*';

          inherits: false;
        }

        @property --border-spacing-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --border-spacing-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --transition-easing {
          syntax: '*';

          inherits: false;
        }

        @property --transition-duration {
          syntax: '*';

          inherits: false;
        }

        @property --transition-prop {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-x {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-y {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-z {
          syntax: '*';

          inherits: false;
        }

        @property --scale-x {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --scale-y {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --translate-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-z {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --scrollbar-thumb {
          syntax: '*';

          inherits: false;
        }

        @property --scrollbar-track {
          syntax: '*';

          inherits: false;
        }

        @property --scroll-snap-strictness {
          syntax: '*';

          inherits: false;

          initial-value: proximity;
        }

        @property --mask-linear {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-linear-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-linear-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-linear-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-linear-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-radial {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-radial-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-radial-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-radial-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-radial-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-conic {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-conic-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-conic-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-conic-from-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-conic-to-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-left {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-left-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-left-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-left-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-left-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-right {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-right-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-right-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-right-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-right-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-bottom {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-bottom-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-bottom-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-bottom-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-bottom-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-top {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-top-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-top-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-top-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-top-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-linear-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-radial-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-conic-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-linear-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-conic-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-radial-position {
          syntax: '*';

          inherits: false;

          initial-value: center;
        }

        @property --mask-radial-shape {
          syntax: '*';

          inherits: false;

          initial-value: ellipse;
        }

        @property --mask-radial-size {
          syntax: '*';

          inherits: false;

          initial-value: farthest-corner;
        }

        @property --mask-composite {
          syntax: '*';

          inherits: false;

          initial-value: intersect;
        }

        @property --mask-composite-webkit {
          syntax: '*';

          inherits: false;

          initial-value: source-in;
        }
      }"
    `)
  })

  test('with at-rule', () => {
    const sheet = globalCss({
      '@media (min-width: 640px)': {
        'body, :root': {
          color: 'red.200',
        },
      },
    })
    expect(sheet).toMatchInlineSnapshot(`
      "@layer base {
        @property --focus-ring-color {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-position {
          syntax: '*';

          inherits: false;
        }

        @property --blur {
          syntax: '*';

          inherits: false;
        }

        @property --brightness {
          syntax: '*';

          inherits: false;
        }

        @property --contrast {
          syntax: '*';

          inherits: false;
        }

        @property --drop-shadow {
          syntax: '*';

          inherits: false;
        }

        @property --grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --invert {
          syntax: '*';

          inherits: false;
        }

        @property --saturate {
          syntax: '*';

          inherits: false;
        }

        @property --sepia {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-blur {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-brightness {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-contrast {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-invert {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-opacity {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-saturate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-sepia {
          syntax: '*';

          inherits: false;
        }

        @property --border-spacing-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --border-spacing-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --transition-easing {
          syntax: '*';

          inherits: false;
        }

        @property --transition-duration {
          syntax: '*';

          inherits: false;
        }

        @property --transition-prop {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-x {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-y {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-z {
          syntax: '*';

          inherits: false;
        }

        @property --scale-x {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --scale-y {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --translate-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-z {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --scrollbar-thumb {
          syntax: '*';

          inherits: false;
        }

        @property --scrollbar-track {
          syntax: '*';

          inherits: false;
        }

        @property --scroll-snap-strictness {
          syntax: '*';

          inherits: false;

          initial-value: proximity;
        }

        @property --mask-linear {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-linear-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-linear-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-linear-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-linear-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-radial {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-radial-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-radial-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-radial-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-radial-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-conic {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-conic-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-conic-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-conic-from-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-conic-to-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-left {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-left-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-left-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-left-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-left-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-right {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-right-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-right-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-right-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-right-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-bottom {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-bottom-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-bottom-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-bottom-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-bottom-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-top {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-top-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-top-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-top-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-top-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-linear-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-radial-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-conic-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-linear-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-conic-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-radial-position {
          syntax: '*';

          inherits: false;

          initial-value: center;
        }

        @property --mask-radial-shape {
          syntax: '*';

          inherits: false;

          initial-value: ellipse;
        }

        @property --mask-radial-size {
          syntax: '*';

          inherits: false;

          initial-value: farthest-corner;
        }

        @property --mask-composite {
          syntax: '*';

          inherits: false;

          initial-value: intersect;
        }

        @property --mask-composite-webkit {
          syntax: '*';

          inherits: false;

          initial-value: source-in;
        }

        @media (min-width: 640px) {
          body,:root {
            color: var(--colors-red-200);
      }
      }
      }"
    `)
  })

  test('with nested at-rule', () => {
    const sheet = globalCss({
      '@media (min-width: 640px)': {
        '@supports (display: grid) and (display: contents)': {
          body: {
            color: 'red.200',
            '& a': {
              color: 'red.400',
            },
          },
        },
      },
    })

    expect(sheet).toMatchInlineSnapshot(`
      "@layer base {
        @property --focus-ring-color {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to-position {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-from {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-to {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-stops {
          syntax: '*';

          inherits: false;
        }

        @property --gradient-via-position {
          syntax: '*';

          inherits: false;
        }

        @property --blur {
          syntax: '*';

          inherits: false;
        }

        @property --brightness {
          syntax: '*';

          inherits: false;
        }

        @property --contrast {
          syntax: '*';

          inherits: false;
        }

        @property --drop-shadow {
          syntax: '*';

          inherits: false;
        }

        @property --grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --invert {
          syntax: '*';

          inherits: false;
        }

        @property --saturate {
          syntax: '*';

          inherits: false;
        }

        @property --sepia {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-blur {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-brightness {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-contrast {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-grayscale {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-hue-rotate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-invert {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-opacity {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-saturate {
          syntax: '*';

          inherits: false;
        }

        @property --backdrop-sepia {
          syntax: '*';

          inherits: false;
        }

        @property --border-spacing-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --border-spacing-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --transition-easing {
          syntax: '*';

          inherits: false;
        }

        @property --transition-duration {
          syntax: '*';

          inherits: false;
        }

        @property --transition-prop {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-x {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-y {
          syntax: '*';

          inherits: false;
        }

        @property --rotate-z {
          syntax: '*';

          inherits: false;
        }

        @property --scale-x {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --scale-y {
          syntax: '*';

          inherits: false;

          initial-value: 1;
        }

        @property --translate-x {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-y {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --translate-z {
          syntax: '*';

          inherits: false;

          initial-value: 0;
        }

        @property --scrollbar-thumb {
          syntax: '*';

          inherits: false;
        }

        @property --scrollbar-track {
          syntax: '*';

          inherits: false;
        }

        @property --scroll-snap-strictness {
          syntax: '*';

          inherits: false;

          initial-value: proximity;
        }

        @property --mask-linear {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-linear-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-linear-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-linear-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-linear-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-radial {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-radial-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-radial-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-radial-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-radial-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-conic {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-conic-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-conic-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-conic-from-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-conic-to-position {
          syntax: '<angle> | <percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-left {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-left-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-left-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-left-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-left-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-right {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-right-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-right-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-right-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-right-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-bottom {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-bottom-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-bottom-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-bottom-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-bottom-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-top {
          syntax: '*';

          inherits: false;

          initial-value: linear-gradient(#fff, #fff);
        }

        @property --mask-top-from-color {
          syntax: '<color>';

          inherits: false;

          initial-value: black;
        }

        @property --mask-top-to-color {
          syntax: '<color>';

          inherits: false;

          initial-value: transparent;
        }

        @property --mask-top-from-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 0%;
        }

        @property --mask-top-to-position {
          syntax: '<length-percentage>';

          inherits: false;

          initial-value: 100%;
        }

        @property --mask-linear-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-radial-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-conic-stops {
          syntax: '*';

          inherits: false;
        }

        @property --mask-linear-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-conic-position {
          syntax: '*';

          inherits: false;

          initial-value: 0deg;
        }

        @property --mask-radial-position {
          syntax: '*';

          inherits: false;

          initial-value: center;
        }

        @property --mask-radial-shape {
          syntax: '*';

          inherits: false;

          initial-value: ellipse;
        }

        @property --mask-radial-size {
          syntax: '*';

          inherits: false;

          initial-value: farthest-corner;
        }

        @property --mask-composite {
          syntax: '*';

          inherits: false;

          initial-value: intersect;
        }

        @property --mask-composite-webkit {
          syntax: '*';

          inherits: false;

          initial-value: source-in;
        }

        @media (min-width: 640px) {
          @supports (display: grid) and (display: contents) {
            body {
              color: var(--colors-red-200);
      }

            body a {
              color: var(--colors-red-400);
      }
      }
      }
      }"
    `)
  })
})
