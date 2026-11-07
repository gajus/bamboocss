import { createGeneratorContext } from '@bamboocss/fixture'
import type { Config } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { generateCx } from '../src/artifacts/js/cx'

type Cx = (...args: unknown[]) => string
type CvaMap = (
  values: unknown[],
  nodes: Array<[unknown, unknown, unknown[]]>,
  leaves: unknown[],
  root: number,
) => unknown

/**
 * Evaluate the emitted artifact rather than a copy of it. These ship to the browser as this
 * exact string, and a test that reimplemented them would be free to drift from them.
 */
const compile = (config?: Config): { cx: Cx; cvaMap: CvaMap } => {
  const { js } = generateCx(createGeneratorContext(config))
  // `splitProps` is re-exported from helpers, so the import is dropped rather than resolved —
  // nothing here exercises it, and the two functions defined in this module are the point.
  const body = js.replace(/^import[^\n]*\n/m, '').replace(/export\s*\{[^}]*\}/, 'return { cx, cvaMap }')
  return new Function(body)() as { cx: Cx; cvaMap: CvaMap }
}

const { cvaMap } = compile()

describe('generated cvaMap', () => {
  // root 1 -> tone, then node 0 -> size. A miss and null take edge 0;
  // undefined takes edge 1, preserving a distinct default state.
  const nodes: Array<[unknown, unknown, unknown[]]> = [
    [~0, ~1, ['sm', ~2, '__proto__', ~3]],
    [~4, 0, ['quiet', ~5]],
  ]
  const leaves = ['miss-size', 'default-size', 'small', 'proto', 'miss-tone', 'quiet-tone']

  test('walks declared, absent, and missing states without prototype lookups', () => {
    expect(cvaMap(['quiet', 'sm'], nodes, leaves, 1)).toBe('quiet-tone')
    expect(cvaMap([undefined, 'sm'], nodes, leaves, 1)).toBe('small')
    expect(cvaMap([undefined, undefined], nodes, leaves, 1)).toBe('default-size')
    expect(cvaMap([undefined, '__proto__'], nodes, leaves, 1)).toBe('proto')
    expect(cvaMap([undefined, 'unknown'], nodes, leaves, 1)).toBe('miss-size')
    expect(cvaMap([undefined, null], nodes, leaves, 1)).toBe('miss-size')
  })

  test('can return a whole slot object from one selector evaluation', () => {
    const slots = { root: 'd_flex', label: 'c_gray' }
    expect(cvaMap(['quiet'], [[~0, ~0, ['quiet', ~1]]], ['', slots], 0)).toEqual(slots)
  })
})

/**
 * What `cx` does with classes Bamboo did not name — every class here is one, as no name below has
 * the merge code a utility atom starts with: join them, as written.
 */
