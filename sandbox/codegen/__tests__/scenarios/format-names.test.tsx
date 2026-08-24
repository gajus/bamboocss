import { describe, expect, test } from 'vitest'
import { css, cva } from '../../styled-system-format-names/css'
import { buttonWithCompoundVariants } from '../../styled-system-format-names/recipes'

describe('format-names generated runtime', () => {
  const button = cva({
    base: { color: '$red-500' },
    variants: { size: { sm: { fontSize: '$sm' } } },
  })

  test('css() throws until compiled', () => {
    expect(() => css({ mx: '2' })).toThrow('was not compiled')
  })

  test('cva() throws until compiled', () => {
    expect(() => button()).toThrow('was not compiled')
    expect(() => button({ size: 'sm' })).toThrow('cva')
  })

  test('config recipes throw until compiled', () => {
    expect(() => buttonWithCompoundVariants()).toThrow('was not compiled')
  })
})
