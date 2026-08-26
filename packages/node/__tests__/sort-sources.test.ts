import { describe, expect, test } from 'vitest'
import { sortSources } from '../src/node-runtime'

/**
 * The source glob is sorted, because its order reaches the stylesheet.
 *
 * `fast-glob` returns `readdir` order, which differs between filesystems. Files are extracted
 * in that order, atoms enter the sheet in extraction order, and sheet order is what settles a
 * conflict between two classes landing on one element — `cx` concatenates them and the browser
 * picks by position. Unsorted, the same commit could build on two machines into sheets that
 * disagree about which of `px_4` and `px_2` wins, with nothing to say so.
 *
 * It also makes the emitted bytes reproducible, which is what content-hashed asset names are
 * derived from.
 */
describe('sortSources', () => {
  test('orders files deterministically whatever order the filesystem gave them', () => {
    const forward = sortSources(['/a/b.tsx', '/a/a.tsx', '/a/c.tsx'])
    const reversed = sortSources(['/a/c.tsx', '/a/b.tsx', '/a/a.tsx'])

    expect(forward).toEqual(['/a/a.tsx', '/a/b.tsx', '/a/c.tsx'])
    expect(reversed).toEqual(forward)
  })

  test('orders nested paths by their full spelling, so a directory stays contiguous', () => {
    expect(sortSources(['/src/z/a.tsx', '/src/a/z.tsx', '/src/a/a.tsx'])).toEqual([
      '/src/a/a.tsx',
      '/src/a/z.tsx',
      '/src/z/a.tsx',
    ])
  })

  /**
   * By code unit, not by locale. `localeCompare` orders case and accents by the host's locale,
   * so it would reintroduce exactly the machine-dependence this removes — and under some
   * locales `B.tsx` sorts before `a.tsx` rather than after it.
   */
  test('is not locale-sensitive', () => {
    expect(sortSources(['/a/a.tsx', '/a/B.tsx'])).toEqual(['/a/B.tsx', '/a/a.tsx'])
  })

  test('leaves an empty list alone', () => {
    expect(sortSources([])).toEqual([])
  })
})
