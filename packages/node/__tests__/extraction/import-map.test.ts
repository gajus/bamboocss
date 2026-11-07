import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseAndExtract } from './fixture'

describe('config.importMap', () => {
  test('nested outdir + tsconfig.compilerOptions.baseUrl importMap behaviour', () => {
    const code = `
        import { css } from "../styled-system/css";
        import { container } from "../styled-system/patterns";

        export default function App() {
          return (
            <div
              className={container({
                page: "A4",
                width: {
                  _print: "210mm",
                },
                height: {
                  _print: "297mm",
                  base: "600px",
                },
                display: "flex",
                margin: "auto",
                flexDir: {
                  _print: "row",
                  base: "column",
                  sm: "row",
                },
              })}
            >
              <div className={css({ flex: 2 })}>aaa</div>
              <div className={css({ flex: 1 })}>bbb</div>
            </div>
          );
        }

         `
    const result = parseAndExtract(
      code,
      // Absolute, as the CLI and `loadConfigAndCreateContext` always resolve it. The retired suite
      // passed a relative `'app'`, which its in-memory file system rooted at `/`; see the
      // `a relative cwd` test below for what the native engine does with one.
      { outdir: 'src/styled-system', cwd: join(process.cwd(), 'app'), importMap: 'styled-system' },
      { compilerOptions: { baseUrl: join(process.cwd(), 'app/src') } },
    )

    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {
              "display": "flex",
              "flexDir": {
                "_print": "row",
                "base": "column",
                "sm": "row",
              },
              "height": {
                "_print": "297mm",
                "base": "600px",
              },
              "margin": "auto",
              "page": "A4",
              "width": {
                "_print": "210mm",
              },
            },
          ],
          "name": "container",
          "type": "pattern",
        },
        {
          "data": [
            {
              "flex": 2,
            },
          ],
          "name": "css",
          "type": "css",
        },
        {
          "data": [
            {
              "flex": 1,
            },
          ],
          "name": "css",
          "type": "css",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p1000, s010-c0-p2000, s010-c0-p3000, s010-c0-p4000, s010-c1-p3000, s010-c2-p2000, s010-c3-p2000, s010-c4-p3000, s010-c4-p4000;

        @layer s010-c0-p1000 {
          ._0OoTQY\\:m_auto {
            margin: auto;
      }
        }

        @layer s010-c0-p2000 {
          ._0QmaUN\\:mx_auto {
            margin-inline: auto;
      }

          ._pPyFaQ\\:px_4 {
            padding-inline: var(--spacing-4);
      }

          ._cM4iKr\\:flex_2 {
            flex: 2;
      }

          ._cM4iKr\\:flex_1 {
            flex: 1 1 0%;
      }
        }

        @layer s010-c0-p3000 {
          ._PHAS7x\\:pos_relative {
            position: relative;
      }

          ._azwysZ\\:page_A4 {
            page: A4;
      }

          ._Fg8Gj5\\:d_flex {
            display: flex;
      }

          ._AoNTSX\\:flex-d_column {
            flex-direction: column;
      }
        }

        @layer s010-c0-p4000 {
          ._29n7j_\\:max-w_8xl {
            max-width: var(--sizes-8xl);
      }

          ._97NnCm\\:h_600px {
            height: 600px;
      }
        }

        @layer s010-c1-p3000 {
          @media (width >= 40rem) {
            ._deqOyw\\:sm\\:flex-d_row {
              flex-direction: row;
      }
      }
        }

        @layer s010-c2-p2000 {
          @media (width >= 48rem) {
            ._Db4OAM\\:md\\:px_6 {
              padding-inline: var(--spacing-6);
      }
      }
        }

        @layer s010-c3-p2000 {
          @media (width >= 64rem) {
            ._Tuifi1\\:lg\\:px_8 {
              padding-inline: var(--spacing-8);
      }
      }
        }

        @layer s010-c4-p3000 {
          @media print {
            ._qDcXZF\\:print\\:flex-d_row {
              flex-direction: row;
      }
      }
        }

        @layer s010-c4-p4000 {
          @media print {
            ._DrVVJo\\:print\\:w_210mm {
              width: 210mm;
      }
            ._Qa01X-\\:print\\:h_297mm {
              height: 297mm;
      }
      }
        }
      }"
    `)
  })

  test('multiple importMap', () => {
    const code = `
    import { cardStyle } from "@acme/org/recipes"
    import { buttonStyle } from "@bar/org/recipes"
    import { css } from "@foo/org/css"
    import { tooltipStyle } from "styled-system/recipes"
    import { flex } from "@bar/org/patterns"
    cardStyle()
    buttonStyle()
    css({ color: "red" })
    // won't be extracted
    tooltipStyle()
    flex()
     `
    const result = parseAndExtract(code, {
      importMap: {
        css: ['@acme/org/css', '@foo/org/css'],
        recipes: ['@acme/org/recipes', '@bar/org/recipes'],
        patterns: '@acme/org/patterns',
      },
    })
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {},
          ],
          "name": "cardStyle",
          "type": "recipe",
        },
        {
          "data": [
            {},
          ],
          "name": "buttonStyle",
          "type": "recipe",
        },
        {
          "data": [
            {
              "color": "red",
            },
          ],
          "name": "css",
          "type": "css",
        },
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

        .buttonStyle--size_md {
          padding: 0 0.75rem;
          height: 3rem;
          min-width: 3rem;
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
      }

      @layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._Btm_AK\\:c_red {
            color: red;
      }
        }
      }"
    `)
  })
})