describe('generated cx', () => {
  const { cx } = compile()

  test('joins its arguments', () => {
    expect(cx('px_4', 'c_red.300')).toBe('px_4 c_red.300')
  })

  test('skips falsy parts and flattens arrays', () => {
    expect(cx('a', false, undefined, null, ['b', ['c']], 0)).toBe('a b c')
  })

  test('returns a lone class string untouched', () => {
    expect(cx('px_4')).toBe('px_4')
    expect(cx()).toBe('')
  })

  test('a duplicate is not deduplicated', () => {
    expect(cx('px_4', 'px_4')).toBe('px_4 px_4')
  })

  test('leaves classes bamboo did not generate alone', () => {
    expect(cx('my-button', 'px_4', 'my-button')).toBe('my-button px_4 my-button')
  })

  /**
   * `cx` answers the two-argument case — `cx(<compiled literal>, className)`, the shape the
   * transform leaves at a wrapper that forwards a className — without allocating a rest array
   * or entering the loop. That is a second implementation of the join, reachable only for
   * `arguments.length === 2`, and nothing above would notice it drifting: every assertion in
   * this file that passes two arguments passes two plain non-empty strings.
   *
   * So compare the two paths directly. A third argument of `undefined` is not the same call as
   * two arguments, but it *is* the same answer, and it routes through the general loop — which
   * makes it the reference the shortcut has to agree with, across the whole value grid `cx`
   * accepts. The atom names are there for the merge, which parses on one path only.
   */
  test('the two-argument shortcut agrees with the general path', () => {
    const values = [
      '',
      'px_4',
      'a b',
      '_wwwwww:AAAA',
      '_wwwwww:BBBB c',
      0,
      1,
      -1,
      Number.NaN,
      true,
      false,
      null,
      undefined,
      [],
      ['x'],
      ['x', 'y'],
    ]
    const disagreements: string[] = []

    for (const first of values) {
      for (const second of values) {
        const shortcut = cx(first, second)
        const general = cx(first, second, undefined)
        if (shortcut !== general) {
          disagreements.push(
            `cx(${JSON.stringify(first)}, ${JSON.stringify(second)}): ${JSON.stringify(shortcut)} vs ${JSON.stringify(general)}`,
          )
        }
      }
    }

    expect(disagreements).toEqual([])
  })

  test('the shortcut still joins, drops the empty side, and ignores a non-string tail', () => {
    expect(cx('px_4', 'c_red.300')).toBe('px_4 c_red.300')
    expect(cx('', 'c_red.300')).toBe('c_red.300')
    expect(cx('px_4', '')).toBe('px_4')
    // `cond && cls` with a false condition, and a className that was never passed.
    expect(cx('px_4', false)).toBe('px_4')
    expect(cx('px_4', undefined)).toBe('px_4')
    // `true` is truthy but carries no class — the loop maps it to '', and so must the shortcut.
    expect(cx('px_4', true)).toBe('px_4')
  })
})

/**
 * The reason merging was once removed, and what keeps it from coming back.
 *
 * `hash` is commonly wired to a minification flag — off while developing, on when shipping. A
 * `cx` that resolved conflicts under one and concatenated under another turned an override bug
 * into something that only appeared in production, with nothing raised at build time to say so.
 *
 * So one implementation, byte for byte, whatever `hash` or `separator` say: `cx` reads a readable
 * and a hashed name alike. The `prefix` is the one input it holds, since every class a build names
 * starts with it, and it changes nothing else.
 */
describe('generated cx is identical in every build', () => {
  const configs: Array<[string, Config | undefined]> = [
    ['default', undefined],
    ['hash.className', { hash: true } as Config],
    ['separator', { separator: '-' } as Config],
  ]

  const baseline = generateCx(createGeneratorContext())

  test.each(configs)('%s emits the same implementation and declaration', (_label, config) => {
    const { js, dts } = generateCx(createGeneratorContext(config as Config))
    expect(js).toBe(baseline.js)
    expect(dts).toBe(baseline.dts)
  })

  test('a prefix changes only the prefix the merge looks past', () => {
    const { js, dts } = generateCx(createGeneratorContext({ prefix: 'bam' } as Config))
    expect(js.replace('const cxPrefix = "bam-"', 'const cxPrefix = ""')).toBe(baseline.js)
    expect(dts).toBe(baseline.dts)
  })

  test('the declaration says it merges', () => {
    expect(baseline.dts).toContain('keeping the last of the classes that set one property')
  })
})

/**
 * The merge: the join, keeping the last class per property and conditions — read off the name,
 * `_`, six characters and `:` — so a class passed in overrides the component's own as `css(a, b)`
 * would. Evaluated from the emitted artifact, as above.
 */
