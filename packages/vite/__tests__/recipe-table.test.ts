import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { createRecipeLookups } from '../src/recipe-table'
import { createRuntimeCss } from '../src/runtime-css'
import { createStaticStyleSetCompiler, type StyleSetRecipeConfig } from '../src/style-set'
import { compiledRuntime } from './fixture'

/**
 * A recipe compiled in segments has to name, for every selection, exactly the class string the
 * whole recipe does: the same classes, in the same order. Segments are only worth their correctness
 * if nothing can tell them from one table.
 *
 * Checked here against recipes drawn at random from the shapes that make splitting hard: a variant
 * overriding the base, two writing one property, a shorthand beside its longhand, a condition object
 * two variants both write into, responsive values, defaults, compounds and slots. Every one is
 * compiled in segments wherever its variants split, and every selection of it — each value, none,
 * `null` and one no variant declares — is compared with the class string the recipe resolves to.
 */
const ctx = createContext()
const styleCompiler = createStaticStyleSetCompiler(ctx, createRuntimeCss(ctx))
const { cvaMap } = compiledRuntime

/** A seeded generator, so a failure names the recipe that produced it. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Declarations that write one property, a shorthand of it, its longhand, or another under a condition. */
const DECLARATIONS: Array<() => Record<string, unknown>> = [
  () => ({ color: 'red.300' }),
  () => ({ color: 'gray.500' }),
  () => ({ bg: 'blue.500' }),
  () => ({ backgroundColor: 'gray.500' }),
  () => ({ p: '2' }),
  () => ({ padding: '4' }),
  () => ({ paddingTop: '1' }),
  () => ({ fontSize: 'sm' }),
  () => ({ fontWeight: 'bold' }),
  () => ({ borderRadius: 'full' }),
  () => ({ display: 'flex' }),
  () => ({ _hover: { color: 'blue.500' } }),
  () => ({ _hover: { bg: 'red.300' } }),
  () => ({ md: { padding: '2' } }),
  () => ({ md: { color: 'gray.500' } }),
  () => ({ md: { color: 'red.300' } }),
  () => ({ color: { base: 'gray.500', md: 'red.300' } }),
  () => ({ opacity: 0.8 }),
]

const stylesFrom = (next: () => number, count: number) => {
  // Now and then a top-level `base`, which a recipe is not split around.
  const styles: Record<string, unknown> = next() < 0.03 ? { base: { color: 'red.300' } } : {}
  for (let index = 0; index < count; index++) {
    for (const [key, value] of Object.entries(DECLARATIONS[Math.floor(next() * DECLARATIONS.length)]!())) {
      const known = styles[key]
      styles[key] =
        known && typeof known === 'object' && value && typeof value === 'object' ? { ...known, ...value } : value
    }
  }
  return styles
}

const recipeFrom = (seed: number, slots?: string[]) => {
  const next = random(seed)
  const fragment = (count: number) =>
    slots ? Object.fromEntries(slots.map((slot) => [slot, stylesFrom(next, count)])) : stylesFrom(next, count)
  const names = ['tone', 'size', 'shape', 'weight'].slice(0, 2 + Math.floor(next() * 3))
  const variants: Record<string, Record<string, unknown>> = {}
  const defaultVariants: Record<string, unknown> = {}
  for (const name of names) {
    const values = ['a', 'b', 'c'].slice(0, 1 + Math.floor(next() * 3))
    variants[name] = Object.fromEntries(values.map((value) => [value, fragment(Math.floor(next() * 3))]))
    if (next() < 0.4) defaultVariants[name] = values[0]
  }
  const compoundVariants = Array.from({ length: Math.floor(next() * 3) }, () => {
    const named = names.filter(() => next() < 0.5)
    return { ...Object.fromEntries(named.map((name) => [name, 'a'])), css: fragment(1) }
  })
  const config: StyleSetRecipeConfig = {
    ...(next() < 0.8 && { base: fragment(1 + Math.floor(next() * 3)) }),
    variants,
    defaultVariants,
    compoundVariants,
    ...(slots && { slots }),
  }
  // Some variants written as literals at the call site, the rest chosen at runtime.
  const selection: Record<string, unknown> = {}
  const axes = names.filter((name, index) => {
    if (index === 0 || next() < 0.75) return true
    selection[name] = next() < 0.5 ? 'a' : null
    return false
  })
  return { config, selection, axes }
}

