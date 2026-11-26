import { describe, expect, test } from 'vitest'
import { type CvaLookup, cvaJoin, cvaMap, type CvaTable as Table } from '../src/cva-map'

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

/**
 * What compiled code calls for segments: it joins a selection's parts once, and hands back that
 * string for it again. `cx()` finds a string it has seen in its cache far faster than one it has to
 * hash whole.
 */
describe('cvaJoin', () => {
  /** A table of one variant at `position`, its leaves read through a counter. */
  const counted = (position: number, values: string[]) => {
    const reads = { count: 0 }
    const leaves = new Proxy(
      values.map((value) => `${position}_${value}`),
      {
        get: (target, key, receiver) => (
          typeof key === 'string' && /^\d+$/.test(key) && reads.count++,
          Reflect.get(target, key, receiver)
        ),
      },
    )
    const entries = values.flatMap((value, index) => [value, ~index])
    const table: Table = [0, [[position, 0, 0, entries]], leaves]
    return { table, reads }
  }

  test('reads no leaf for a selection it has joined before', () => {
    const tone = counted(0, ['quiet', 'loud'])
    const size = counted(1, ['sm', 'lg'])
    const segments = ['d_flex', tone.table, size.table]

    expect(cvaJoin(['loud', 'sm'], segments)).toBe('d_flex 0_loud 1_sm')
    const reads = tone.reads.count + size.reads.count
    expect(reads).toBeGreaterThan(0)
    expect(cvaJoin(['loud', 'sm'], segments)).toBe('d_flex 0_loud 1_sm')
    expect(tone.reads.count + size.reads.count).toBe(reads)
  })

  test('joins what cvaMap joins, for every selection', () => {
    const tone: Table = [0, [[0, ~0, ~0, ['quiet', ~1]]], ['', 'c_gray']]
    const size: Table = [0, [[1, ~0, ~1, ['sm', ~2]]], ['', 'p_4', 'p_2']]
    const segments = ['d_flex', tone, size, 'm_1']
    for (const values of [['quiet', 'sm'], [null, undefined], [null, null], ['loud', 'unknown'], []]) {
      for (let round = 0; round < 2; round++) expect(cvaJoin(values, segments)).toBe(cvaMap(values, segments))
    }
  })

  test('gives every selection the string its parts join to', () => {
    const tones = ['quiet', 'loud', 'muted']
    const sizes = ['sm', 'md']
    const segments = ['d_flex', counted(0, tones).table, counted(1, sizes).table]
    const answers = [...tones, null, undefined, 'unknown']
    const sized = [...sizes, null, undefined, 'unknown']

    for (let round = 0; round < 2; round++) {
      for (const tone of answers) {
        for (const size of sized) {
          const expected = ['d_flex', tones.includes(tone!) && `0_${tone}`, sizes.includes(size!) && `1_${size}`]
          expect(cvaJoin([tone, size], segments), `${tone} ${size}`).toBe(expected.filter(Boolean).join(' '))
        }
      }
    }
  })

  // Fourteen tables of twenty leaves have more selections than a number holds exactly, so two
  // could share one; those segments are joined on every call instead.
  test('joins segments too wide to number on every call, and right', () => {
    const values = Array.from({ length: 20 }, (_, index) => `v${index}`)
    const tables = Array.from({ length: 14 }, (_, position) => counted(position, values))
    const segments = tables.map(({ table }) => table)
    const picks = (offset: number) => tables.map((_, position) => values[(position + offset) % values.length])

    for (const offset of [0, 1, 7]) {
      const expected = picks(offset)
        .map((value, position) => `${position}_${value}`)
        .join(' ')
      expect(cvaJoin(picks(offset), segments)).toBe(expected)
    }
    const reads = tables.reduce((sum, { reads }) => sum + reads.count, 0)
    cvaJoin(picks(0), segments)
    expect(tables.reduce((sum, { reads }) => sum + reads.count, 0)).toBeGreaterThan(reads)
  })
})
