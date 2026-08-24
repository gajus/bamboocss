import { describe, expect, test } from 'vitest'
import { button } from '../styled-system/recipes/button'
import { buttonWithCompoundVariants } from '../styled-system/recipes/button-with-compound-variants'

describe('recipe', () => {
  test('refuses to resolve a class string at runtime', () => {
    expect(() => button()).toThrow('was not compiled')
    expect(() => button({ visual: 'solid' })).toThrow('button')
    expect(() => buttonWithCompoundVariants({ visual: 'solid' })).toThrow('was not compiled')
  })

  test('split variant props', () => {
    const result = button.splitVariantProps({ visual: 'solid', bg: 'red.500' })
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "visual": "solid",
        },
        {
          "bg": "red.500",
        },
      ]
    `)
  })

  test('split variant props (compound)', () => {
    const result = buttonWithCompoundVariants.splitVariantProps({ visual: 'solid', bg: 'red.500' })

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "visual": "solid",
        },
        {
          "bg": "red.500",
        },
      ]
    `)
  })

  test('get variant props', () => {
    const result = buttonWithCompoundVariants.getVariantProps({ visual: 'outline' })

    expect(result).toMatchInlineSnapshot(`
      {
        "button": "__ignore__",
        "visual": "outline",
      }
    `)
  })
})
