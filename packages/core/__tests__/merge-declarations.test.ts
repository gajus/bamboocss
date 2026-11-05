import { createGeneratorContext, createRuleProcessor } from '@bamboocss/fixture'
import { mergeDeclarations, mergeProps, setDeclarations } from '@bamboocss/shared'
import type { Dict } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { stringify } from '../src/stringify'

describe('mergeDeclarations', () => {
  test('a later value replaces an earlier one unless the earlier is important and the later is not', () => {
    expect(mergeDeclarations({ color: 'red !important' }, { color: 'blue' })).toEqual({ color: 'red !important' })
    expect(mergeDeclarations({ color: 'red!' }, { color: 'blue' })).toEqual({ color: 'red!' })
    expect(mergeDeclarations({ color: 'red!' }, { color: 'blue!' })).toEqual({ color: 'blue!' })
    expect(mergeDeclarations({ color: 'red' }, { color: 'blue !important' })).toEqual({ color: 'blue !important' })
    expect(mergeDeclarations({ color: 'red' }, { color: 'blue' })).toEqual({ color: 'blue' })
  })

  test('at any depth', () => {
    expect(
      mergeDeclarations({ _hover: { color: 'red!', bg: 'white' } }, { _hover: { color: 'blue', bg: 'black' } }),
    ).toEqual({ _hover: { color: 'red!', bg: 'black' } })
  })

  test('an important value against a later one under conditions stays as their base', () => {
    expect(mergeDeclarations({ color: 'red!' }, { color: { _hover: 'blue' } })).toEqual({
      color: { base: 'red!', _hover: 'blue' },
    })
    expect(mergeDeclarations({ color: 'red!' }, { color: { base: 'green!', _hover: 'blue' } })).toEqual({
      color: { base: 'green!', _hover: 'blue' },
    })
  })

  test('what is important under conditions survives a later value, and nothing else does', () => {
    expect(mergeDeclarations({ color: { base: 'red!', _hover: 'green' } }, { color: 'blue' })).toEqual({
      color: 'red!',
    })
    expect(mergeDeclarations({ color: { base: 'red', _hover: 'green!' } }, { color: 'blue' })).toEqual({
      color: { _hover: 'green!', base: 'blue' },
    })
  })

  test('is mergeProps where nothing is important', () => {
    const cases: Dict[][] = [
      [{ color: 'red', p: '2' }, { color: 'blue' }],
      [{ color: 'red' }, { color: { _hover: 'blue' } }],
      [{ color: { base: 'red', _hover: 'green' } }, { color: 'blue' }],
      [{ _hover: { color: 'red' } }, { _hover: { bg: 'blue' } }, { _hover: { color: 'green' } }],
      [{ margin: 0 }, { margin: 4 }],
    ]
    for (const sources of cases) expect(mergeDeclarations(...sources)).toEqual(mergeProps(...sources))
  })

  test('neither changes its arguments nor shares what it was given at a path', () => {
    const first = { _hover: { color: 'red!' } }
    const second = { _hover: { color: 'blue' } }
    const merged = mergeDeclarations(first, second)
    expect(first).toEqual({ _hover: { color: 'red!' } })
    expect(second).toEqual({ _hover: { color: 'blue' } })

    const styles = { color: 'red' }
    const target = setDeclarations({}, ['.a'], styles)
    expect(target['.a']).not.toBe(styles)
    expect(merged).toEqual({ _hover: { color: 'red!' } })
  })
})

const config = {
  utilities: {
    extend: {
      stack: {
        className: 'stack',
        values: { type: 'boolean' },
        transform: (value: unknown) => (value === true || value === 'true' ? { display: 'flex' } : {}),
      },
    },
  },
  theme: { extend: { mixins: { body: { value: { color: 'red', letterSpacing: '0.1em' } } } } },
} as const

/** The rules `global.css` writes, without the registrations every sheet carries beside them. */
const globalCss = (css: Dict) =>
  stringify(
    createGeneratorContext(config as never)
      .createSheet()
      .serialize(css),
  )

describe('one rule’s declarations keep an earlier important one against a later one that is not', () => {
  test('in global.css, against a utility writing the same property', () => {
    expect(globalCss({ 'p.x': { display: 'block !important', stack: true } })).toMatchInlineSnapshot(`
      "p.x {display: block !important;
      }
      "
    `)
  })

  test('in global.css, against a mixin', () => {
    expect(globalCss({ 'p.x': { color: 'blue !important', mixin: 'body' } })).toMatchInlineSnapshot(`
      "p.x {color: blue !important;
      letter-spacing: 0.1em;
      }
      "
    `)
  })

  test('in one style object, against its own longhand', () => {
    const css = createRuleProcessor().css({ bg: 'red!', background: 'blue' }).toCss()

    expect(css).toContain('background: red !important')
    expect(css).not.toContain('blue')
  })

  test('and still give way to a later important one', () => {
    expect(globalCss({ 'p.x': { stack: 'true !important', display: 'block !important' } })).toContain(
      'display: block !important',
    )
  })

  test('in a recipe written to its own layer', () => {
    const processor = createRuleProcessor({
      ...config,
      theme: {
        extend: {
          ...config.theme.extend,
          recipes: { layout: { className: 'layout', base: { display: 'block !important', stack: true } } },
        },
      },
    } as never)
    processor.recipe('layout', {})
    expect(processor.toCss()).toContain('display: block !important;')
    expect(processor.toCss()).not.toContain('display: flex')
  })
})
