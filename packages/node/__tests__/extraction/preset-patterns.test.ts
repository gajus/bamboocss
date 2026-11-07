import { describe, expect, test } from 'vitest'
import { parseAndExtract } from './fixture'

describe('preset patterns', () => {
  test('flex', () => {
    const code = `
      import { flex } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={flex()}>Click me</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {},
          ],
          "name": "flex",
          "type": "pattern",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._Fg8Gj5\\:d_flex {
            display: flex;
      }
        }
      }"
    `)
  })

  test('spacer', () => {
    const code = `
      import { spacer } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={spacer()}>Click me</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {},
          ],
          "name": "spacer",
          "type": "pattern",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000, s010-c0-p3000;

        @layer s010-c0-p2000 {
          ._cM4iKr\\:flex_1 {
            flex: 1 1 0%;
      }
        }

        @layer s010-c0-p3000 {
          ._a9lftO\\:as_stretch {
            align-self: stretch;
      }

          ._fDdPQa\\:justify-self_stretch {
            justify-self: stretch;
      }
        }
      }"
    `)
  })

  test('spacer - with token size', () => {
    const code = `
      import { spacer } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={spacer({ size: '4' })}>Click me</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000, s010-c0-p3000;

        @layer s010-c0-p2000 {
          ._cM4iKr\\:flex_0_0_var\\(--spacing-4\\) {
            flex: 0 0 var(--spacing-4);
      }
        }

        @layer s010-c0-p3000 {
          ._a9lftO\\:as_stretch {
            align-self: stretch;
      }

          ._fDdPQa\\:justify-self_stretch {
            justify-self: stretch;
      }
        }
      }"
    `)
  })

  test('spacer - with css unit size', () => {
    const code = `
      import { spacer } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={spacer({ size: '40px' })}>Click me</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000, s010-c0-p3000;

        @layer s010-c0-p2000 {
          ._cM4iKr\\:flex_0_0_40px {
            flex: 0 0 40px;
      }
        }

        @layer s010-c0-p3000 {
          ._a9lftO\\:as_stretch {
            align-self: stretch;
      }

          ._fDdPQa\\:justify-self_stretch {
            justify-self: stretch;
      }
        }
      }"
    `)
  })

  test('linkOverlay', () => {
    const code = `
      import { css } from "styled-system/css"
      import { linkOverlay } from "styled-system/patterns"

      function Button() {
        return (
          <div className={css({ pos: 'relative' })}>
              <a className={linkOverlay()}>Click me</a>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {
              "pos": "relative",
            },
          ],
          "name": "css",
          "type": "css",
        },
        {
          "data": [
            {},
          ],
          "name": "linkOverlay",
          "type": "pattern",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000, s011-c1-p1000, s011-c1-p3000;

        @layer s010-c0-p3000 {
          ._PHAS7x\\:pos_relative {
            position: relative;
      }
        }

        @layer s011-c1-p1000 {
          ._LAfdp8\\:before\\:inset_0::before {
            inset: var(--spacing-0);
      }
        }

        @layer s011-c1-p3000 {
          ._vya0vI\\:before\\:content_\\"\\"::before {
            content: "";
      }

          ._A_HDgC\\:before\\:pos_absolute::before {
            position: absolute;
      }

          ._jbp2fk\\:before\\:z_0::before {
            z-index: 0;
      }
        }
      }"
    `)
  })

  test('float', () => {
    const code = `
      import { float } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={float()}>Click me</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {},
          ],
          "name": "float",
          "type": "pattern",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._Fg8Gj5\\:d_inline-flex {
            display: inline-flex;
      }

          ._syDQuH\\:jc_center {
            justify-content: center;
      }

          ._IS_uqi\\:ai_center {
            align-items: center;
      }

          ._PHAS7x\\:pos_absolute {
            position: absolute;
      }

          ._7xURoC\\:inset-bs_0 {
            inset-block-start: var(--spacing-0);
      }

          ._lFBHho\\:inset-be_auto {
            inset-block-end: auto;
      }

          ._oCxt6h\\:inset-s_auto {
            inset-inline-start: auto;
      }

          ._tikPb5\\:inset-e_0 {
            inset-inline-end: var(--spacing-0);
      }

          ._nZtn2j\\:translate_50\\%_-50\\% {
            translate: 50% -50%;
      }
        }
      }"
    `)
  })

  test('grid', () => {
    const code = `
      import { grid } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={grid()}>Click me</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {},
          ],
          "name": "grid",
          "type": "pattern",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000, s010-c0-p3000;

        @layer s010-c0-p2000 {
          ._uetrIO\\:gap_8px {
            gap: 8px;
      }
        }

        @layer s010-c0-p3000 {
          ._Fg8Gj5\\:d_grid {
            display: grid;
      }
        }
      }"
    `)
  })

  test('gridItem', () => {
    const code = `
      import { gridItem } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={gridItem()}>Click me</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {},
          ],
          "name": "gridItem",
          "type": "pattern",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot('""')
  })

  test('container', () => {
    const code = `
      import { container } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={container()}>Click me</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {},
          ],
          "name": "container",
          "type": "pattern",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000, s010-c0-p3000, s010-c0-p4000, s010-c1-p2000, s010-c2-p2000;

        @layer s010-c0-p2000 {
          ._0QmaUN\\:mx_auto {
            margin-inline: auto;
      }

          ._pPyFaQ\\:px_4 {
            padding-inline: var(--spacing-4);
      }
        }

        @layer s010-c0-p3000 {
          ._PHAS7x\\:pos_relative {
            position: relative;
      }
        }

        @layer s010-c0-p4000 {
          ._29n7j_\\:max-w_8xl {
            max-width: var(--sizes-8xl);
      }
        }

        @layer s010-c1-p2000 {
          @media (width >= 48rem) {
            ._Db4OAM\\:md\\:px_6 {
              padding-inline: var(--spacing-6);
      }
      }
        }

        @layer s010-c2-p2000 {
          @media (width >= 64rem) {
            ._Tuifi1\\:lg\\:px_8 {
              padding-inline: var(--spacing-8);
      }
      }
        }
      }"
    `)
  })

  test('center', () => {
    const code = `
      import { center } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={center()}>Click me</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {},
          ],
          "name": "center",
          "type": "pattern",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._Fg8Gj5\\:d_flex {
            display: flex;
      }

          ._IS_uqi\\:ai_center {
            align-items: center;
      }

          ._syDQuH\\:jc_center {
            justify-content: center;
      }
        }
      }"
    `)
  })

  /**
   * `size` is what `square` and `circle` were. It sets both axes and pins `flex`, which is the
   * part that is not obvious: without it a flex parent shrinks the box back below the size that
   * was asked for. An unsized `center` must not get that declaration, since it would change how
   * every existing call lays out — hence both halves asserted here.
   */
  test('center - with size', () => {
    const code = `
      import { center } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={center({ size: '12' })}>square</div>
              <div className={center({ size: '12', borderRadius: 'full' })}>circle</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)

    expect(result.css).toContain('flex: 0 0 auto')
    expect(result.css).toContain('width: var(--sizes-12)')
    expect(result.css).toContain('height: var(--sizes-12)')
    expect(result.css).toContain('border-radius: var(--radii-full)')
  })

  test('aspectRatio', () => {
    const code = `
      import { aspectRatio } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={aspectRatio()}>Click me</div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {},
          ],
          "name": "aspectRatio",
          "type": "pattern",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000, s010-c1-p1000, s010-c1-p2000, s010-c1-p3000, s010-c1-p4000, s011-c2-p3000, s011-c3-p3000, s011-c2-p4000;

        @layer s010-c0-p3000 {
          ._PHAS7x\\:pos_relative {
            position: relative;
      }
        }

        @layer s010-c1-p1000 {
          ._hmTE0v\\:\\[\\&\\>\\*\\]\\:inset_0>* {
            inset: var(--spacing-0);
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
            height: var(--sizes-0);
      }

          ._XLvIYN\\:before\\:pb_75\\%::before {
            padding-bottom: 75%;
      }
        }
      }"
    `)
  })

  test('responsive pattern properties', () => {
    const code = `
      import { grid, gridItem } from "styled-system/patterns"

      function Button() {
        return (
          <div>
              <div className={grid({ columns: { base: 2, sm: 3, md: 4 } })}>
                <div className={gridItem({ colSpan: { base: 1, sm: 2, md: 3 } })}>Click me</div>
              </div>
          </div>
        )
      }
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {
              "columns": {
                "base": 2,
                "md": 4,
                "sm": 3,
              },
            },
          ],
          "name": "grid",
          "type": "pattern",
        },
        {
          "data": [
            {
              "colSpan": {
                "base": 1,
                "md": 3,
                "sm": 2,
              },
            },
          ],
          "name": "gridItem",
          "type": "pattern",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000, s010-c0-p3000, s010-c1-p2000, s010-c1-p3000, s010-c2-p2000, s010-c2-p3000;

        @layer s010-c0-p2000 {
          ._uetrIO\\:gap_8px {
            gap: 8px;
      }

          ._A_Z_g_\\:grid-c_span_1 {
            grid-column: span 1;
      }
        }

        @layer s010-c0-p3000 {
          ._Fg8Gj5\\:d_grid {
            display: grid;
      }

          ._J8kvkh\\:grid-tc_repeat\\(2\\,_minmax\\(0\\,_1fr\\)\\) {
            grid-template-columns: repeat(2, minmax(0, 1fr));
      }
        }

        @layer s010-c1-p2000 {
          @media (width >= 40rem) {
            ._QbRvO4\\:sm\\:grid-c_span_2 {
              grid-column: span 2;
      }
      }
        }

        @layer s010-c1-p3000 {
          @media (width >= 40rem) {
            ._wKXwmU\\:sm\\:grid-tc_repeat\\(3\\,_minmax\\(0\\,_1fr\\)\\) {
              grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      }
        }

        @layer s010-c2-p2000 {
          @media (width >= 48rem) {
            ._Wzvt00\\:md\\:grid-c_span_3 {
              grid-column: span 3;
      }
      }
        }

        @layer s010-c2-p3000 {
          @media (width >= 48rem) {
            ._xbfc_-\\:md\\:grid-tc_repeat\\(4\\,_minmax\\(0\\,_1fr\\)\\) {
              grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      }
        }
      }"
    `)
  })
})

