import { describe, expect, test } from 'vitest'
import { parseAndExtract, svaParser } from './fixture'

describe('ast parser / sva', () => {
  test('should parse', () => {
    const code = `
    import {sva} from "styled-system/css"

    const button = sva({
        slots: ['label', 'icon'],
        base: {
            label: {
            color: 'red',
            },
            icon: {
            fontSize: 'lg',
            },
        },
    })
     `

    expect(svaParser(code)).toMatchInlineSnapshot(`
      {
        "sva": Set {
          {
            "data": [
              {
                "base": {
                  "icon": {
                    "fontSize": "lg",
                  },
                  "label": {
                    "color": "red",
                  },
                },
                "slots": [
                  "label",
                  "icon",
                ],
              },
            ],
            "name": "sva",
            "type": "sva",
          },
        },
      }
    `)
  })

  test('unresolvable slots', () => {
    const code = `
    import { sva } from 'styled-system/css'
    import { slots } from './slots'

    const card = sva({
      slots,
      base: {
        root: {
          p: '6',
          m: '4',
          w: 'md',
          boxShadow: 'md',
          borderRadius: 'md',
          _dark: { bg: '#262626', color: 'white' },
        },
        content: {
          textStyle: 'lg',
        },
        title: {
          textStyle: 'xl',
          fontWeight: 'semibold',
          pb: '2',
        },
      },
    })
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {
              "base": {
                "content": {
                  "textStyle": "lg",
                },
                "root": {
                  "_dark": {
                    "bg": "#262626",
                    "color": "white",
                  },
                  "borderRadius": "md",
                  "boxShadow": "md",
                  "m": "4",
                  "p": "6",
                  "w": "md",
                },
                "title": {
                  "fontWeight": "semibold",
                  "pb": "2",
                  "textStyle": "xl",
                },
              },
            },
          ],
          "name": "sva",
          "type": "sva",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer recipes.slots {
        .sva_gbRdhD__root {
          padding: var(--spacing-6);
          margin: var(--spacing-4);
          border-radius: var(--radii-md);
          box-shadow: var(--shadows-md);
          width: var(--sizes-md);
      }

        [data-theme=dark] .sva_gbRdhD__root,.dark .sva_gbRdhD__root,.sva_gbRdhD__root.dark,.sva_gbRdhD__root[data-theme=dark] {
          background: #262626;
          color: var(--colors-white);
      }

        .sva_gbRdhD__content {
          text-style: lg;
      }

        .sva_gbRdhD__title {
          text-style: xl;
          font-weight: var(--font-weights-semibold);
          padding-bottom: var(--spacing-2);
      }
      }"
    `)
  })

  // Resolvable since the array-spread fix: `[...parts]` flattens when `parts` boxes to an
  // array. The sibling below stays unresolvable -- its spread is over a call result.
  test('resolvable slots - spread', () => {
    const code = `
    import { sva } from 'styled-system/css'
    const parts = ['positioner', 'content']

    const card = sva({
      slots: [...parts],
      base: {
        root: {
          p: '6',
        },
      },
    })
     `
    const result = parseAndExtract(code)
    expect(result.json).toMatchInlineSnapshot(`
      [
        {
          "data": [
            {
              "base": {
                "root": {
                  "p": "6",
                },
              },
              "slots": [
                "positioner",
                "content",
              ],
            },
          ],
          "name": "sva",
          "type": "sva",
        },
      ]
    `)

    expect(result.css).toMatchInlineSnapshot(`
      "@layer recipes.slots {
        .sva_fiLqSq__root {
          padding: var(--spacing-6);
      }
      }"
    `)
  })

  test('unresolvable + concat - spread', () => {
    const code = `
      import { anatomy } from '@/slots'
      import { sva } from 'styled-system/css'

      const card = sva({
        slots: [...anatomy().keys(), 'slots', 'here'],
        className: 'tt',
        base: {
          a: {
            backgroundColor: 'red',
          },
        },
      })
     `

    const result = parseAndExtract(code)
    expect(result.css).toMatchInlineSnapshot(`
      "@layer recipes.slots {
        .tt__a {
          background-color: red;
      }
      }"
    `)
  })
})
