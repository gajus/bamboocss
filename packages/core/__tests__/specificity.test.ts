import { describe, expect, test } from 'vitest'
import { nestedSpecificity, selectorSpecificity } from '../src/specificity'
import { specificity } from './cascade-oracle'

/**
 * The specificity sublayers are keyed by, against the browser's: each case is checked against
 * the oracle's model as well as the value the selector has, so the two cannot drift apart.
 */
describe('selector specificity', () => {
  test.each([
    ['.a:nth-child(2 of .x.y)', [0, 4, 0]],
    ['.a:nth-last-child(odd of .b, #c)', [1, 2, 0]],
    ['.a:NTH-CHILD( -n + 3 OF li.important )', [0, 3, 1]],
    ['.a:nth-child(2 of .profile)', [0, 3, 0]],
    ['.a:nth-child(2n+1)', [0, 2, 0]],
    ['.a:nth-of-type(2)', [0, 2, 0]],
    ['.x.y', [0, 2, 0]],
    ['.a#b', [1, 1, 0]],
    ['.c_red\\.500', [0, 1, 0]],
    ['.md\\:d_flex', [0, 1, 0]],
  ])('%s', (selector, expected) => {
    expect(selectorSpecificity(selector)).toEqual(expected)
    expect(specificity(selector)).toEqual(expected)
  })

  test('an `&` inside `of S` counts the rule it nests under', () => {
    expect(nestedSpecificity([0, 1, 0], '&:nth-child(2 of &.x)')).toEqual([0, 4, 0])
    expect(specificity('.a:nth-child(2 of .a.x)')).toEqual([0, 4, 0])
  })
})
