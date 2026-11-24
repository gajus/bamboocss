import { describe, expect, test } from 'vitest'
import { generateCx } from '../../generator/src/artifacts/js/cx'
import { compiledRuntime, createFoldFixture } from './fixture'

/**
 * A recipe call whose selection the build cannot see compiles to a `cvaMap` decision table, and it
 * has to select what the same call written with literals selects: for every value a variant can be
 * given — one it declares, none, `null`, one it does not declare — and every combination of them.
 *
 * The table leaves out a decision that changes nothing. `.root` of a recipe whose `tone` styles only
 * its icon never reads `tone`, so the root of that table decides `size`. `cvaMap` read the value
 * at its depth in the table rather than the one the decision was about, so it decided `size` by
 * `tone` and returned the wrong root class for most selections, while `.icon` and the whole slot
 * object, which leave nothing out, were right. Each case below compiles both spellings of every
 * combination and runs them against the `cvaMap` the plugin serves.
 */

/** What a variant can be given, and how a call written with literals spells it: `undefined` leaves the key out. */
interface State {
  value: unknown
  literal?: string
}

const statesOf = (...declared: string[]): State[] => [
  ...declared.map((value) => ({ value, literal: JSON.stringify(value) })),
  { value: undefined },
  { value: null, literal: 'null' },
  { value: 'unknown', literal: JSON.stringify('unknown') },
]

/** Every combination of the axes' states, in the order the axes are given. */
const combinations = (axes: State[][]): State[][] =>
  axes.reduce<State[][]>((product, states) => product.flatMap((row) => states.map((state) => [...row, state])), [[]])

/** `{ tone: 'quiet', size: null }`: the selection a combination writes as literals. */
const literalSelection = (names: string[], row: State[]) => {
  const written = names.flatMap((name, index) => {
    const { literal } = row[index]!
    return literal === undefined ? [] : [`${name}: ${literal}`]
  })
  return `{ ${written.join(', ')} }`
}

/** The selection a combination is as a props object, an omitted variant absent from it. */
const propsOf = (names: string[], row: State[]) =>
  Object.fromEntries(
    names.flatMap((name, index) => (row[index]!.value === undefined ? [] : [[name, row[index]!.value]])),
  )

const describeRow = (names: string[], row: State[]) =>
  names.map((name, index) => `${name}=${row[index]!.literal ?? 'omitted'}`).join(' ')

/**
 * Fold `source` as the strict compiler does and run it against the `cx` this build emits and the
 * `cvaMap` the plugin serves — the shipped text evaluated, not a copy of it.
 */
const compileAndRun = (source: string, exports: string[]) => {
  const fixture = createFoldFixture()
  const result = fixture.foldStrict(source)
  const { js } = generateCx(fixture.ctx as never)
  const helpers = new Function(js.replace(/export\s*\{[^}]*\}/, 'return { cx }'))()
  const code = result.code.replace(/^import .*$/gm, '').replaceAll('export const ', 'const ')
  const module = new Function('cx', 'cvaMap', `${code}\nreturn { ${exports.join(', ')} }`)(
    helpers.cx,
    compiledRuntime.cvaMap,
  )
  return { result, code, module: module as Record<string, any> }
}

