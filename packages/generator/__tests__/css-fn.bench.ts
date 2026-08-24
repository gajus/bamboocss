import { bench, describe } from 'vitest'
import { buildCss, buildStack, ITERATIONS } from './css-fn-harness'

/**
 * Benchmarks `createCss` from `@bamboocss/shared` (via `css-fn-harness`), the engine the
 * Vite compiler uses. Generated `css()` throws if a call was not folded.
 */
const css = buildCss()
const stack = buildStack()

const stable = { color: 'red', fontSize: '12px', padding: '4px' }
const l1 = { color: 'blue' }
const l2 = { padding: '8px' }

describe('css() runtime', () => {
  bench(`inline css() x${ITERATIONS}`, () => {
    for (let i = 0; i < ITERATIONS; i++) css({ color: 'red', fontSize: '12px', padding: '4px' })
  })

  bench(`stable-identity css() x${ITERATIONS}`, () => {
    for (let i = 0; i < ITERATIONS; i++) css(stable)
  })

  bench(`multi-arg css(a, b) x${ITERATIONS}`, () => {
    for (let i = 0; i < ITERATIONS; i++) css({ color: 'red' }, { padding: '2px' })
  })

  bench(`composed css(a, b, c) x${ITERATIONS}`, () => {
    for (let i = 0; i < ITERATIONS; i++) css(l1, l2, { margin: '2px' })
  })

  bench(`pattern stack() x${ITERATIONS}`, () => {
    for (let i = 0; i < ITERATIONS; i++) stack({ gap: '4px', align: 'center' })
  })
})
