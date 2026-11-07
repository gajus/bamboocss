import { createCss } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'

import type { SystemStyleObject } from '@bamboocss/types'
import { createRuleProcessor } from './fixture'
import { createGeneratorContext } from '@bamboocss/fixture'

const config = { prefix: 'tw', hash: { className: true, cssVar: true } }
const backend = (styles: SystemStyleObject) => createRuleProcessor(config).css(styles).toCss()

const frontend = createCss(createGeneratorContext(config).baseSheetContext)

describe('atomic-rule / prefix', () => {
  test('should product consistent hash', () => {
    expect(backend({ color: 'red' })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          .tw-_Btm_AK\\:TkDIm {
            color: red;
      }
        }
      }"
    `)
    expect(frontend({ color: 'red' })).toMatchInlineSnapshot(`"tw-_Btm_AK:TkDIm"`)

    expect(backend({ color: { sm: 'red' } })).toMatchInlineSnapshot(`
      "@layer utilities {
        @layer s010-c0-p3000;

        @layer s010-c0-p3000 {
          @media (width >= 40rem) {
            .tw-_8AVSDl\\:XQ89d {
              color: red;
      }
      }
        }
      }"
    `)
    expect(frontend({ color: { sm: 'red' } })).toMatchInlineSnapshot(`"tw-_8AVSDl:XQ89d"`)
  })
})
