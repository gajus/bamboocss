import { createRuleProcessor } from '@bamboocss/fixture'
import { esc } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'

/**
 * A hashed class name is a hash rendered into letters, so two unrelated declarations can land on
 * the same class name. Nothing used to notice. The sheet emitted two rules under one selector:
 *
 *   .bRzHLW { transition: 192009px }
 *   .bRzHLW { width: 114360px }
 *
 * and both `css()` calls compiled to that same literal, so every element carrying it received a
 * declaration its source never mentions. Silent, exit code 0, and undiagnosable from the
 * symptom.
 *
 * A hashed name is now the code for the property and conditions and a colon, followed by 30 bits
 * of the value, so two names can only collide within one property, as these two widths do. The
 * pair is a real collision under the shipped hash, found by search — it is the fixture, so a
 * change to the hash that moved it would make these tests vacuous rather than failing.
 * `guards the pair it was built from` exists to catch exactly that.
 */
const LEFT = { width: '55317px' } as const
const RIGHT = { width: '57021px' } as const
const SHARED = '_RO16FJ:IY-yQ'

const hashed = () => createRuleProcessor({ hash: { className: true } })

describe('hashed class names', () => {
  test('guards the pair it was built from — these still collide under the shipped hash', () => {
    // Each on its own is fine; the fixture is only meaningful while they share a name.
    expect(hashed().css(LEFT).toCss()).toContain(`.${esc(SHARED)} {`)
    expect(hashed().css(RIGHT).toCss()).toContain(`.${esc(SHARED)} {`)
  })

  test('refuses to give one name to two declarations', () => {
    const processor = hashed()
    processor.css(LEFT)

    expect(() => processor.css(RIGHT)).toThrowError(/hash to the same class name/)
  })

  test('says which two declarations collided, not just the name they share', () => {
    const processor = hashed()
    processor.css(LEFT)

    try {
      processor.css(RIGHT)
      throw new Error('expected a collision')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('55317px')
      expect(message).toContain('57021px')
      expect(message).toContain(SHARED)
    }
  })

  test('the same declaration reached twice is not a collision', () => {
    const processor = hashed()

    expect(() => {
      processor.css(LEFT)
      processor.css(LEFT)
      processor.css(LEFT)
    }).not.toThrow()
  })

  /**
   * Readable names carry the declaration that produced them, so they cannot collide without
   * being equal. The check must not fire there, or it would reject styles that are simply
   * repeated.
   */
  test('readable names are unaffected', () => {
    const processor = createRuleProcessor()

    expect(() => {
      processor.css(LEFT)
      processor.css(RIGHT)
      processor.css(LEFT)
    }).not.toThrow()
  })
})
