import type { Dict } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { createRuleProcessor } from './fixture'

describe('gradient utilities', () => {
  const processor = createRuleProcessor({
    theme: {
      extend: {
        tokens: {
          gradients: {
            primary: { value: 'linear-gradient(to right, #ff0000, #0000ff)' },
          },
        },
      },
    },
  })

  const css = (styles: Dict) => {
    const result = processor.clone().css(styles)
    return { className: result.getClassNames(), css: result.toCss() }
  }

  test('bgGradient with gradient token', () => {
    expect(css({ bgGradient: 'primary' })).toMatchInlineSnapshot(`
      {
        "className": [
          "_tMsygv\\:bg-grad_primary",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._tMsygv\\:bg-grad_primary {
            background-image: var(--gradients-primary);
      }
        }
      }",
      }
    `)
  })

  test('bgGradient with direction shortcut', () => {
    expect(css({ bgGradient: 'to-r' })).toMatchInlineSnapshot(`
      {
        "className": [
          "_tMsygv\\:bg-grad_to-r",
        ],
        "css": "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          ._tMsygv\\:bg-grad_to-r {
            --gradient-stops: var(--gradient-via-stops, var(--gradient-position), var(--gradient-from) var(--gradient-from-position, ), var(--gradient-to) var(--gradient-to-position, ));
            --gradient-position: to right;
            background-image: linear-gradient(var(--gradient-stops));
      }
        }
      }",
      }
    `)
  })

  test('bgGradient with token references', () => {
    expect(css({ bgGradient: 'linear-gradient(token(colors.red.200), token(colors.blue.300))' }))
      .toMatchInlineSnapshot(`
        {
          "className": [
            "_tMsygv\\:bg-grad_linear-gradient\\(token\\(colors\\.red\\.200\\)\\,_token\\(colors\\.blue\\.300\\)\\)",
          ],
          "css": "@layer utilities {
          @layer s010-c0-p3000;

          @layer s010-c0-p3000 {
            ._tMsygv\\:bg-grad_linear-gradient\\(token\\(colors\\.red\\.200\\)\\,_token\\(colors\\.blue\\.300\\)\\) {
              background-image: linear-gradient(var(--colors-red-200), var(--colors-blue-300));
        }
          }
        }",
        }
      `)
  })

  test('textGradient with token references', () => {
    expect(css({ textGradient: 'linear-gradient(token(colors.red.200), token(colors.blue.300))' }))
      .toMatchInlineSnapshot(`
        {
          "className": [
            "_PWugOE\\:txt-grad_linear-gradient\\(token\\(colors\\.red\\.200\\)\\,_token\\(colors\\.blue\\.300\\)\\)",
          ],
          "css": "@layer utilities {
          @layer s010-c0-p3000;

          @layer s010-c0-p3000 {
            ._PWugOE\\:txt-grad_linear-gradient\\(token\\(colors\\.red\\.200\\)\\,_token\\(colors\\.blue\\.300\\)\\) {
              background-image: linear-gradient(var(--colors-red-200), var(--colors-blue-300));
              -webkit-background-clip: text;
              color: transparent;
        }
          }
        }",
        }
      `)
  })
})
