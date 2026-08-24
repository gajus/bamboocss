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

  test('get variant props', () => {
    const result = button.getVariantProps()

    expect(result).toMatchInlineSnapshot(`
      {
        "visual": "unstyled",
      }
    `)
  })

  test('raw returns an object the caller owns', () => {
    const first = button.raw({ visual: 'solid' })
    const second = button.raw({ visual: 'solid' })

    expect(first).not.toBe(second)

    const expected = structuredClone(second)

    first.fontWeight = 'poisoned'
    ;(first.color as Record<string, string>)._dark = 'poisoned'

    expect(button.raw({ visual: 'solid' })).toEqual(expected)
  })

  test('the copy reaches nested condition blocks', () => {
    const outline = button.raw({ visual: 'outline' })
    delete (outline.color as Record<string, unknown>)._dark

    expect(button.raw({ visual: 'outline' }).color).toEqual({
      base: 'colorPalette.600',
      _dark: 'colorPalette.200',
    })
  })
})
