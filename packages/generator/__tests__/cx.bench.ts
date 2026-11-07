import { createGeneratorContext } from '@bamboocss/fixture'
import type { Config } from '@bamboocss/types'
import { bench, describe } from 'vitest'
import { generateCx } from '../src/artifacts/js/cx'

/**
 * The runtime `cx`, on the shape the compiler leaves running per render: a component's own
 * compiled classes joined with the `className` it was handed. Evaluated from the emitted artifact,
 * so what is measured is what ships.
 *
 * A plain join is the control — what `cx` did before it merged, and what `clsx` does — and the
 * merge has to stay near it. Three shapes: no class passed, which both answer on the fast path;
 * the same pair render after render, which `cx` answers from its cache; and a new pair every call,
 * the first render's worst case, which merges each one.
 */
const compile = (config: Config) => {
  const { js } = generateCx(createGeneratorContext(config))
  const body = js.replace(/^import[^\n]*\n/m, '').replace(/export\s*\{[^}]*\}/, 'return { cx }')
  return (new Function(body)() as { cx: (...args: unknown[]) => string }).cx
}

/** The control: `cx`'s two-argument path from before it merged, a join. */
const joining = (a: string, b: string | undefined) => (b ? (a ? a + ' ' + b : b) : a)
const merging = compile({})

const CALLS = 1000
const own = '_wwwwww:AAAA _cccccc:BBBB _pppppp:CCCC _dddddd:DDDD _mmmmmm:EEEE _ffffff:FFFF'
const passed = '_wwwwww:GGGG _zzzzzz:HHHH'
// More than the 4,096 joins `cx` keeps, so each comes round again only after it was dropped.
const DISTINCT = 5000
const distinct = Array.from({ length: DISTINCT }, (_, i) => `_wwwwww:${String(i).padStart(4, '0')} _zzzzzz:HHHH`)
let offset = 0
const options = { time: 1000, warmupIterations: 20 }
let sink = 0

describe(`cx(own, className) x${CALLS}`, () => {
  bench(
    'joining, no class passed',
    () => {
      for (let i = 0; i < CALLS; i++) sink += joining(own, undefined).length
    },
    options,
  )

  bench(
    'merging, no class passed',
    () => {
      for (let i = 0; i < CALLS; i++) sink += merging(own, undefined).length
    },
    options,
  )

  bench(
    'joining, the same class passed',
    () => {
      for (let i = 0; i < CALLS; i++) sink += joining(own, passed).length
    },
    options,
  )

  bench(
    'merging, the same class passed',
    () => {
      for (let i = 0; i < CALLS; i++) sink += merging(own, passed).length
    },
    options,
  )

  // Every call a cache miss: the cost of merging, which a page pays once per join it has not asked
  // for before — every join on its first render.
  bench(
    'merging, every join new',
    () => {
      for (let i = 0; i < CALLS; i++) sink += merging(own, distinct[(offset + i) % DISTINCT]).length
      offset += CALLS
    },
    options,
  )
})

if (sink < 0) console.log(sink)
