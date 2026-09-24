import { describe, expect, test } from 'vitest'
import { cssParser } from './fixture'

describe('ast parser', () => {
  test('[without import] should not parse', () => {
    const code = `
    import {css} from "styled-system/css"

        const baseStyle = css({
            color: 'red',
            fontSize: '12px',
        })

        const testStyle = css({
          bg: "red.300",
          margin: { xs: "0", lg:"40px" },
        })

        const welcome = css({
          '[dir=rtl]': {
            textAlign: 'right',
          },
          '&[data-state=closed]': {
            animation: 'exit',
            fadeOut: '0.2',
          },
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
              },
            ],
            "name": "css",
            "type": "css",
          },
          {
            "data": [
              {
                "&[data-state=closed]": {
                  "animation": "exit",
                  "fadeOut": "0.2",
                },
                "[dir=rtl]": {
                  "textAlign": "right",
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
})
