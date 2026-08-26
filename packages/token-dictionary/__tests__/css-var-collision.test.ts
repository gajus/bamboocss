import { describe, expect, test } from 'vitest'
import { TokenDictionary } from '../src/dictionary'

/**
 * Under `hash.cssVar` a custom property's name is a 32-bit hash of the token path, so distinct
 * tokens can land on the same property. Only one definition then survives in `:root`, and every
 * token that lost silently takes the winner's value:
 *
 *   :root { --kQArEY: 222px }        // spacing.t125265 won
 *   .crrYtT { width: var(--kQArEY) } // sizes.t36050 was declared 111px, renders 222px
 *
 * Worse than the same accident on a class name — that one affects the elements carrying it,
 * while this follows the token to every reference in the build.
 *
 * The pair below is a real collision under the shipped hash, found by search. It is the
 * fixture, so a change to `toHash` that separated them would make the rest of this file
 * vacuous; `guards the pair it was built from` is here to fail loudly if that happens.
 */
const LEFT = 'sizes-t36050'
const RIGHT = 'spacing-t125265'
const SHARED = '--kQArEY'

describe('hashed css variables', () => {
  test('guards the pair it was built from — these still collide under the shipped hash', () => {
    const dictionary = new TokenDictionary({ tokens: {} })

    expect(dictionary.formatCssVar(LEFT.split('-'), { hash: true }).var).toBe(SHARED)
  })

  test('refuses to give one custom property to two token paths', () => {
    const dictionary = new TokenDictionary({ tokens: {} })
    dictionary.formatCssVar(LEFT.split('-'), { hash: true })

    expect(() => dictionary.formatCssVar(RIGHT.split('-'), { hash: true })).toThrowError(
      /hash to the same css variable/,
    )
  })

  test('names both tokens, not just the property they share', () => {
    const dictionary = new TokenDictionary({ tokens: {} })
    dictionary.formatCssVar(LEFT.split('-'), { hash: true })

    try {
      dictionary.formatCssVar(RIGHT.split('-'), { hash: true })
      throw new Error('expected a collision')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('sizes.t36050')
      expect(message).toContain('spacing.t125265')
      expect(message).toContain(SHARED)
    }
  })

  /**
   * A reference resolves through the same method with the same path as the definition, so it
   * reclaims its own name. Treating that as a collision would reject every token that is used.
   */
  test('the same token path resolved repeatedly is not a collision', () => {
    const dictionary = new TokenDictionary({ tokens: {} })

    expect(() => {
      dictionary.formatCssVar(LEFT.split('-'), { hash: true })
      dictionary.formatCssVar(LEFT.split('-'), { hash: true })
      dictionary.formatCssVar(LEFT.split('-'), { hash: true })
    }).not.toThrow()
  })

  /** Readable names carry the path, so they cannot collide without being the same token. */
  test('unhashed variables are unaffected', () => {
    const dictionary = new TokenDictionary({ tokens: {} })

    expect(() => {
      dictionary.formatCssVar(LEFT.split('-'), {})
      dictionary.formatCssVar(RIGHT.split('-'), {})
    }).not.toThrow()
  })

  /**
   * `prefix` is applied *after* hashing — `['-', prefix, toHash(path)]` — so both names carry it
   * and both still collide. Worth pinning: it is the first thing anyone reaches for on reading
   * the error, and the hint says so explicitly because of this test.
   */
  test('a prefix does not resolve a collision', () => {
    const dictionary = new TokenDictionary({ tokens: {} })

    expect(dictionary.formatCssVar(LEFT.split('-'), { hash: true, prefix: 'bb' }).var).toBe('--bb-kQArEY')
    expect(() => dictionary.formatCssVar(RIGHT.split('-'), { hash: true, prefix: 'bb' })).toThrowError(
      /hash to the same css variable/,
    )
  })
})
