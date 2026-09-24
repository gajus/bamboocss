import { describe, test, expect } from 'vitest'
import { patternParser } from './fixture'

describe('pattern jsx', () => {
  test('should extract', () => {
    const code = `
       import { flex, center as aliased } from "styled-system/patterns"

       function Button() {
         return (
            <div>
               <div className={flex({ align: "center" })}>Click me</div>
               <div className={aliased({ justify: "flex-end" })}>Click me</div>
            </div>
        )
       }
     `

    expect(patternParser(code)).toMatchInlineSnapshot(`
      Map {
        "flex" => Set {
          {
            "data": [
              {
                "align": "center",
              },
            ],
            "name": "flex",
            "type": "pattern",
          },
        },
        "center" => Set {
          {
            "data": [
              {
                "justify": "flex-end",
              },
            ],
            "name": "center",
            "type": "pattern",
          },
        },
      }
    `)
  })
})
