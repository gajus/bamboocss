import { createContext } from '@bamboocss/fixture'
import { bench, describe } from 'vitest'

/**
 * What extraction pays to encode a file's `css()` calls.
 *
 * Every extracted call reaches the encoder as `processAtomic` under `withMixinAtoms`: its
 * declarations hashed, and, when the call applies a mixin, the written-out form hashed beside
 * them. `hash only` is the control, the hashing alone, which nothing about mixins can touch.
 *
 * Each iteration encodes into a fresh encoder, as a file is read into its own scope: reusing one
 * across iterations leaves every call unowned, which pins each hash again and times that instead.
 */
const { encoder } = createContext({
  theme: { extend: { mixins: { card: { value: { color: 'red.300', padding: '4', _hover: { color: 'blue.500' } } } } } },
})

// `css()` arguments of the shapes a component file writes.
const styles = Array.from({ length: 200 }, (_, i) => ({
  display: 'flex',
  alignItems: 'center',
  gap: String(i % 8),
  paddingX: String((i % 5) + 1),
  color: i % 2 ? 'red.300' : 'blue.500',
  fontSize: i % 3 ? 'sm' : 'lg',
  _hover: { color: 'gray.700', bg: i % 4 ? 'gray.100' : 'white' },
  md: { gap: String((i % 6) + 2), flexDirection: i % 2 ? 'row' : 'column' },
}))
const someApplyingAMixin = styles.map((style, i) => (i % 4 ? style : { ...style, mixin: 'card' }))

describe('encoding extracted css() calls', () => {
  bench(
    'hash only (control)',
    () => {
      const fresh = encoder.clone()
      const set = new Set<string>()
      for (const style of styles) fresh.hashStyleObject(set, style)
    },
    { iterations: 200, warmupIterations: 50 },
  )

  bench(
    'processAtomic, as extraction calls it',
    () => {
      const fresh = encoder.clone()
      fresh.withMixinAtoms(() => {
        for (const style of styles) fresh.processAtomic(style)
      })
    },
    { iterations: 200, warmupIterations: 50 },
  )

  bench(
    'processAtomic, a quarter of the calls applying a mixin',
    () => {
      const fresh = encoder.clone()
      fresh.withMixinAtoms(() => {
        for (const style of someApplyingAMixin) fresh.processAtomic(style)
      })
    },
    { iterations: 200, warmupIterations: 50 },
  )
})