/** Every assignment of `axes`: each declared value, none, `null`, and one no variant declares. */
const assignments = (config: StyleSetRecipeConfig, axes: readonly string[]) =>
  axes.reduce<Array<Record<string, unknown>>>(
    (rows, axis) =>
      rows.flatMap((row) =>
        [...Object.keys(config.variants?.[axis] ?? {}), undefined, null, 'unknown'].map((value) =>
          value === undefined ? row : { ...row, [axis]: value },
        ),
      ),
    [{}],
  )

const compareAll = (seed: number, slots?: string[]) => {
  const { config, selection, axes } = recipeFrom(seed, slots)
  const lookupsAt = (segmentAbove: number) =>
    createRecipeLookups({
      config,
      selection,
      axes,
      styleCompiler,
      maxRecipeStates: Number.POSITIVE_INFINITY,
      segmentAbove,
    })
  const split = lookupsAt(0)
  const rows = assignments(config, axes)
  const expectedOf = (assignment: Record<string, unknown>, slot: string | undefined) => {
    const styles = styleCompiler.resolveRecipe(config, { ...selection, ...assignment }, slot)
    return styles ? styleCompiler.className(styles) : ''
  }
  const fail = (what: string, assignment: Record<string, unknown>, actual: unknown, expected: unknown) => {
    throw new Error(
      `seed ${seed}, ${what}, ${JSON.stringify(assignment)}: ${JSON.stringify(actual)} for ${JSON.stringify(expected)}\n` +
        JSON.stringify({ config, selection, axes }),
    )
  }

  let segmented = false
  for (const slot of slots ?? [undefined]) {
    const lookup = split.classes(slot, [], [], new Set())
    if (Array.isArray(lookup) && typeof lookup[0] !== 'number') segmented = true
    for (const assignment of rows) {
      const actual =
        typeof lookup === 'string'
          ? lookup
          : cvaMap(
              axes.map((axis) => assignment[axis]),
              lookup,
            )
      const expected = expectedOf(assignment, slot)
      if (actual !== expected) fail(`slot ${slot}`, assignment, actual, expected)
    }
  }

  // The whole object, as a lookup per slot and as one table of slot objects.
  for (const lookups of slots ? [split, lookupsAt(Number.POSITIVE_INFINITY)] : []) {
    const whole = lookups.slots(new Set())
    for (const assignment of rows) {
      const actual = cvaMap(
        axes.map((axis) => assignment[axis]),
        whole,
      )
      const expected = Object.fromEntries(slots!.map((slot) => [slot, expectedOf(assignment, slot)]))
      if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('the whole object', assignment, actual, expected)
    }
  }
  return segmented
}

describe('a recipe compiled in segments', () => {
  test('names what the whole recipe does, for every selection of 400 recipes', () => {
    let segmented = 0
    for (let seed = 1; seed <= 400; seed++) if (compareAll(seed)) segmented++
    // Most of them split, so the comparison is of segments and not of the one table they fell back to.
    expect(segmented, `${segmented} of 400 compiled in segments`).toBeGreaterThan(100)
  })

  test('names what each slot does, for every selection of 200 slot recipes', () => {
    let segmented = 0
    for (let seed = 1; seed <= 200; seed++) if (compareAll(seed, ['root', 'icon'])) segmented++
    expect(segmented, `${segmented} of 200 compiled in segments`).toBeGreaterThan(70)
  })
})