describe('a slot read off a dynamic slot recipe call', () => {
  // `tone` styles only the icon and `size` only the root, so `.root` never reads `tone`.
  const names = ['tone', 'size']
  const rows = combinations([statesOf('quiet', 'loud'), statesOf('sm', 'lg')])
  const literals = rows.map((row) => `field(${literalSelection(names, row)})`)
  const source = `import { css, cx, sva } from 'styled-system/css'
const field = sva({
  slots: ['root', 'icon'],
  base: { root: { display: 'flex' }, icon: { color: 'gray.500' } },
  variants: {
    tone: { quiet: { icon: { color: 'gray.300' } }, loud: { icon: { color: 'red.500' } } },
    size: { sm: { root: { padding: '2' } }, lg: { root: { padding: '4' } } },
  },
  defaultVariants: { tone: 'loud', size: 'lg' },
})
export const root = (tone, size) => field({ tone, size }).root
export const icon = (tone, size) => field({ tone, size }).icon
export const slots = (tone, size) => field({ tone, size })
export const composed = (tone, size) => cx(field({ tone, size }).root, css({ color: 'blue.500' }))
export const rootOf = (props) => field(props).root
export const slotsOf = (props) => field(props)
export const literalRoot = [${literals.map((call) => `${call}.root`).join(', ')}]
export const literalIcon = [${literals.map((call) => `${call}.icon`).join(', ')}]
export const literalSlots = [${literals.join(', ')}]
export const literalComposed = [${literals.map((call) => `cx(${call}.root, css({ color: 'blue.500' }))`).join(', ')}]
export const literalDefault = field()
`
  const { result, code, module } = compileAndRun(source, [
    'root',
    'icon',
    'slots',
    'composed',
    'rootOf',
    'slotsOf',
    'literalRoot',
    'literalIcon',
    'literalSlots',
    'literalComposed',
    'literalDefault',
  ])

  // `overlapping` is a call inside a `cx()`, compiled with it rather than on its own.
  test('compiles every call, the dynamic ones to a lookup', () => {
    expect(result.skipped.filter(({ reason }) => reason !== 'overlapping')).toEqual([])
    expect(code).toContain('cvaMap(')
  })

  test.each(rows.map((row, index) => [describeRow(names, row), row, index] as const))(
    'selects what the literal call does, %s',
    (_label, row, index) => {
      const values = row.map((state) => state.value)
      expect(module.root(...values), '.root').toBe(module.literalRoot[index])
      expect(module.icon(...values), '.icon').toBe(module.literalIcon[index])
      expect(module.slots(...values), 'the slot object').toEqual(module.literalSlots[index])
      expect(module.composed(...values), '.root inside cx()').toBe(module.literalComposed[index])
      expect(module.rootOf(propsOf(names, row)), '.root of a props object').toBe(module.literalRoot[index])
      expect(module.slotsOf(propsOf(names, row)), 'the slot object of a props object').toEqual(
        module.literalSlots[index],
      )
    },
  )

  // `field(props)` is typed to take `undefined`, and selects the defaults as `field()` does.
  test('selects the defaults when the props object is undefined', () => {
    expect(module.rootOf(undefined)).toBe(module.literalDefault.root)
    expect(module.slotsOf(undefined)).toEqual(module.literalDefault)
  })
})

describe('a dynamic recipe call with an axis that matters only on some paths', () => {
  // `size` styles nothing of its own: it matters only beside `tone: 'loud'`, through the compound,
  // so under any other tone the table goes from the `tone` decision straight to `shape`.
  const names = ['tone', 'size', 'shape']
  const rows = combinations([statesOf('quiet', 'loud'), statesOf('sm', 'lg'), statesOf('round', 'square')])
  const source = `import { cva } from 'styled-system/css'
const badge = cva({
  base: { display: 'inline-flex' },
  variants: {
    tone: { quiet: { color: 'gray.500' }, loud: { color: 'red.500' } },
    size: { sm: {}, lg: {} },
    shape: { round: { borderRadius: 'full' }, square: { borderRadius: 'sm' } },
  },
  compoundVariants: [{ tone: 'loud', size: 'lg', css: { fontWeight: 'bold' } }],
  defaultVariants: { tone: 'quiet', shape: 'round' },
})
export const className = (tone, size, shape) => badge({ tone, size, shape })
export const classNameOf = (props) => badge(props)
export const literal = [${rows.map((row) => `badge(${literalSelection(names, row)})`).join(', ')}]
export const literalDefault = badge()
`
  const { result, code, module } = compileAndRun(source, ['className', 'classNameOf', 'literal', 'literalDefault'])

  test('compiles every call, the dynamic ones to a lookup', () => {
    expect(result.skipped).toEqual([])
    expect(code).toContain('cvaMap(')
  })

  test.each(rows.map((row, index) => [describeRow(names, row), row, index] as const))(
    'selects what the literal call does, %s',
    (_label, row, index) => {
      expect(module.className(...row.map((state) => state.value))).toBe(module.literal[index])
      expect(module.classNameOf(propsOf(names, row)), 'a props object').toBe(module.literal[index])
    },
  )

  // `badge(props)` is typed to take `undefined`, and selects the defaults as `badge()` does.
  test('selects the defaults when the props object is undefined', () => {
    expect(module.classNameOf(undefined)).toBe(module.literalDefault)
  })
})

/** The tables the module declares, as `cvaMap` reads them. */
const tablesIn = (code: string) =>
  [...code.matchAll(/^const __bambooLookup\w* = (.*);$/gm)].map((match) => JSON.parse(match[1]!) as unknown)

