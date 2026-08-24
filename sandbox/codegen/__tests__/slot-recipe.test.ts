import { describe, expect, test } from 'vitest'
import { slotButton } from '../styled-system/recipes/'

describe('sva', () => {
  test('refuses to resolve slot classes at runtime', () => {
    expect(() => slotButton()).toThrow('was not compiled')
    expect(() => slotButton({ visual: 'solid' })).toThrow('slot-button')
  })

  test('split variant props', () => {
    const result = slotButton.splitVariantProps({ visual: 'solid', bg: 'red.500' })

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
    const result = slotButton.getVariantProps()

    expect(result).toMatchInlineSnapshot(`
      {
        "visual": "unstyled",
      }
    `)
  })
})