describe('merging cx', () => {
  const compileWith = (config: Record<string, unknown>) => {
    const { js } = generateCx(createGeneratorContext(config as Config))
    const body = js.replace(/^import[^\n]*\n/m, '').replace(/export\s*\{[^}]*\}/, 'return { cx }')
    return (new Function(body)() as { cx: Cx }).cx
  }
  const merging = compileWith({})

  test('keeps the last class of a property under the same conditions, where the first one stood', () => {
    expect(merging('_wwwwww:AAAA _cccccc:BBBB', '_wwwwww:CCCC')).toBe('_wwwwww:CCCC _cccccc:BBBB')
  })

  test('reads a readable name the same way', () => {
    expect(merging('_wwwwww:md:w_[480px] _cccccc:c_red', '_wwwwww:md:w_[640px]')).toBe(
      '_wwwwww:md:w_[640px] _cccccc:c_red',
    )
  })

  test('keeps classes of different properties or conditions side by side', () => {
    expect(merging('_wwwwww:AAAA', '_mdwwww:BBBB')).toBe('_wwwwww:AAAA _mdwwww:BBBB')
  })

  test('lets the later class win whichever of the two is important, as `css(a, b)` does', () => {
    expect(merging('_wwwwww:AAAA!', '_wwwwww:BBBB')).toBe('_wwwwww:BBBB')
    expect(merging('_wwwwww:AAAA', '_wwwwww:BBBB!')).toBe('_wwwwww:BBBB!')
  })

  test('keeps a class it did not name as written, duplicates and all', () => {
    expect(merging('group _wwwwww:AAAA', 'card _wwwwww:BBBB')).toBe('group _wwwwww:BBBB card')
    expect(merging('card', 'card')).toBe('card card')
    expect(merging('_custom', '_custom')).toBe('_custom _custom')
  })

  // An atom is `_`, five characters and a colon, hashed or not. A class written by hand that is
  // as long as a hashed atom and starts with `_` is not one, so two sharing their first six
  // characters both stay: read by length, the first was dropped.
  test('does not read a class written by hand as an atom, whatever its length', () => {
    expect(merging('_card-body', '_card-head')).toBe('_card-body _card-head')
    expect(merging('_card-body!', '_card-head!')).toBe('_card-body! _card-head!')
    expect(merging('_wwwwww:AAAA _card-body', '_card-head')).toBe('_wwwwww:AAAA _card-body _card-head')
  })

  test('merges across every argument, arrays and conditions included', () => {
    expect(merging('_wwwwww:AAAA', false, ['_cccccc:BBBB', ['_wwwwww:CCCC']], undefined, '_cccccc:DDDD')).toBe(
      '_wwwwww:CCCC _cccccc:DDDD',
    )
  })

  test('returns one string as it was given, with nothing to merge it against', () => {
    expect(merging('_wwwwww:AAAA _wwwwww:BBBB')).toBe('_wwwwww:AAAA _wwwwww:BBBB')
    expect(merging('_wwwwww:AAAA', undefined)).toBe('_wwwwww:AAAA')
    expect(merging('', '_wwwwww:AAAA')).toBe('_wwwwww:AAAA')
  })

  test('splits on any whitespace a class attribute splits on', () => {
    expect(merging('_wwwwww:AAAA\n  _cccccc:BBBB', '\t_wwwwww:CCCC ')).toBe('_wwwwww:CCCC _cccccc:BBBB')
  })

  test('reads the prefix every class this build names carries, and nothing without it as an atom', () => {
    const prefixed = compileWith({ prefix: 'bam' })
    expect(prefixed('bam-_wwwwww:AAAA', 'bam-_wwwwww:BBBB')).toBe('bam-_wwwwww:BBBB')
    expect(prefixed('bam-_wwwwww:AAAA', '_wwwwww:BBBB')).toBe('bam-_wwwwww:AAAA _wwwwww:BBBB')
  })

  test('answers a repeated join the same way, and past the cache bound', () => {
    const own = '_wwwwww:AAAA _cccccc:BBBB'
    for (let i = 0; i < 5000; i++) {
      expect(merging(own, `_wwwwww:${String(i).padStart(4, '0')}`)).toBe(
        `_wwwwww:${String(i).padStart(4, '0')} _cccccc:BBBB`,
      )
    }
    expect(merging(own, '_wwwwww:CCCC')).toBe('_wwwwww:CCCC _cccccc:BBBB')
    expect(merging(own, '_wwwwww:CCCC')).toBe('_wwwwww:CCCC _cccccc:BBBB')
  })

  test('declares the merge it does', () => {
    const { dts } = generateCx(createGeneratorContext())
    expect(dts).toContain('keeping the last of the classes that set one property')
    expect(dts).not.toContain('does **not** resolve conflicts')
  })
})