/** Segments: an array whose first element is not a table's root. */
const isSegments = (lookup: unknown) => Array.isArray(lookup) && typeof lookup[0] !== 'number'

describe('a dynamic recipe call compiled in segments', () => {
  // `tone` takes the base's `color` with it, and the compound ties `size` to `shape`: two groups,
  // each over two runs that do not touch, since `tone` is written between `size` and `shape`.
  const names = ['size', 'tone', 'shape']
  const rows = combinations([
    statesOf('sm', 'md', 'lg'),
    statesOf('quiet', 'loud', 'muted'),
    statesOf('round', 'square', 'pill'),
  ])
  const source = `import { cva } from 'styled-system/css'
const badge = cva({
  base: { display: 'inline-flex', color: 'gray.500' },
  variants: {
    size: { sm: { padding: '2', fontSize: 'sm' }, md: { padding: '4' }, lg: { padding: '6', fontSize: 'lg' } },
    tone: { quiet: { color: 'gray.300' }, loud: { color: 'red.500' }, muted: {} },
    shape: { round: { borderRadius: 'full' }, square: { borderRadius: 'sm' }, pill: { borderRadius: 'full', fontWeight: 'bold' } },
  },
  compoundVariants: [{ size: 'lg', shape: 'pill', css: { fontWeight: 'light' } }],
  defaultVariants: { size: 'md' },
})
export const className = (size, tone, shape) => badge({ size, tone, shape })
export const classNameOf = (props) => badge(props)
export const literal = [${rows.map((row) => `badge(${literalSelection(names, row)})`).join(', ')}]
`
  const { result, code, module } = compileAndRun(source, ['className', 'classNameOf', 'literal'])

  test('compiles every call, the dynamic ones to segments', () => {
    expect(result.skipped).toEqual([])
    expect(tablesIn(code).some(isSegments)).toBe(true)
  })

  test.each(rows.map((row, index) => [describeRow(names, row), row, index] as const))(
    'selects what the literal call does, %s',
    (_label, row, index) => {
      expect(module.className(...row.map((state) => state.value))).toBe(module.literal[index])
      expect(module.classNameOf(propsOf(names, row)), 'a props object').toBe(module.literal[index])
    },
  )
})

describe('a dynamic slot recipe call compiled in segments', () => {
  const names = ['size', 'tone', 'shape']
  const rows = combinations([
    statesOf('sm', 'md', 'lg'),
    statesOf('quiet', 'loud', 'muted'),
    statesOf('round', 'square', 'pill'),
  ])
  const literals = rows.map((row) => `field(${literalSelection(names, row)})`)
  const source = `import { sva } from 'styled-system/css'
const field = sva({
  slots: ['root', 'icon'],
  base: { root: { display: 'flex', color: 'gray.500' }, icon: { color: 'gray.300' } },
  variants: {
    size: { sm: { root: { padding: '2' }, icon: { fontSize: 'sm' } }, md: { root: { padding: '4' } }, lg: { root: { padding: '6' }, icon: { fontSize: 'lg' } } },
    tone: { quiet: { icon: { color: 'gray.500' } }, loud: { root: { color: 'red.500' }, icon: { color: 'red.300' } }, muted: {} },
    shape: { round: { root: { borderRadius: 'full' } }, square: { root: { borderRadius: 'sm' } }, pill: { root: { borderRadius: 'full', fontWeight: 'bold' } } },
  },
  defaultVariants: { tone: 'quiet' },
})
export const slots = (size, tone, shape) => field({ size, tone, shape })
export const root = (size, tone, shape) => field({ size, tone, shape }).root
export const literalSlots = [${literals.join(', ')}]
`
  const { result, code, module } = compileAndRun(source, ['slots', 'root', 'literalSlots'])

  test('compiles every call, a slot of the whole object to segments', () => {
    expect(result.skipped).toEqual([])
    const tables = tablesIn(code)
    expect(tables.some((table) => !Array.isArray(table) && Object.values(table as object).some(isSegments))).toBe(true)
  })

  test.each(rows.map((row, index) => [describeRow(names, row), row, index] as const))(
    'selects what the literal call does, %s',
    (_label, row, index) => {
      const values = row.map((state) => state.value)
      expect(module.slots(...values)).toEqual(module.literalSlots[index])
      expect(module.root(...values), '.root').toBe(module.literalSlots[index].root)
    },
  )
})
