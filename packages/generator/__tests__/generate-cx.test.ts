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
const compile = (): { cx: Cx; cvaMap: CvaMap } => {
  const { js } = generateCx(createGeneratorContext())
  // `splitProps` is re-exported from helpers, so the import is dropped rather than resolved —
  // nothing here exercises it, and the two functions defined in this module are the point.
  const body = js.replace(/^import[^\n]*\n/m, '').replace(/export\s*\{[^}]*\}/, 'return { cx, cvaMap }')
  return new Function(body)() as { cx: Cx; cvaMap: CvaMap }
}

const { cx, cvaMap } = compile()

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

describe('generated cx', () => {
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

  /**
   * The contract that replaced merging.
   *
   * `cx` used to drop the earlier of two classes setting the same property, which read as
   * an override resolving. It only ever worked where the class names carried a property to
   * compare, and silently stopped in any build that hashed them — so the same source
   * behaved differently in development and production.
   *
   * Now it keeps both, everywhere, and precedence is the cascade's job. Two `css()` outputs
   * are in the same layer and resolve by source order; a `cva`/`sva` class is in `recipes`
   * and always loses to a consumer's `css()` in `utilities`.
   */
  test('does not resolve conflicts — both classes survive', () => {
    expect(cx('px_4', 'px_2')).toBe('px_4 px_2')
    expect(cx('c_red.300', 'c_blue.500')).toBe('c_red.300 c_blue.500')
  })

  test('a duplicate is not deduplicated either', () => {
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
   * accepts.
   */
  test('the two-argument shortcut agrees with the general path', () => {
    const values = ['', 'px_4', 'a b', 0, 1, -1, Number.NaN, true, false, null, undefined, [], ['x'], ['x', 'y']]
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
 * The reason merging was removed.
 *
 * `hash` is commonly wired to a minification flag — off while developing, on when
 * shipping. A `cx` that resolved conflicts under one and concatenated under another turned
 * an override bug into something that only appeared in production, with nothing raised at
 * build time to say so.
 *
 * One implementation, byte for byte, whatever the config says.
 */
describe('generated cx is identical in every build', () => {
  const configs: Array<[string, Config | undefined]> = [
    ['default', undefined],
    ['hash.className', { hash: true } as Config],
    ['prefix', { prefix: 'bam' } as Config],
    ['separator', { separator: '-' } as Config],
  ]

  const baseline = generateCx(createGeneratorContext())

  test.each(configs)('%s emits the same implementation and declaration', (_label, config) => {
    // Built from each config to prove the emitted artifact does not consult it. The context is
    // needed only to spell the `helpers` import, which no styling option changes.
    const { js, dts } = generateCx(createGeneratorContext(config as Config))
    expect(js).toBe(baseline.js)
    expect(dts).toBe(baseline.dts)
  })

  test('the declaration says it does not merge', () => {
    expect(baseline.dts).toContain('does **not** resolve conflicts')
    expect(baseline.js).not.toContain('mergeKey')
  })
})
