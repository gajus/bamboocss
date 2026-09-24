import { describe, expect, test } from 'vitest'
import { cvaParser } from './fixture'

describe('ast parser / cva', () => {
  test('should parse', () => {
    const code = `
    import {cva} from "styled-system/css"

    const baseStyle = cva({
        base: {
            color: 'red',
            fontSize: '12px',
        },
        variants: {
            color: {
                red: {
                    background: 'red'
                }
            },
            size: {
                sm: {
                    fontSize: '12px'
                },
                md: {
                    fontSize: '24px'
                }
            }
        },
        compoundVariants: [
            {
                color: 'red',
                size: 'sm',
                css: {
                    fontWeight: 'bold'
                }
            },
            {
                color: ['red', 'blue'],
                size: ['sm', 'md'],
                css: {
                    color: 'white'
                }
            }
        ]
    })
     `

    expect(cvaParser(code)).toMatchInlineSnapshot(`
      {
        "cva": Set {
          {
            "data": [
              {
                "base": {
                  "color": "red",
                  "fontSize": "12px",
                },
                "compoundVariants": [
                  {
                    "color": "red",
                    "css": {
                      "fontWeight": "bold",
                    },
                    "size": "sm",
                  },
                  {
                    "color": [
                      "red",
                      "blue",
                    ],
                    "css": {
                      "color": "white",
                    },
                    "size": [
                      "sm",
                      "md",
                    ],
                  },
                ],
                "variants": {
                  "color": {
                    "red": {
                      "background": "red",
                    },
                  },
                  "size": {
                    "md": {
                      "fontSize": "24px",
                    },
                    "sm": {
                      "fontSize": "12px",
                    },
                  },
                },
              },
            ],
            "name": "cva",
            "type": "cva",
          },
        },
      }
    `)
  })
})
