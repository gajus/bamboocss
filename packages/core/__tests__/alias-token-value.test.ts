import type { Config, SystemStyleObject } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { createRuleProcessor } from './fixture'

const css = (styles: SystemStyleObject, config?: Config) => createRuleProcessor(config).css(styles).toCss()

/**
 * A value whose name also names a token compiles to a reference to it: `padding: '0'` is
 * `spacing.0`. Where that token is only the CSS value its name spells, and nothing gives it another,
 * the reference can never resolve to anything else, so the token's value is written instead.
 */
describe('a token that is only the value its name spells', () => {
  test('is written as its value', () => {
    const out = css({ padding: '0', border: 'none', background: 'transparent' })

    expect(out).toContain('padding: 0rem;')
    expect(out).toContain('border: none;')
    expect(out).toContain('background: rgb(0 0 0 / 0);')
    expect(out).not.toContain('var(--')
  })

  // The value written is the token's, which is what the reference resolved to, so a utility that
  // puts it inside `calc()` gets a length there, where a bare `0` would not be one.
  test("writes the token's value, not the name", () => {
    expect(css({ marginTop: '0' })).toContain('margin-top: 0rem;')
  })

  test('is written as its value under a condition of the style', () => {
    const out = css({ _hover: { padding: '0' }, md: { border: 'none' } })

    expect(out).toContain('padding: 0rem;')
    expect(out).toContain('border: none;')
    expect(out).not.toContain('var(--')
  })

  test('keeps the class name the value was written with', () => {
    expect(css({ padding: '0' })).toContain('p_0')
  })
})

describe('a token keeps its reference', () => {
  test('where its value is not what its name spells', () => {
    const out = css({ padding: '4', lineHeight: 'none' })

    expect(out).toContain('padding: var(--spacing-4);')
    expect(out).toContain('line-height: var(--line-heights-none);')
  })

  test('where a condition gives it another value', () => {
    const semantic: Config = {
      theme: { extend: { semanticTokens: { colors: { canvas: { value: { base: 'canvas', _dark: 'black' } } } } } },
    }
    const plain: Config = { theme: { extend: { tokens: { colors: { canvas: { value: 'canvas' } } } } } }

    expect(css({ color: 'canvas' }, semantic)).toContain('color: var(--colors-canvas);')
    expect(css({ color: 'canvas' }, plain)).toContain('color: canvas;')
  })

  test('where a theme gives it another value', () => {
    const themed: Config = { theme: { variants: { roomy: { tokens: { spacing: { 0: { value: '1px' } } } } } } }

    expect(css({ padding: '0' }, themed)).toContain('padding: var(--spacing-0);')

    // Declared as an extension of the theme's variants, which the config merge once dropped.
    const extended: Config = {
      theme: { extend: { variants: { roomy: { tokens: { spacing: { 0: { value: '1px' } } } } } } },
    }
    expect(css({ padding: '0' }, extended)).toContain('padding: var(--spacing-0);')
  })

  test('where the value is written as a reference', () => {
    expect(css({ padding: 'token(spacing.0)' })).toContain('padding: var(--spacing-0);')
  })
})
