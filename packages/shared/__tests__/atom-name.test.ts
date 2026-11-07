import { describe, expect, test } from 'vitest'
import { ATOM_KEY_LENGTH, ATOM_VALUE_LENGTH, atomKey, atomKeyCode, mergeableAtomName } from '../src/atom-name'

/**
 * The codes a mergeable atom's name is made of. They are written into every such build's CSS and
 * JavaScript, and a library built apart from an app has to arrive at the same ones, so a change to
 * how they are derived renames every class — pinned here so it cannot happen by accident.
 */
describe('mergeable atom names', () => {
  test('pins the code for a property and its conditions', () => {
    expect(atomKeyCode(atomKey([], 'width'))).toMatchInlineSnapshot(`"RO16FJ"`)
    expect(atomKeyCode(atomKey(['md'], 'width'))).toMatchInlineSnapshot(`"AQSe3b"`)
    expect(atomKeyCode(atomKey(['_hover', 'md'], 'color'))).toMatchInlineSnapshot(`"EufV2j"`)
  })

  test('pins a hashed and a readable name', () => {
    const code = atomKeyCode(atomKey(['md'], 'width'))
    expect(mergeableAtomName(code, 'md:w_640px')).toMatchInlineSnapshot(`"_AQSe3b:Fvyhq"`)
    expect(mergeableAtomName(code, 'md:w_640px', 'md:w_640px')).toBe(`_${code}:md:w_640px`)
  })

  // The colon is what `cx` recognizes an atom by, in a hashed name as in a readable one: a class
  // written by hand that happens to start with `_` is not one.
  test('a hashed name is the marker, the key code, a colon and the value code, from a CSS-safe alphabet', () => {
    const name = mergeableAtomName(atomKeyCode(atomKey([], 'width')), 'w_480px')
    expect(name).toHaveLength(1 + ATOM_KEY_LENGTH + 1 + ATOM_VALUE_LENGTH)
    expect(name).toMatch(/^_[\w-]{6}:[\w-]{5}$/)
  })

  test('the key code depends on the conditions and the property, and on nothing else', () => {
    const codes = new Set([
      atomKeyCode(atomKey([], 'width')),
      atomKeyCode(atomKey(['md'], 'width')),
      atomKeyCode(atomKey([], 'height')),
      atomKeyCode(atomKey(['md'], 'height')),
    ])
    expect(codes.size).toBe(4)
    expect(atomKeyCode(atomKey(['md'], 'width'))).toBe(atomKeyCode(atomKey(['md'], 'width')))
  })
})
