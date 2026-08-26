import { describe, expect, test } from 'vitest'
import { canonicalValue } from '../src/canonical-value'

/**
 * The pairs this exists for: two spellings that a build used to give two atoms, because the
 * class name came from the authored text while the sheet shipped the optimized text.
 */
describe('canonicalValue folds spellings that denote the same value', () => {
  test('hex colours by case and by length', () => {
    expect(canonicalValue('#FFFFFF')).toBe('#fff')
    expect(canonicalValue('#ffffff')).toBe('#fff')
    expect(canonicalValue('#FFF')).toBe('#fff')
    expect(canonicalValue('#0000001A')).toBe('#0000001a')
  })

  test('a hex whose channels are not repeated pairs keeps its length', () => {
    expect(canonicalValue('#2563eb')).toBe('#2563eb')
    expect(canonicalValue('#123456')).toBe('#123456')
  })

  test('redundant zeros around a decimal point', () => {
    expect(canonicalValue('.15s')).toBe('0.15s')
    expect(canonicalValue('0.15s')).toBe('0.15s')
    expect(canonicalValue('1.50rem')).toBe('1.5rem')
    expect(canonicalValue('1.0')).toBe('1')
    expect(canonicalValue('0.0')).toBe('0')
  })

  test('an integer part that is already there survives', () => {
    expect(canonicalValue('10.5px')).toBe('10.5px')
    expect(canonicalValue('-.5px')).toBe('-0.5px')
    expect(canonicalValue('-0.5px')).toBe('-0.5px')
  })

  test('whitespace runs between tokens', () => {
    expect(canonicalValue('0  16px')).toBe('0 16px')
    expect(canonicalValue('  16px  ')).toBe('16px')
    expect(canonicalValue('background-color\n  .15s')).toBe('background-color 0.15s')
  })

  test('a composite value folds in every position', () => {
    expect(canonicalValue('-2px 5px 12px #FFFFFF')).toBe('-2px 5px 12px #fff')
    expect(canonicalValue('0 0 0 .5px #AABBCC')).toBe('0 0 0 0.5px #abc')
  })
})

/**
 * What it must not touch. Each of these is a spelling the optimizer may fold but this one may
 * not — either because the bytes are not CSS syntax, or because folding it would make the class
 * name depend on which optimizer is installed.
 */
describe('canonicalValue leaves alone what it cannot fold safely', () => {
  test('anything containing a quoted string', () => {
    expect(canonicalValue('"1.50"')).toBe('"1.50"')
    expect(canonicalValue("'  spaced  '")).toBe("'  spaced  '")
    expect(canonicalValue('"Helvetica  Neue", #FFFFFF')).toBe('"Helvetica  Neue", #FFFFFF')
  })

  test('anything containing a url()', () => {
    expect(canonicalValue('url(/a/b-1.0.png)')).toBe('url(/a/b-1.0.png)')
    expect(canonicalValue('url("x.png") no-repeat')).toBe('url("x.png") no-repeat')
  })

  test('a colour written in another notation — that conversion is the optimizer’s', () => {
    expect(canonicalValue('rgba(0, 0, 0, .1)')).toBe('rgba(0, 0, 0, 0.1)')
    expect(canonicalValue('rgb(0 0 0 / 10%)')).toBe('rgb(0 0 0 / 10%)')
  })

  test('a unit is never converted', () => {
    expect(canonicalValue('150ms')).toBe('150ms')
    expect(canonicalValue('1rem')).toBe('1rem')
  })

  test('digits inside an identifier are not quantities', () => {
    expect(canonicalValue('var(--colors-red-300)')).toBe('var(--colors-red-300)')
    expect(canonicalValue('var(--spacing-1.5)')).toBe('var(--spacing-1.5)')
  })

  test('a keyword is not a colour', () => {
    expect(canonicalValue('white')).toBe('white')
    expect(canonicalValue('transparent')).toBe('transparent')
  })
})

/** Folding twice has to be folding once, or the key depends on how often it was applied. */
describe('canonicalValue is idempotent', () => {
  const cases = [
    '#FFFFFF',
    '.15s',
    '-2px 5px 12px #AABBCC',
    'var(--colors-red-300)',
    'url(/a/b-1.0.png)',
    '"Helvetica  Neue"',
    'rgba(0, 0, 0, 0.1)',
    '0  16px',
  ]

  test.each(cases)('%s', (value) => {
    const once = canonicalValue(value)
    expect(canonicalValue(once)).toBe(once)
  })
})
