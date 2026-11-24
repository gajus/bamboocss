import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { generateTokenJs } from '../src/artifacts/js/token'
import { generateTokenTypes } from '../src/artifacts/types/token-types'

/**
 * `LiteralToken` is the subset `token.value()` can actually answer.
 *
 * Not every token has a literal. A virtual or conditional one resolves to its `var()` because
 * there is no single value to hand back, and a negative one to `calc(var(--spacing-4) * -1)`
 * because it has no declaration of its own. `token.value()` returns those references — which
 * is truthful, and useless to the caller who asked for a literal precisely because a css
 * variable will not resolve where they are: a canvas fill, a charting library, arithmetic.
 *
 * Narrowing the parameter turns that from a value that silently does the wrong thing into a
 * type error, which is the one guarantee no amount of build-time analysis can give.
 */
const literalTokens = (config?: Parameters<typeof createContext>[0]) => {
  const types = generateTokenTypes(createContext(config))
  const match = types.match(/export type LiteralToken = ([^\n]*)/)

  return new Set((match?.[1] ?? '').split('|').map((entry) => entry.trim().replace(/^"|"$/g, '')))
}

describe('LiteralToken', () => {
  const tokens = literalTokens()

  test('includes a token that resolves to a literal', () => {
    expect(tokens.has('colors.red.300')).toBe(true)
    expect(tokens.has('spacing.4')).toBe(true)
    expect(tokens.has('fontSizes.2xl')).toBe(true)
  })

  test('excludes a negative token, whose value is a calc over another variable', () => {
    expect(tokens.has('spacing.-4')).toBe(false)
  })

  /**
   * A negative token is named `spacing.test.-test` and typed `spacing.-test.test` — the sign
   * sits on the last path segment, but the prop the type is built from carries it on the
   * first. Looking the value up by the type's spelling finds nothing, and a first cut here
   * read "nothing found" as "no variable in it" and offered every negative as a literal.
   */
  test('excludes a negative token whose type spelling differs from its name', () => {
    const nested = literalTokens({
      theme: { tokens: { spacing: { test: { test: { value: '40px' } } } } },
    } as never)

    expect(nested.has('spacing.test.test')).toBe(true)
    expect(nested.has('spacing.-test.test')).toBe(false)
    expect(nested.has('spacing.test.-test')).toBe(false)
  })

  test('excludes a virtual token', () => {
    expect(tokens.has('colors.colorPalette.500')).toBe(false)
  })

  test('excludes a conditional token, which has no single literal', () => {
    const withSemantic = literalTokens({
      theme: {
        extend: {
          semanticTokens: {
            colors: { brand: { value: { base: 'token(colors.red.500)', _dark: 'token(colors.red.400)' } } },
          },
        },
      },
    })

    expect(withSemantic.has('colors.brand')).toBe(false)
    // The control: an ordinary token in the same build still qualifies.
    expect(withSemantic.has('colors.red.500')).toBe(true)
  })

  /**
   * The invariant the feature cannot survive breaking: every `LiteralToken` is a `Token`.
   *
   * `token.value(path: LiteralToken)` is only meaningful if those paths are spellable at all.
   * Two spellings are in play — the type names a token `category.prop`, the dictionary keys on
   * `token.name` — and they coincide for every qualifying token on the default theme, which is
   * why the cases above cannot see the axis. A build that emitted `token.name` passed all of
   * them while producing a union with *nothing* assignable to `Token` under a custom
   * `formatTokenName`.
   *
   * So the check runs against the same `categoryMap` `Token` itself is built from, on configs
   * chosen to make the two spellings disagree.
   */
  test.each([
    ['the default theme', undefined],
    [
      'a nested negative, whose prop carries the sign on a different segment',
      {
        theme: { tokens: { spacing: { test: { test: { value: '40px' } } } } },
      },
    ],
    [
      'a custom formatTokenName, which changes the spelling entirely',
      {
        plugins: [
          {
            name: 'token-names',
            hooks: {
              'tokens:created': ({ configure }: any) =>
                configure({ formatTokenName: (path: string[]) => '$' + path.join('-') }),
            },
          },
        ],
      },
    ],
  ])('every LiteralToken is assignable to Token — %s', (_label, config) => {
    const ctx = createContext(config as never)

    const spellable = new Set<string>()
    for (const [category, props] of ctx.tokens.view.categoryMap.entries()) {
      for (const prop of props.keys()) spellable.add(`${category}.${prop}`)
    }

    const literals = literalTokens(config as never)

    expect(literals.size).toBeGreaterThan(0)
    expect([...literals].filter((name) => !spellable.has(name))).toEqual([])
  })

  /** A value the browser computes is not a literal, whatever case it is written in. */
  test.each([
    ['a variable reference', 'var(--from-host)'],
    ['an uppercase one, since css function names are case-insensitive', 'VAR(--from-host)'],
    ['an environment value', 'env(safe-area-inset-top)'],
  ])('excludes %s', (_label, value) => {
    const tokens = literalTokens({ theme: { extend: { tokens: { sizes: { probe: { value } } } } } } as never)

    expect(tokens.has('sizes.probe')).toBe(false)
    // The control: an ordinary size in the same build still qualifies.
    expect(tokens.has('sizes.4')).toBe(true)
  })
})

