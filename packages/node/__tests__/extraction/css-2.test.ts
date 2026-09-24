import { describe, test, expect } from 'vitest'
import { cssParser, parseAndExtract } from './fixture'

describe('ast parser', () => {
  test('[without import] should not parse', () => {
    const code = `
        const baseStyle = css({
            color: 'red',
            fontSize: '12px',
        })

        const testStyle = css({
          bg: "red.300",
          margin: { xs: "0", lg:"40px" },
          padding: { base: 12, lg: 50 }
        })
     `

    // A `css` that nothing imported is somebody else's function. The TypeScript engine matched
    // the bare name and emitted rules for it; the native engine follows the binding, as the
    // Vite compiler does, so the stylesheet and the compiled code agree about it.
    expect([...cssParser(code).css]).toEqual([])
  })

  test('[with import] should parse static property', () => {
    const code = `
    import {css} from "styled-system/css";
        const baseStyle = css({
            color: 'red',
            fontSize: '12px',
        })

        const testStyle = css({
          bg: "red.300",
          margin: { xs: "0", lg:"40px" },
          padding: { base: 12, lg: 50 }
        })
     `

    expect(cssParser(code)).toMatchInlineSnapshot(`
      {
        "css": Set {
          {
            "data": [
              {
                "color": "red",
                "fontSize": "12px",
              },
            ],
            "name": "css",
            "type": "css",
          },
          {
            "data": [
              {
                "bg": "red.300",
                "margin": {
                  "lg": "40px",
                  "xs": "0",
                },
                "padding": {
                  "base": 12,
                  "lg": 50,
                },
              },
            ],
            "name": "css",
            "type": "css",
          },
        },
      }
    `)
  })

  test('[with import alias] should parse static property', () => {
    const code = `
    import {css as nCss} from "styled-system/css";
        const baseStyle = nCss({
            color: 'red',
            fontSize: '12px',
        })

        const testStyle = nCss({
          bg: "red.300",
          margin: { xs: "0", lg:"40px" },
          padding: { base: 12, lg: 50 }
        })
     `

    expect(cssParser(code)).toMatchInlineSnapshot(`
      {
        "css": Set {
          {
            "data": [
              {
                "color": "red",
                "fontSize": "12px",
              },
            ],
            "name": "css",
            "type": "css",
          },
          {
            "data": [
              {
                "bg": "red.300",
                "margin": {
                  "lg": "40px",
                  "xs": "0",
                },
                "padding": {
                  "base": 12,
                  "lg": 50,
                },
              },
            ],
            "name": "css",
            "type": "css",
          },
        },
      }
    `)
  })

  test('should extract nested css', () => {
    const code = `
      import { css } from 'styled-system/css'

console.log(
  console.log(
    css({
      selectors: {
        '&:hover': {
          background: 'red.200',
        },
      },
    }),
  ),
)
`

    expect(cssParser(code)).toMatchInlineSnapshot(`
      {
        "css": Set {
          {
            "data": [
              {
                "selectors": {
                  "&:hover": {
                    "background": "red.200",
                  },
                },
              },
            ],
            "name": "css",
            "type": "css",
          },
        },
      }
    `)
  })

  test('should extract complex setup', () => {
    const code = `
      import { css, cx } from 'styled-system/css'
import React from 'react'

export function Card({ className }) {
  return (
    <div className={cx('card', css({ background: 'white' }), className)}>
      <div></div>
    </div>
  )
}

      `
    expect(cssParser(code)).toMatchInlineSnapshot(`
      {
        "css": Set {
          {
            "data": [
              {
                "background": "white",
              },
            ],
            "name": "css",
            "type": "css",
          },
        },
      }
    `)
  })

  /**
   * Issue #1022 itself — a JSX spread on a sibling must not stop the `css()` call extracting —
   * through the `css` entrypoint. The test below imports `css` from `styled-system/jsx`, which the
   * retired engine matched and the native engine does not; see there.
   */
  test('issue #1022, through the css entrypoint', () => {
    const result = parseAndExtract(
      `import { css } from '../styled-system/css';
      const meta = { title: 'hello world:' };
      export const App = () => <div className={css({ color: 'red.400', maxW: '1000px' })}><Meta {...meta} /></div>;
      const Meta = ({ title }) => <div>{title}</div>;
      `,
    )

    expect(result.json).toEqual([{ data: [{ color: 'red.400', maxW: '1000px' }], name: 'css', type: 'css' }])
  })

  /**
   * The original #1022 source imported `css` from `styled-system/jsx`, which does not export it.
   * The TypeScript engine matched the bare name; the native engine follows the import, so that
   * spelling extracts nothing — and the Vite compiler, reading the same binding, leaves the call
   * alone. The case the issue was about is pinned above through the `css` entrypoint.
   */
  test('issue #1022: css imported from an entrypoint that does not export it is not ours', () => {
    const result = parseAndExtract(
      `import { css } from '../styled-system/jsx';
      export const App = () => <div className={css({ color: 'red.400', maxW: '1000px' })} />
      `,
    )

    expect(result.json).toEqual([])
  })
})
