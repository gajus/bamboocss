import { bench, describe } from 'vitest'
import { generateCx } from '../../generator/src/artifacts/js/cx'
import { createFoldFixture } from './fixture'

/**
 * A recipe call whose selection the build cannot see, on the path it runs every render: folded by
 * the compiler into a `cvaMap` lookup and run against the `cvaMap` the build emits, so what is
 * measured is what ships, the table and the lookup both.
 *
 * The control answers the same selections from a nested object, as a map written by hand would,
 * which nothing the compiler or the lookup does can move. The selections cycle through every state
 * a variant can be in (declared, omitted, `null` and unknown), so no single edge of the table is
 * all that gets measured. `.root` is the table that leaves a decision out: `tone` styles only
 * the icon, so its root node decides `size`.
 */
const SOURCE = `import { cva, sva } from 'styled-system/css'
const badge = cva({
  base: { display: 'inline-flex' },
  variants: {
    tone: { quiet: { color: 'gray.500' }, loud: { color: 'red.500' }, muted: { color: 'gray.300' } },
    size: { sm: { fontSize: 'sm' }, md: { fontSize: 'md' }, lg: { fontSize: 'lg' } },
  },
  compoundVariants: [{ tone: 'loud', size: 'lg', css: { fontWeight: 'bold' } }],
  defaultVariants: { tone: 'quiet', size: 'md' },
})
const field = sva({
  slots: ['root', 'icon'],
  base: { root: { display: 'flex' }, icon: { color: 'gray.500' } },
  variants: {
    tone: { quiet: { icon: { color: 'gray.300' } }, loud: { icon: { color: 'red.500' } }, muted: {} },
    size: { sm: { root: { padding: '2' } }, md: {}, lg: { root: { padding: '4' } } },
  },
  defaultVariants: { tone: 'loud', size: 'lg' },
})
export const className = (tone, size) => badge({ tone, size })
export const root = (tone, size) => field({ tone, size }).root
export const slots = (tone, size) => field({ tone, size })
`

const fixture = createFoldFixture()
const { code } = fixture.foldStrict(SOURCE)
const { js } = generateCx(fixture.ctx as never)
const helpers = new Function(
  js.replace(/^import[^\n]*\n/m, '').replace(/export\s*\{[^}]*\}/, 'return { cx, cvaMap }'),
)()
const compiled = new Function(
  'cx',
  'cvaMap',
  `${code.replace(/^import .*$/gm, '').replaceAll('export const ', 'const ')}\nreturn { className, root, slots }`,
)(helpers.cx, helpers.cvaMap) as Record<'className' | 'root', (tone: unknown, size: unknown) => string> & {
  slots: (tone: unknown, size: unknown) => Record<string, string>
}

const TONES = ['quiet', 'loud', 'muted', undefined, null, 'unknown']
const SIZES = ['sm', 'md', 'lg', undefined, null, 'unknown']
const CALLS = 1000
const tones = Array.from({ length: CALLS }, (_, i) => TONES[i % TONES.length])
// Every tone beside every size: the size moves on once each tone has been through.
const sizes = Array.from({ length: CALLS }, (_, i) => SIZES[Math.floor(i / TONES.length) % SIZES.length])

/** The control: the same kind of answer, read off a nested object. */
const table: Record<string, Record<string, string>> = Object.fromEntries(
  TONES.filter((tone): tone is string => typeof tone === 'string').map((tone) => [
    tone,
    Object.fromEntries(
      SIZES.filter((size): size is string => typeof size === 'string').map((size) => [size, `${tone} ${size}`]),
    ),
  ]),
)
const lookup = (tone: unknown, size: unknown) => table[String(tone)]?.[String(size)] ?? 'miss'

const options = { time: 1000, warmupIterations: 20 }
let sink = 0

describe(`compiled recipe lookup x${CALLS}`, () => {
  bench(
    'control: a nested object lookup',
    () => {
      for (let i = 0; i < CALLS; i++) sink += lookup(tones[i], sizes[i]).length
    },
    options,
  )

  bench(
    'badge({ tone, size })',
    () => {
      for (let i = 0; i < CALLS; i++) sink += compiled.className(tones[i], sizes[i]).length
    },
    options,
  )

  bench(
    'field({ tone, size }).root, a decision left out',
    () => {
      for (let i = 0; i < CALLS; i++) sink += compiled.root(tones[i], sizes[i]).length
    },
    options,
  )

  bench(
    'field({ tone, size }), the slot object',
    () => {
      for (let i = 0; i < CALLS; i++) sink += compiled.slots(tones[i], sizes[i]).root.length
    },
    options,
  )
})

if (sink < 0) console.log(sink)
