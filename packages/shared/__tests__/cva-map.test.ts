import { describe, expect, test } from 'vitest'
import { type CvaLookup, cvaMap, type CvaTable as Table } from '../src/cva-map'

describe('cvaMap', () => {
  // root 1 decides tone, the first value, then node 0 decides size, the second. A miss and null
  // take the miss edge; undefined takes its own, preserving a distinct default state.
  const table: Table = [
    1,
    [
      [1, ~0, ~1, ['sm', ~2, '__proto__', ~3]],
      [0, ~4, 0, ['quiet', ~5]],
    ],
    ['miss-size', 'default-size', 'small', 'proto', 'miss-tone', 'quiet-tone'],
  ]

  test('walks declared, absent, and missing states without prototype lookups', () => {
    expect(cvaMap(['quiet', 'sm'], table)).toBe('quiet-tone')
    expect(cvaMap([undefined, 'sm'], table)).toBe('small')
    expect(cvaMap([undefined, undefined], table)).toBe('default-size')
    expect(cvaMap([undefined, '__proto__'], table)).toBe('proto')
    expect(cvaMap([undefined, 'unknown'], table)).toBe('miss-size')
    expect(cvaMap([undefined, null], table)).toBe('miss-size')
  })

  // `.root` of a recipe whose `tone` styles only its icon: the table leaves `tone` out, and its root
  // decides `size`, the second value. Read by depth, `tone` decided it.
  test('reads the value a node decides, not the one at its depth', () => {
    const sizes: Table = [0, [[1, ~0, ~1, ['sm', ~2]]], ['no-size', 'default-size', 'small']]
    expect(cvaMap(['quiet', 'sm'], sizes)).toBe('small')
    expect(cvaMap(['sm', undefined], sizes)).toBe('default-size')
    expect(cvaMap([undefined, null], sizes)).toBe('no-size')
  })

  // A path decides each value once at most, so a longer one is not a table a build wrote.
  test('stops on a table whose path is longer than its values', () => {
    expect(cvaMap(['sm'], [0, [[0, 0, 0, ['sm', 0]]], ['leaf']])).toBe('')
  })

  // Segments: runs of a recipe's declarations, each a constant or decided by variants of its own.
  test('joins segments in order, leaving out the empty ones', () => {
    const tone: Table = [0, [[0, ~0, ~0, ['quiet', ~1]]], ['', 'c_gray']]
    const size: Table = [0, [[1, ~0, ~1, ['sm', ~2]]], ['', 'p_4', 'p_2']]
    const segments = ['d_flex', tone, size, 'm_1']
    expect(cvaMap(['quiet', 'sm'], segments)).toBe('d_flex c_gray p_2 m_1')
    expect(cvaMap([null, undefined], segments)).toBe('d_flex p_4 m_1')
    expect(cvaMap([null, null], segments)).toBe('d_flex m_1')
  })

  // A table's leaf can be a slot recipe's whole object, which the table holds for every call.
  test('hands each call its own copy of a slot object a table holds', () => {
    const slots: Table = [0, [[0, ~0, ~0, ['quiet', ~1]]], ['', { root: 'd_flex', label: 'c_gray' }]]
    const first = cvaMap(['quiet'], slots) as Record<string, string>
    first.root += ' px_4'
    expect(cvaMap(['quiet'], slots)).toEqual({ root: 'd_flex', label: 'c_gray' })
    expect(cvaMap(['quiet'], slots)).not.toBe(cvaMap(['quiet'], slots))
  })

  // Past a few states, a slot recipe's whole object is a lookup per slot. The table is the module's, read by every
  // call, so the object has to be the call's own: one a caller changes is not what the next returns.
  test('builds a slot object from a lookup per slot, a new one for every call', () => {
    const slots: Record<string, CvaLookup> = {
      root: 'd_flex',
      label: [0, [[0, ~0, ~0, ['quiet', ~1]]], ['', 'c_gray']],
    }
    expect(cvaMap(['quiet'], slots)).toEqual({ root: 'd_flex', label: 'c_gray' })
    expect(cvaMap(['loud'], slots)).toEqual({ root: 'd_flex', label: '' })
    const first = cvaMap(['quiet'], slots) as Record<string, string>
    first.root += ' px_4'
    expect(cvaMap(['quiet'], slots)).toEqual({ root: 'd_flex', label: 'c_gray' })
  })
})
