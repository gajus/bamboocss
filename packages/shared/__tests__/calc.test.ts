import { describe, expect, test } from 'vitest'
import { calc } from '../src/calc'

describe('calc.negate', () => {
  test('flips the sign of a literal', () => {
    expect(calc.negate('4px')).toBe('-4px')
    expect(calc.negate('-4px')).toBe('4px')
  })

  test('multiplies a reference by -1, unwrapping a nested calc', () => {
    expect(calc.negate('var(--spacing-4)')).toBe('calc(var(--spacing-4) * -1)')
    expect(calc.negate('calc(1px + 2px)')).toBe('calc((1px + 2px) * -1)')
  })

  // Negative spacing tokens are built from this, and a prefix is part of every variable name, so
  // `prefix: 'calcite'` turned each one into a reference to a variable that is never declared.
  test('leaves "calc" inside a variable name alone', () => {
    expect(calc.negate('var(--calcite-spacing-4)')).toBe('calc(var(--calcite-spacing-4) * -1)')
    expect(calc.negate({ ref: 'var(--spacing-calculated)' })).toBe('calc(var(--spacing-calculated) * -1)')
  })
})
