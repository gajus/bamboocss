import { describe, expect, test } from 'vitest'
import { sva } from '../styled-system/css/sva'

describe('sva', () => {
  const button = sva({
    slots: ['root', 'icon'],
    base: {
      root: { borderRadius: 'md', fontWeight: 'semibold', h: '10', px: '4' },
      icon: { fontSize: '2xl' },
    },
    variants: {
      visual: {
        solid: {
          root: {
            bg: { base: 'colorPalette.500', _dark: 'colorPalette.300' },
            color: { base: 'white', _dark: 'gray.800' },
          },
          icon: {
            color: 'white',
          },
        },
        outline: {
          root: {
            border: '1px solid',
            color: { base: 'colorPalette.600', _dark: 'colorPalette.200' },
            borderColor: 'currentColor',
          },
          icon: {
            border: '1px solid',
          },
        },
        unstyled: {},
      },
    },
    defaultVariants: {
      visual: 'unstyled',
    },
  })

  test('refuses to resolve slot classes at runtime', () => {
    expect(() => button()).toThrow('was not compiled')
    expect(() => button({ visual: 'solid' })).toThrow('sva')
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

  test('get variant props', () => {
    const result = button.getVariantProps()

    expect(result).toMatchInlineSnapshot(`
      {
        "visual": "unstyled",
      }
    `)
  })
})
