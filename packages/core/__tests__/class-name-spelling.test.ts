import { createRuleProcessor, withoutMergeCodes } from '@bamboocss/fixture'
import { esc } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'

/**
 * A class name spells a space `_`, so a literal underscore has to be spelled some other way, or
 * two declarations share a class. `fontFamily: 'My Font'` and `'My_Font'` were both `ff_My_Font`:
 * one rule carrying both declarations, the later winning on every element that asked for either.
 * Hashing did not help, since a hashed name is a hash of the readable one.
 */
/** Each style's class, as the selector spells it. */
const emit = (config: object, ...styles: object[]) => {
  const processor = createRuleProcessor(config as never)
  const selectors = styles.map((style) =>
    processor
      .css(style as never)
      .getClassNames()
      .map(withoutMergeCodes),
  )
  return { selectors: selectors.flat(), css: withoutMergeCodes(processor.toCss()) }
}

/** The declarations of the rule written under a class, given as the selector spells it. */
const ruleOf = (css: string, selector: string) => {
  const pattern = `.${selector}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${pattern}[^{]*\\{([^}]*)\\}`))?.[1]?.trim()
}

describe('a literal underscore in a class name', () => {
  test('names a value apart from the same value with a space', () => {
    const { selectors, css } = emit({}, { fontFamily: 'My Font' }, { fontFamily: 'My_Font' })

    expect(selectors).toEqual([esc('ff_My_Font'), esc('ff_My\\_Font')])
    expect(ruleOf(css, selectors[0]!)).toBe('font-family: My Font;')
    expect(ruleOf(css, selectors[1]!)).toBe('font-family: My_Font;')
  })

  test('hashes them apart too', () => {
    const { selectors, css } = emit({ hash: true }, { fontFamily: 'My Font' }, { fontFamily: 'My_Font' })

    expect(new Set(selectors).size).toBe(2)
    expect(ruleOf(css, selectors[0]!)).toBe('font-family: My Font;')
    expect(ruleOf(css, selectors[1]!)).toBe('font-family: My_Font;')
  })

  /** `.a_b &` is an element inside `.a_b`; `.a b &` one inside a `b` inside `.a`. */
  test('names a selector condition apart from the same selector with a space', () => {
    const { selectors } = emit({}, { '.a_b &': { color: 'red' } }, { '.a b &': { color: 'red' } })

    expect(selectors).toEqual([esc('[.a\\_b_&]:c_red'), esc('[.a_b_&]:c_red')])
  })
})