/**
 * `NumericToken` is the part of `LiteralToken` whose literal is a number, which `token.value()`
 * returns as one: the runtime's table is JSON, so `zIndex.modal` comes back as 1400, not "1400".
 * Typed `string`, it failed a prop taking a number and let a string method through to a runtime
 * that has none.
 */
describe('NumericToken', () => {
  const numericTokens = (config?: Parameters<typeof createContext>[0]) => {
    const types = generateTokenTypes(createContext(config))
    const match = types.match(/export type NumericToken = ([^\n]*)/)

    return new Set((match?.[1] ?? '').split('|').map((entry) => entry.trim().replace(/^"|"$/g, '')))
  }

  test('includes a token whose value is a number, negative and zero too', () => {
    const tokens = numericTokens()

    expect(tokens.has('zIndex.modal')).toBe(true)
    expect(tokens.has('zIndex.hide')).toBe(true)
    expect(tokens.has('zIndex.base')).toBe(true)
  })

  test('excludes a literal written as a string, however much it reads as a number', () => {
    const tokens = numericTokens()

    expect(tokens.has('fontWeights.bold')).toBe(false)
    expect(tokens.has('colors.red.300')).toBe(false)
  })

  test('excludes a conditional token holding numbers, which has no single literal', () => {
    const config = {
      theme: { extend: { semanticTokens: { zIndex: { layer: { value: { base: 10, _dark: 20 } } } } } },
    } as never

    expect(generateTokenTypes(createContext(config))).toMatch(/export type ZIndexToken = [^\n]*"layer"/)
    expect(numericTokens(config).has('zIndex.layer')).toBe(false)
  })

  test('excludes a number JSON cannot write, which the runtime holds as null', () => {
    const config = { theme: { extend: { tokens: { zIndex: { top: { value: Infinity } } } } } } as never

    expect(literalTokens(config).has('zIndex.top')).toBe(true)
    expect(numericTokens(config).has('zIndex.top')).toBe(false)
    expect(numericTokens(config).has('zIndex.modal')).toBe(true)
  })

  /** What the type says against what the generated runtime returns, for every literal path. */
  test('agrees with the numbers the generated runtime holds', () => {
    const ctx = createContext()
    const generated = JSON.parse(generateTokenJs(ctx).js.match(/const tokens = (\{[\s\S]*?\n\})/)![1]!) as Record<
      string,
      { value: unknown }
    >
    const numeric = numericTokens()

    const disagreeing = [...literalTokens()].filter(
      (path) => numeric.has(path) !== (typeof generated[path]?.value === 'number'),
    )
    expect(numeric.size).toBeGreaterThan(0)
    expect(disagreeing).toEqual([])
  })
})
