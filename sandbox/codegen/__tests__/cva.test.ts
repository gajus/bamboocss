import { describe, expect, test } from 'vitest'
import { cva } from '../styled-system/css/cva'

describe('cva', () => {
  const button = cva({
    base: {
      borderRadius: 'md',
      fontWeight: 'semibold',
      h: '10',
      px: '4',
    },
    variants: {
      visual: {
        solid: {
          bg: { base: 'colorPalette.500', _dark: 'colorPalette.300' },
          color: { base: 'white', _dark: 'gray.800' },
        },
        outline: {
          border: '1px solid',
          color: { base: 'colorPalette.600', _dark: 'colorPalette.200' },
          borderColor: 'currentColor',
        },
        unstyled: {},
      },
    },
    defaultVariants: {
      visual: 'unstyled',
    },
  })

  test('refuses to resolve a class string at runtime', () => {
    expect(() => button()).toThrow('was not compiled')
    expect(() => button({ visual: 'solid' })).toThrow('cva')
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
})
