import { createRuleProcessor } from '@bamboocss/fixture'
import type { Dict } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { cascadeOrder } from './cascade-oracle'

/**
 * Of two rules equal in specificity, the one requiring a stronger state is written later and
 * wins while both match: `_active` over `_hover`. These pin which states a selector is read as
 * requiring, through the emitted sheet, with each pair written in both orders: a pair the states
 * decide has the same winner either way, and a pair they leave equal goes to the one written last.
 */
const winnerOf = (...entries: [string, Dict][]) => {
  const processor = createRuleProcessor()
  processor.css(Object.fromEntries(entries))
  return cascadeOrder(processor.toCss()).color!.at(-1)
}

/** The winning selector, with the pair written as given and then reversed. */
const bothOrders = (a: [string, Dict], b: [string, Dict]) => [winnerOf(a, b), winnerOf(b, a)]

describe('the states a rule is ordered by', () => {
  test('a state inside :has() belongs to another element, and does not rank the rule', () => {
    const invalid: [string, Dict] = ['&:has(> input[aria-invalid=true])', { color: 'red' }]
    const focused: [string, Dict] = ['&:has(> input:focus)', { color: 'blue' }]

    const [focusedLast, invalidLast] = bothOrders(invalid, focused)
    expect(focusedLast).toContain('c_blue')
    expect(invalidLast).toContain('c_red')
  })

  test('nor does one in the selector :nth-child() counts by', () => {
    const counted: [string, Dict] = ['&:nth-child(2 of :hover)', { color: 'red' }]
    const first: [string, Dict] = ['&:first-child', { color: 'blue' }]

    const [firstLast, countedLast] = bothOrders(counted, first)
    expect(firstLast).toContain('c_blue')
    expect(countedLast).toContain('c_red')
  })

  test('a selector list ranks as its strongest member', () => {
    // `:active` ranks above `:hover`, so the list does, though its `:focus` ranks below.
    const hover: [string, Dict] = ['_hover', { color: 'red' }]
    const list: [string, Dict] = ['&:is(:focus, :active)', { color: 'blue' }]

    expect(bothOrders(hover, list).map((selector) => selector?.includes('c_blue'))).toEqual([true, true])
    expect(bothOrders(hover, ['&:focus, &:active', { color: 'blue' }])).toEqual([
      expect.stringContaining('c_blue'),
      expect.stringContaining('c_blue'),
    ])
  })

  test(':focus-visible is its own state, ranked above :focus', () => {
    const focus: [string, Dict] = ['_focus', { color: 'red' }]
    const focusVisible: [string, Dict] = ['_focusVisible', { color: 'blue' }]

    expect(bothOrders(focus, focusVisible)).toEqual([
      expect.stringContaining('focusVisible\\:c_blue'),
      expect.stringContaining('focusVisible\\:c_blue'),
    ])
    expect(bothOrders(['_groupFocus', { color: 'red' }], ['_groupFocusVisible', { color: 'blue' }])).toEqual([
      expect.stringContaining('groupFocusVisible\\:c_blue'),
      expect.stringContaining('groupFocusVisible\\:c_blue'),
    ])
  })

  /** Stacks sharing their outer key cannot be one object's keys, so these take one call each. */
  const winnerOfCalls = (first: Dict, second: Dict) => {
    const processor = createRuleProcessor()
    processor.css(first)
    processor.css(second)
    return cascadeOrder(processor.toCss()).color!.at(-1)
  }

  test('a stack ranks by every state it requires, not its first', () => {
    const focused = { _hover: { _focus: { color: 'red' } } }
    const active = { _hover: { _active: { color: 'blue' } } }

    expect(winnerOfCalls(focused, active)).toContain('active\\:c_blue')
    expect(winnerOfCalls(active, focused)).toContain('active\\:c_blue')
  })

  test('in whatever order they are nested, under an at-rule too', () => {
    // Both require dark; of the rest, hover ranks above focus. Compared one position at a
    // time, `_dark` met `_focus` first and the focused stack won.
    for (const [hovered, focused] of [
      [{ _dark: { _hover: { color: 'blue' } } }, { _focus: { _dark: { color: 'red' } } }],
      [{ md: { _dark: { _hover: { color: 'blue' } } } }, { md: { _focus: { _dark: { color: 'red' } } } }],
    ]) {
      expect(winnerOfCalls(hovered!, focused!)).toContain('c_blue')
      expect(winnerOfCalls(focused!, hovered!)).toContain('c_blue')
    }

    // A pseudo-element ends a stack; the states before it still rank it.
    const hoveredBefore = { md: { _hover: { _before: { color: 'blue' } } } }
    const focusedBefore = { md: { _focus: { _before: { color: 'red' } } } }
    expect(winnerOfCalls(hoveredBefore, focusedBefore)).toContain('hover\\:before\\:c_blue')
    expect(winnerOfCalls(focusedBefore, hoveredBefore)).toContain('hover\\:before\\:c_blue')
  })

  test('a state is read by name, not found in the text', () => {
    // An escaped colon is part of a class name, and an attribute value is a string.
    for (const ranked of ['.a\\:hover &', '&[data-x=":hover"]']) {
      const [rankedFirst, rankedLast] = bothOrders([ranked, { color: 'red' }], ['&[data-y]', { color: 'blue' }])
      expect(rankedFirst, ranked).toContain('c_blue')
      expect(rankedLast, ranked).toContain('c_red')
    }
  })
})