describe('staticCss', () => {
  test('type: number', () => {
    const { ctx } = parseAndExtract('', {
      staticCss: {
        patterns: {
          // type: 'number'
          aspectRatio: [{ properties: { ratio: [4 / 3, 16 / 9, 1 / 1] } }],
        },
      },
    })

    const sheet = ctx.createSheet()
    ctx.appendCssOfType('static', sheet)
    const css = ctx.getCss(sheet)

    expect(css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000, s010-c1-p1000, s010-c1-p2000, s010-c1-p3000, s010-c1-p4000, s011-c2-p3000, s011-c3-p3000, s011-c2-p4000;

        @layer s010-c0-p3000 {
          ._PHAS7x\\:pos_relative {
            position: relative;
      }
        }

        @layer s010-c1-p1000 {
          ._hmTE0v\\:\\[\\&\\>\\*\\]\\:inset_0>* {
            inset: var(--spacing-0);
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
            height: var(--sizes-0);
      }

          ._XLvIYN\\:before\\:pb_75\\%::before {
            padding-bottom: 75%;
      }

          ._XLvIYN\\:before\\:pb_56\\.25\\%::before {
            padding-bottom: 56.25%;
      }

          ._XLvIYN\\:before\\:pb_100\\%::before {
            padding-bottom: 100%;
      }
        }
      }"
    `)
  })

  test('type: number + conditions', () => {
    const { ctx } = parseAndExtract('', {
      staticCss: {
        patterns: {
          // type: 'number'
          aspectRatio: [{ properties: { ratio: [1 / 4] }, conditions: ['md'] }],
        },
      },
    })

    const sheet = ctx.createSheet()
    ctx.appendCssOfType('static', sheet)
    const css = ctx.getCss(sheet)

    expect(css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000, s010-c1-p1000, s010-c1-p2000, s010-c1-p3000, s010-c1-p4000, s010-c4-p3000, s010-c5-p1000, s010-c5-p2000, s010-c5-p3000, s010-c5-p4000, s011-c2-p3000, s011-c3-p3000, s011-c2-p4000, s011-c6-p3000, s011-c7-p3000, s011-c6-p4000;

        @layer s010-c0-p3000 {
          ._PHAS7x\\:pos_relative {
            position: relative;
      }
        }

        @layer s010-c1-p1000 {
          ._hmTE0v\\:\\[\\&\\>\\*\\]\\:inset_0>* {
            inset: var(--spacing-0);
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
              inset: var(--spacing-0);
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
            height: var(--sizes-0);
      }

          ._XLvIYN\\:before\\:pb_400\\%::before {
            padding-bottom: 400%;
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
              height: var(--sizes-0);
      }
            ._h64Bfy\\:md\\:before\\:pb_400\\%::before {
              padding-bottom: 400%;
      }
      }
        }
      }"
    `)
  })

  test('type: token', () => {
    const { ctx } = parseAndExtract('', {
      staticCss: {
        patterns: {
          // type: 'token'
          spacer: [{ properties: { size: ['2', '4', '6'] } }],
        },
      },
    })

    const sheet = ctx.createSheet()
    ctx.appendCssOfType('static', sheet)
    const css = ctx.getCss(sheet)

    expect(css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000, s010-c0-p3000;

        @layer s010-c0-p2000 {
          ._cM4iKr\\:flex_0_0_var\\(--spacing-2\\) {
            flex: 0 0 var(--spacing-2);
      }

          ._cM4iKr\\:flex_0_0_var\\(--spacing-4\\) {
            flex: 0 0 var(--spacing-4);
      }

          ._cM4iKr\\:flex_0_0_var\\(--spacing-6\\) {
            flex: 0 0 var(--spacing-6);
      }
        }

        @layer s010-c0-p3000 {
          ._a9lftO\\:as_stretch {
            align-self: stretch;
      }

          ._fDdPQa\\:justify-self_stretch {
            justify-self: stretch;
      }
        }
      }"
    `)
  })

  test('type: property', () => {
    const { ctx } = parseAndExtract('', {
      staticCss: {
        patterns: {
          // type: 'property'
          center: [{ properties: { size: ['sm', 'md', 'lg'] } }],
        },
      },
    })

    const sheet = ctx.createSheet()
    ctx.appendCssOfType('static', sheet)
    const css = ctx.getCss(sheet)

    expect(css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p2000, s010-c0-p3000, s010-c0-p4000;

        @layer s010-c0-p2000 {
          ._cM4iKr\\:flex_0_0_auto {
            flex: 0 0 auto;
      }
        }

        @layer s010-c0-p3000 {
          ._Fg8Gj5\\:d_flex {
            display: flex;
      }

          ._IS_uqi\\:ai_center {
            align-items: center;
      }

          ._syDQuH\\:jc_center {
            justify-content: center;
      }
        }

        @layer s010-c0-p4000 {
          ._RO16FJ\\:w_sm {
            width: var(--sizes-sm);
      }

          ._97NnCm\\:h_sm {
            height: var(--sizes-sm);
      }

          ._RO16FJ\\:w_md {
            width: var(--sizes-md);
      }

          ._97NnCm\\:h_md {
            height: var(--sizes-md);
      }

          ._RO16FJ\\:w_lg {
            width: var(--sizes-lg);
      }

          ._97NnCm\\:h_lg {
            height: var(--sizes-lg);
      }
        }
      }"
    `)
  })

  test('type: property *', () => {
    const { ctx } = parseAndExtract('', {
      staticCss: {
        patterns: {
          // type: 'property'
          bleed: [{ properties: { inline: ['*'] } }],
        },
      },
    })

    const sheet = ctx.createSheet()
    ctx.appendCssOfType('static', sheet)
    const css = ctx.getCss(sheet)

    expect(css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1, s010-c0-p2000;

        @layer s010-c0-p1 {
          ._Mg_8tV\\:--bleed-x_var\\(--spacing-0\\) {
            --bleed-x: var(--spacing-0);
      }

          ._b2NXtV\\:--bleed-y_var\\(--spacing-0\\) {
            --bleed-y: var(--spacing-0);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-1\\) {
            --bleed-x: var(--spacing-1);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-2\\) {
            --bleed-x: var(--spacing-2);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-3\\) {
            --bleed-x: var(--spacing-3);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-4\\) {
            --bleed-x: var(--spacing-4);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-5\\) {
            --bleed-x: var(--spacing-5);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-6\\) {
            --bleed-x: var(--spacing-6);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-7\\) {
            --bleed-x: var(--spacing-7);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-8\\) {
            --bleed-x: var(--spacing-8);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-9\\) {
            --bleed-x: var(--spacing-9);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-10\\) {
            --bleed-x: var(--spacing-10);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-11\\) {
            --bleed-x: var(--spacing-11);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-12\\) {
            --bleed-x: var(--spacing-12);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-14\\) {
            --bleed-x: var(--spacing-14);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-16\\) {
            --bleed-x: var(--spacing-16);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-20\\) {
            --bleed-x: var(--spacing-20);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-24\\) {
            --bleed-x: var(--spacing-24);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-28\\) {
            --bleed-x: var(--spacing-28);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-32\\) {
            --bleed-x: var(--spacing-32);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-36\\) {
            --bleed-x: var(--spacing-36);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-40\\) {
            --bleed-x: var(--spacing-40);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-44\\) {
            --bleed-x: var(--spacing-44);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-48\\) {
            --bleed-x: var(--spacing-48);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-52\\) {
            --bleed-x: var(--spacing-52);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-56\\) {
            --bleed-x: var(--spacing-56);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-60\\) {
            --bleed-x: var(--spacing-60);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-64\\) {
            --bleed-x: var(--spacing-64);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-72\\) {
            --bleed-x: var(--spacing-72);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-80\\) {
            --bleed-x: var(--spacing-80);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-96\\) {
            --bleed-x: var(--spacing-96);
      }

          ._Mg_8tV\\:--bleed-x_auto {
            --bleed-x: auto;
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-0\\\\\\.5\\) {
            --bleed-x: var(--spacing-0\\.5);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-1\\\\\\.5\\) {
            --bleed-x: var(--spacing-1\\.5);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-2\\\\\\.5\\) {
            --bleed-x: var(--spacing-2\\.5);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-3\\\\\\.5\\) {
            --bleed-x: var(--spacing-3\\.5);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-4\\\\\\.5\\) {
            --bleed-x: var(--spacing-4\\.5);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-5\\\\\\.5\\) {
            --bleed-x: var(--spacing-5\\.5);
      }

          ._Mg_8tV\\:--bleed-x_var\\(--spacing-gutter\\) {
            --bleed-x: var(--spacing-gutter);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-1\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-1) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-2\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-2) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-3\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-3) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-4\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-4) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-5\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-5) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-6\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-6) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-7\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-7) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-8\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-8) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-9\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-9) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-10\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-10) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-11\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-11) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-12\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-12) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-14\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-14) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-16\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-16) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-20\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-20) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-24\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-24) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-28\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-28) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-32\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-32) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-36\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-36) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-40\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-40) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-44\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-44) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-48\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-48) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-52\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-52) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-56\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-56) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-60\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-60) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-64\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-64) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-72\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-72) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-80\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-80) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-96\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-96) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-0\\\\\\.5\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-0\\.5) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-1\\\\\\.5\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-1\\.5) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-2\\\\\\.5\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-2\\.5) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-3\\\\\\.5\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-3\\.5) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-4\\\\\\.5\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-4\\.5) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-5\\\\\\.5\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-5\\.5) * -1);
      }

          ._Mg_8tV\\:--bleed-x_calc\\(var\\(--spacing-gutter\\)_\\*_-1\\) {
            --bleed-x: calc(var(--spacing-gutter) * -1);
      }
        }

        @layer s010-c0-p2000 {
          ._0QmaUN\\:mx_calc\\(var\\(--bleed-x\\,_0\\)_\\*_-1\\) {
            margin-inline: calc(var(--bleed-x, 0) * -1);
      }

          ._F2GXY7\\:my_calc\\(var\\(--bleed-y\\,_0\\)_\\*_-1\\) {
            margin-block: calc(var(--bleed-y, 0) * -1);
      }
        }
      }"
    `)
  })

  test('type: enum', () => {
    const { ctx } = parseAndExtract('', {
      staticCss: {
        patterns: {
          // type: 'enum' + type: 'token'
          divider: [{ properties: { orientation: ['*'], thickness: ['*'] } }],
        },
      },
    })

    const sheet = ctx.createSheet()
    ctx.appendCssOfType('static', sheet)
    const css = ctx.getCss(sheet)

    expect(css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1, s010-c0-p3000, s010-c0-p4000;

        @layer s010-c0-p1 {
          ._XPmwuw\\:--thickness_1px {
            --thickness: 1px;
      }

          ._XPmwuw\\:--thickness_0 {
            --thickness: 0;
      }

          ._XPmwuw\\:--thickness_1 {
            --thickness: 1;
      }

          ._XPmwuw\\:--thickness_2 {
            --thickness: 2;
      }

          ._XPmwuw\\:--thickness_3 {
            --thickness: 3;
      }

          ._XPmwuw\\:--thickness_4 {
            --thickness: 4;
      }

          ._XPmwuw\\:--thickness_5 {
            --thickness: 5;
      }

          ._XPmwuw\\:--thickness_6 {
            --thickness: 6;
      }

          ._XPmwuw\\:--thickness_7 {
            --thickness: 7;
      }

          ._XPmwuw\\:--thickness_8 {
            --thickness: 8;
      }

          ._XPmwuw\\:--thickness_9 {
            --thickness: 9;
      }

          ._XPmwuw\\:--thickness_10 {
            --thickness: 10;
      }

          ._XPmwuw\\:--thickness_11 {
            --thickness: 11;
      }

          ._XPmwuw\\:--thickness_12 {
            --thickness: 12;
      }

          ._XPmwuw\\:--thickness_14 {
            --thickness: 14;
      }

          ._XPmwuw\\:--thickness_16 {
            --thickness: 16;
      }

          ._XPmwuw\\:--thickness_20 {
            --thickness: 20;
      }

          ._XPmwuw\\:--thickness_24 {
            --thickness: 24;
      }

          ._XPmwuw\\:--thickness_28 {
            --thickness: 28;
      }

          ._XPmwuw\\:--thickness_32 {
            --thickness: 32;
      }

          ._XPmwuw\\:--thickness_36 {
            --thickness: 36;
      }

          ._XPmwuw\\:--thickness_40 {
            --thickness: 40;
      }

          ._XPmwuw\\:--thickness_44 {
            --thickness: 44;
      }

          ._XPmwuw\\:--thickness_48 {
            --thickness: 48;
      }

          ._XPmwuw\\:--thickness_52 {
            --thickness: 52;
      }

          ._XPmwuw\\:--thickness_56 {
            --thickness: 56;
      }

          ._XPmwuw\\:--thickness_60 {
            --thickness: 60;
      }

          ._XPmwuw\\:--thickness_64 {
            --thickness: 64;
      }

          ._XPmwuw\\:--thickness_72 {
            --thickness: 72;
      }

          ._XPmwuw\\:--thickness_80 {
            --thickness: 80;
      }

          ._XPmwuw\\:--thickness_96 {
            --thickness: 96;
      }

          ._XPmwuw\\:--thickness_0\\.5 {
            --thickness: 0.5;
      }

          ._XPmwuw\\:--thickness_1\\.5 {
            --thickness: 1.5;
      }

          ._XPmwuw\\:--thickness_2\\.5 {
            --thickness: 2.5;
      }

          ._XPmwuw\\:--thickness_3\\.5 {
            --thickness: 3.5;
      }

          ._XPmwuw\\:--thickness_4\\.5 {
            --thickness: 4.5;
      }

          ._XPmwuw\\:--thickness_5\\.5 {
            --thickness: 5.5;
      }

          ._XPmwuw\\:--thickness_xs {
            --thickness: xs;
      }

          ._XPmwuw\\:--thickness_sm {
            --thickness: sm;
      }

          ._XPmwuw\\:--thickness_md {
            --thickness: md;
      }

          ._XPmwuw\\:--thickness_lg {
            --thickness: lg;
      }

          ._XPmwuw\\:--thickness_xl {
            --thickness: xl;
      }

          ._XPmwuw\\:--thickness_2xl {
            --thickness: 2xl;
      }

          ._XPmwuw\\:--thickness_3xl {
            --thickness: 3xl;
      }

          ._XPmwuw\\:--thickness_4xl {
            --thickness: 4xl;
      }

          ._XPmwuw\\:--thickness_5xl {
            --thickness: 5xl;
      }

          ._XPmwuw\\:--thickness_6xl {
            --thickness: 6xl;
      }

          ._XPmwuw\\:--thickness_7xl {
            --thickness: 7xl;
      }

          ._XPmwuw\\:--thickness_8xl {
            --thickness: 8xl;
      }

          ._XPmwuw\\:--thickness_prose {
            --thickness: prose;
      }

          ._XPmwuw\\:--thickness_full {
            --thickness: full;
      }

          ._XPmwuw\\:--thickness_min {
            --thickness: min;
      }

          ._XPmwuw\\:--thickness_max {
            --thickness: max;
      }

          ._XPmwuw\\:--thickness_fit {
            --thickness: fit;
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

        @layer s010-c0-p3000 {
          ._iDqfKY\\:bd-be-w_var\\(--thickness\\) {
            border-block-end-width: var(--thickness);
      }

          ._amUV18\\:bd-e-w_var\\(--thickness\\) {
            border-inline-end-width: var(--thickness);
      }
        }

        @layer s010-c0-p4000 {
          ._RO16FJ\\:w_100\\% {
            width: 100%;
      }

          ._97NnCm\\:h_100\\% {
            height: 100%;
      }
        }
      }"
    `)
  })

  test('type: enum *', () => {
    const { ctx } = parseAndExtract('', {
      staticCss: {
        patterns: {
          // type: 'enum' + type: 'token'
          float: ['*'],
        },
      },
    })

    const sheet = ctx.createSheet()
    ctx.appendCssOfType('static', sheet)
    const css = ctx.getCss(sheet)

    expect(css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._Fg8Gj5\\:d_inline-flex {
            display: inline-flex;
      }

          ._syDQuH\\:jc_center {
            justify-content: center;
      }

          ._IS_uqi\\:ai_center {
            align-items: center;
      }

          ._PHAS7x\\:pos_absolute {
            position: absolute;
      }

          ._7xURoC\\:inset-bs_0 {
            inset-block-start: var(--spacing-0);
      }

          ._lFBHho\\:inset-be_auto {
            inset-block-end: auto;
      }

          ._oCxt6h\\:inset-s_auto {
            inset-inline-start: auto;
      }

          ._tikPb5\\:inset-e_0 {
            inset-inline-end: var(--spacing-0);
      }

          ._nZtn2j\\:translate_50\\%_-50\\% {
            translate: 50% -50%;
      }

          ._tikPb5\\:inset-e_1 {
            inset-inline-end: var(--spacing-1);
      }

          ._tikPb5\\:inset-e_2 {
            inset-inline-end: var(--spacing-2);
      }

          ._tikPb5\\:inset-e_3 {
            inset-inline-end: var(--spacing-3);
      }

          ._tikPb5\\:inset-e_4 {
            inset-inline-end: var(--spacing-4);
      }

          ._tikPb5\\:inset-e_5 {
            inset-inline-end: var(--spacing-5);
      }

          ._tikPb5\\:inset-e_6 {
            inset-inline-end: var(--spacing-6);
      }

          ._tikPb5\\:inset-e_7 {
            inset-inline-end: var(--spacing-7);
      }

          ._tikPb5\\:inset-e_8 {
            inset-inline-end: var(--spacing-8);
      }

          ._tikPb5\\:inset-e_9 {
            inset-inline-end: var(--spacing-9);
      }

          ._tikPb5\\:inset-e_10 {
            inset-inline-end: var(--spacing-10);
      }

          ._tikPb5\\:inset-e_11 {
            inset-inline-end: var(--spacing-11);
      }

          ._tikPb5\\:inset-e_12 {
            inset-inline-end: var(--spacing-12);
      }

          ._tikPb5\\:inset-e_14 {
            inset-inline-end: var(--spacing-14);
      }

          ._tikPb5\\:inset-e_16 {
            inset-inline-end: var(--spacing-16);
      }

          ._tikPb5\\:inset-e_20 {
            inset-inline-end: var(--spacing-20);
      }

          ._tikPb5\\:inset-e_24 {
            inset-inline-end: var(--spacing-24);
      }

          ._tikPb5\\:inset-e_28 {
            inset-inline-end: var(--spacing-28);
      }

          ._tikPb5\\:inset-e_32 {
            inset-inline-end: var(--spacing-32);
      }

          ._tikPb5\\:inset-e_36 {
            inset-inline-end: var(--spacing-36);
      }

          ._tikPb5\\:inset-e_40 {
            inset-inline-end: var(--spacing-40);
      }

          ._tikPb5\\:inset-e_44 {
            inset-inline-end: var(--spacing-44);
      }

          ._tikPb5\\:inset-e_48 {
            inset-inline-end: var(--spacing-48);
      }

          ._tikPb5\\:inset-e_52 {
            inset-inline-end: var(--spacing-52);
      }

          ._tikPb5\\:inset-e_56 {
            inset-inline-end: var(--spacing-56);
      }

          ._tikPb5\\:inset-e_60 {
            inset-inline-end: var(--spacing-60);
      }

          ._tikPb5\\:inset-e_64 {
            inset-inline-end: var(--spacing-64);
      }

          ._tikPb5\\:inset-e_72 {
            inset-inline-end: var(--spacing-72);
      }

          ._tikPb5\\:inset-e_80 {
            inset-inline-end: var(--spacing-80);
      }

          ._tikPb5\\:inset-e_96 {
            inset-inline-end: var(--spacing-96);
      }

          ._tikPb5\\:inset-e_0\\.5 {
            inset-inline-end: var(--spacing-0\\.5);
      }

          ._tikPb5\\:inset-e_1\\.5 {
            inset-inline-end: var(--spacing-1\\.5);
      }

          ._tikPb5\\:inset-e_2\\.5 {
            inset-inline-end: var(--spacing-2\\.5);
      }

          ._tikPb5\\:inset-e_3\\.5 {
            inset-inline-end: var(--spacing-3\\.5);
      }

          ._tikPb5\\:inset-e_4\\.5 {
            inset-inline-end: var(--spacing-4\\.5);
      }

          ._tikPb5\\:inset-e_5\\.5 {
            inset-inline-end: var(--spacing-5\\.5);
      }

          ._tikPb5\\:inset-e_gutter {
            inset-inline-end: var(--spacing-gutter);
      }

          ._tikPb5\\:inset-e_-1 {
            inset-inline-end: calc(var(--spacing-1) * -1);
      }

          ._tikPb5\\:inset-e_-2 {
            inset-inline-end: calc(var(--spacing-2) * -1);
      }

          ._tikPb5\\:inset-e_-3 {
            inset-inline-end: calc(var(--spacing-3) * -1);
      }

          ._tikPb5\\:inset-e_-4 {
            inset-inline-end: calc(var(--spacing-4) * -1);
      }

          ._tikPb5\\:inset-e_-5 {
            inset-inline-end: calc(var(--spacing-5) * -1);
      }

          ._tikPb5\\:inset-e_-6 {
            inset-inline-end: calc(var(--spacing-6) * -1);
      }

          ._tikPb5\\:inset-e_-7 {
            inset-inline-end: calc(var(--spacing-7) * -1);
      }

          ._tikPb5\\:inset-e_-8 {
            inset-inline-end: calc(var(--spacing-8) * -1);
      }

          ._tikPb5\\:inset-e_-9 {
            inset-inline-end: calc(var(--spacing-9) * -1);
      }

          ._tikPb5\\:inset-e_-10 {
            inset-inline-end: calc(var(--spacing-10) * -1);
      }

          ._tikPb5\\:inset-e_-11 {
            inset-inline-end: calc(var(--spacing-11) * -1);
      }

          ._tikPb5\\:inset-e_-12 {
            inset-inline-end: calc(var(--spacing-12) * -1);
      }

          ._tikPb5\\:inset-e_-14 {
            inset-inline-end: calc(var(--spacing-14) * -1);
      }

          ._tikPb5\\:inset-e_-16 {
            inset-inline-end: calc(var(--spacing-16) * -1);
      }

          ._tikPb5\\:inset-e_-20 {
            inset-inline-end: calc(var(--spacing-20) * -1);
      }

          ._tikPb5\\:inset-e_-24 {
            inset-inline-end: calc(var(--spacing-24) * -1);
      }

          ._tikPb5\\:inset-e_-28 {
            inset-inline-end: calc(var(--spacing-28) * -1);
      }

          ._tikPb5\\:inset-e_-32 {
            inset-inline-end: calc(var(--spacing-32) * -1);
      }

          ._tikPb5\\:inset-e_-36 {
            inset-inline-end: calc(var(--spacing-36) * -1);
      }

          ._tikPb5\\:inset-e_-40 {
            inset-inline-end: calc(var(--spacing-40) * -1);
      }

          ._tikPb5\\:inset-e_-44 {
            inset-inline-end: calc(var(--spacing-44) * -1);
      }

          ._tikPb5\\:inset-e_-48 {
            inset-inline-end: calc(var(--spacing-48) * -1);
      }

          ._tikPb5\\:inset-e_-52 {
            inset-inline-end: calc(var(--spacing-52) * -1);
      }

          ._tikPb5\\:inset-e_-56 {
            inset-inline-end: calc(var(--spacing-56) * -1);
      }

          ._tikPb5\\:inset-e_-60 {
            inset-inline-end: calc(var(--spacing-60) * -1);
      }

          ._tikPb5\\:inset-e_-64 {
            inset-inline-end: calc(var(--spacing-64) * -1);
      }

          ._tikPb5\\:inset-e_-72 {
            inset-inline-end: calc(var(--spacing-72) * -1);
      }

          ._tikPb5\\:inset-e_-80 {
            inset-inline-end: calc(var(--spacing-80) * -1);
      }

          ._tikPb5\\:inset-e_-96 {
            inset-inline-end: calc(var(--spacing-96) * -1);
      }

          ._tikPb5\\:inset-e_-0\\.5 {
            inset-inline-end: calc(var(--spacing-0\\.5) * -1);
      }

          ._tikPb5\\:inset-e_-1\\.5 {
            inset-inline-end: calc(var(--spacing-1\\.5) * -1);
      }

          ._tikPb5\\:inset-e_-2\\.5 {
            inset-inline-end: calc(var(--spacing-2\\.5) * -1);
      }

          ._tikPb5\\:inset-e_-3\\.5 {
            inset-inline-end: calc(var(--spacing-3\\.5) * -1);
      }

          ._tikPb5\\:inset-e_-4\\.5 {
            inset-inline-end: calc(var(--spacing-4\\.5) * -1);
      }

          ._tikPb5\\:inset-e_-5\\.5 {
            inset-inline-end: calc(var(--spacing-5\\.5) * -1);
      }

          ._tikPb5\\:inset-e_-gutter {
            inset-inline-end: calc(var(--spacing-gutter) * -1);
      }

          ._7xURoC\\:inset-bs_1 {
            inset-block-start: var(--spacing-1);
      }

          ._7xURoC\\:inset-bs_2 {
            inset-block-start: var(--spacing-2);
      }

          ._7xURoC\\:inset-bs_3 {
            inset-block-start: var(--spacing-3);
      }

          ._7xURoC\\:inset-bs_4 {
            inset-block-start: var(--spacing-4);
      }

          ._7xURoC\\:inset-bs_5 {
            inset-block-start: var(--spacing-5);
      }

          ._7xURoC\\:inset-bs_6 {
            inset-block-start: var(--spacing-6);
      }

          ._7xURoC\\:inset-bs_7 {
            inset-block-start: var(--spacing-7);
      }

          ._7xURoC\\:inset-bs_8 {
            inset-block-start: var(--spacing-8);
      }

          ._7xURoC\\:inset-bs_9 {
            inset-block-start: var(--spacing-9);
      }

          ._7xURoC\\:inset-bs_10 {
            inset-block-start: var(--spacing-10);
      }

          ._7xURoC\\:inset-bs_11 {
            inset-block-start: var(--spacing-11);
      }

          ._7xURoC\\:inset-bs_12 {
            inset-block-start: var(--spacing-12);
      }

          ._7xURoC\\:inset-bs_14 {
            inset-block-start: var(--spacing-14);
      }

          ._7xURoC\\:inset-bs_16 {
            inset-block-start: var(--spacing-16);
      }

          ._7xURoC\\:inset-bs_20 {
            inset-block-start: var(--spacing-20);
      }

          ._7xURoC\\:inset-bs_24 {
            inset-block-start: var(--spacing-24);
      }

          ._7xURoC\\:inset-bs_28 {
            inset-block-start: var(--spacing-28);
      }

          ._7xURoC\\:inset-bs_32 {
            inset-block-start: var(--spacing-32);
      }

          ._7xURoC\\:inset-bs_36 {
            inset-block-start: var(--spacing-36);
      }

          ._7xURoC\\:inset-bs_40 {
            inset-block-start: var(--spacing-40);
      }

          ._7xURoC\\:inset-bs_44 {
            inset-block-start: var(--spacing-44);
      }

          ._7xURoC\\:inset-bs_48 {
            inset-block-start: var(--spacing-48);
      }

          ._7xURoC\\:inset-bs_52 {
            inset-block-start: var(--spacing-52);
      }

          ._7xURoC\\:inset-bs_56 {
            inset-block-start: var(--spacing-56);
      }

          ._7xURoC\\:inset-bs_60 {
            inset-block-start: var(--spacing-60);
      }

          ._7xURoC\\:inset-bs_64 {
            inset-block-start: var(--spacing-64);
      }

          ._7xURoC\\:inset-bs_72 {
            inset-block-start: var(--spacing-72);
      }

          ._7xURoC\\:inset-bs_80 {
            inset-block-start: var(--spacing-80);
      }

          ._7xURoC\\:inset-bs_96 {
            inset-block-start: var(--spacing-96);
      }

          ._7xURoC\\:inset-bs_0\\.5 {
            inset-block-start: var(--spacing-0\\.5);
      }

          ._7xURoC\\:inset-bs_1\\.5 {
            inset-block-start: var(--spacing-1\\.5);
      }

          ._7xURoC\\:inset-bs_2\\.5 {
            inset-block-start: var(--spacing-2\\.5);
      }

          ._7xURoC\\:inset-bs_3\\.5 {
            inset-block-start: var(--spacing-3\\.5);
      }

          ._7xURoC\\:inset-bs_4\\.5 {
            inset-block-start: var(--spacing-4\\.5);
      }

          ._7xURoC\\:inset-bs_5\\.5 {
            inset-block-start: var(--spacing-5\\.5);
      }

          ._7xURoC\\:inset-bs_gutter {
            inset-block-start: var(--spacing-gutter);
      }

          ._7xURoC\\:inset-bs_-1 {
            inset-block-start: calc(var(--spacing-1) * -1);
      }

          ._7xURoC\\:inset-bs_-2 {
            inset-block-start: calc(var(--spacing-2) * -1);
      }

          ._7xURoC\\:inset-bs_-3 {
            inset-block-start: calc(var(--spacing-3) * -1);
      }

          ._7xURoC\\:inset-bs_-4 {
            inset-block-start: calc(var(--spacing-4) * -1);
      }

          ._7xURoC\\:inset-bs_-5 {
            inset-block-start: calc(var(--spacing-5) * -1);
      }

          ._7xURoC\\:inset-bs_-6 {
            inset-block-start: calc(var(--spacing-6) * -1);
      }

          ._7xURoC\\:inset-bs_-7 {
            inset-block-start: calc(var(--spacing-7) * -1);
      }

          ._7xURoC\\:inset-bs_-8 {
            inset-block-start: calc(var(--spacing-8) * -1);
      }

          ._7xURoC\\:inset-bs_-9 {
            inset-block-start: calc(var(--spacing-9) * -1);
      }

          ._7xURoC\\:inset-bs_-10 {
            inset-block-start: calc(var(--spacing-10) * -1);
      }

          ._7xURoC\\:inset-bs_-11 {
            inset-block-start: calc(var(--spacing-11) * -1);
      }

          ._7xURoC\\:inset-bs_-12 {
            inset-block-start: calc(var(--spacing-12) * -1);
      }

          ._7xURoC\\:inset-bs_-14 {
            inset-block-start: calc(var(--spacing-14) * -1);
      }

          ._7xURoC\\:inset-bs_-16 {
            inset-block-start: calc(var(--spacing-16) * -1);
      }

          ._7xURoC\\:inset-bs_-20 {
            inset-block-start: calc(var(--spacing-20) * -1);
      }

          ._7xURoC\\:inset-bs_-24 {
            inset-block-start: calc(var(--spacing-24) * -1);
      }

          ._7xURoC\\:inset-bs_-28 {
            inset-block-start: calc(var(--spacing-28) * -1);
      }

          ._7xURoC\\:inset-bs_-32 {
            inset-block-start: calc(var(--spacing-32) * -1);
      }

          ._7xURoC\\:inset-bs_-36 {
            inset-block-start: calc(var(--spacing-36) * -1);
      }

          ._7xURoC\\:inset-bs_-40 {
            inset-block-start: calc(var(--spacing-40) * -1);
      }

          ._7xURoC\\:inset-bs_-44 {
            inset-block-start: calc(var(--spacing-44) * -1);
      }

          ._7xURoC\\:inset-bs_-48 {
            inset-block-start: calc(var(--spacing-48) * -1);
      }

          ._7xURoC\\:inset-bs_-52 {
            inset-block-start: calc(var(--spacing-52) * -1);
      }

          ._7xURoC\\:inset-bs_-56 {
            inset-block-start: calc(var(--spacing-56) * -1);
      }

          ._7xURoC\\:inset-bs_-60 {
            inset-block-start: calc(var(--spacing-60) * -1);
      }

          ._7xURoC\\:inset-bs_-64 {
            inset-block-start: calc(var(--spacing-64) * -1);
      }

          ._7xURoC\\:inset-bs_-72 {
            inset-block-start: calc(var(--spacing-72) * -1);
      }

          ._7xURoC\\:inset-bs_-80 {
            inset-block-start: calc(var(--spacing-80) * -1);
      }

          ._7xURoC\\:inset-bs_-96 {
            inset-block-start: calc(var(--spacing-96) * -1);
      }

          ._7xURoC\\:inset-bs_-0\\.5 {
            inset-block-start: calc(var(--spacing-0\\.5) * -1);
      }

          ._7xURoC\\:inset-bs_-1\\.5 {
            inset-block-start: calc(var(--spacing-1\\.5) * -1);
      }

          ._7xURoC\\:inset-bs_-2\\.5 {
            inset-block-start: calc(var(--spacing-2\\.5) * -1);
      }

          ._7xURoC\\:inset-bs_-3\\.5 {
            inset-block-start: calc(var(--spacing-3\\.5) * -1);
      }

          ._7xURoC\\:inset-bs_-4\\.5 {
            inset-block-start: calc(var(--spacing-4\\.5) * -1);
      }

          ._7xURoC\\:inset-bs_-5\\.5 {
            inset-block-start: calc(var(--spacing-5\\.5) * -1);
      }

          ._7xURoC\\:inset-bs_-gutter {
            inset-block-start: calc(var(--spacing-gutter) * -1);
      }

          ._7xURoC\\:inset-bs_auto {
            inset-block-start: auto;
      }

          ._lFBHho\\:inset-be_0 {
            inset-block-end: var(--spacing-0);
      }

          ._nZtn2j\\:translate_50\\%_50\\% {
            translate: 50% 50%;
      }

          ._oCxt6h\\:inset-s_0 {
            inset-inline-start: var(--spacing-0);
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
      }"
    `)
  })
})
