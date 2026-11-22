import { mergeProps } from '@bamboocss/shared'
import type { StaticStyleSetCompiler, StyleSetRecipeConfig } from './style-set'

type Dict = Record<string, unknown>

/** A node by its index, or a leaf by its index complemented: -1 for the first, -2 for the next. */
type Ref = number
/** The position in the lookup's values the node decides, its miss and `undefined` edges, then each declared value's. */
type Node = [number, Ref, Ref, Array<string | Ref>]
/** `[root, nodes, leaves]`: a reduced decision table, each leaf a class string. */
export type RecipeTable = [Ref, Node[], string[]]
/**
 * The class string one recipe call compiles to: a constant, a table, or segments, constants and
 * tables that `cvaMap` joins in order.
 */
export type ClassLookup = string | RecipeTable | Array<string | RecipeTable>
/**
 * A slot recipe's whole object: one table whose leaves are slot objects, or a lookup per slot. A
 * lookup per slot of nothing but strings is the object itself.
 */
export type SlotsLookup = [Ref, Node[], Array<Record<string, string>>] | Record<string, ClassLookup>

/**
 * Above this many selections, a call whose variants split into groups that decide declarations of
 * their own is compiled in segments rather than as one table.
 *
 * A table holds a leaf for each combination of its variants' outcomes, so it grows as their
 * product; segments hold each group's outcomes once, so they grow as the sum. Below this, one
 * table is a few kilobytes at most and one walk of it is cheaper than joining parts on every call.
 */
export const SEGMENT_ABOVE_STATES = 64

const isRecord = (value: unknown): value is Dict => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Each token of `className`, kept as a class the stylesheet has to hold. */
const record = (emitted: Set<string>, className: string) => {
  for (const token of className.split(' ')) if (token) emitted.add(token)
  return className
}

export interface RecipeLookupOptions {
  config: StyleSetRecipeConfig
  /** The variants the call writes as literals, or that the analysis resolved exactly. */
  selection: Dict
  /** The variants chosen at runtime, in the config's order: the lookup's values, by position. */
  axes: readonly string[]
  styleCompiler: StaticStyleSetCompiler
  maxRecipeStates: number
  /** @see SEGMENT_ABOVE_STATES. Lower only to see small recipes compiled in segments. */
  segmentAbove?: number
}

/**
 * The lookups one recipe call compiles to, for a slot or for a recipe without slots.
 *
 * Each leaf is a *complete* class string, so its declarations keep the precedence the recipe's
 * merge gives them: selecting each variant's atoms on their own would put both values of a
 * property a later variant overrides in the class, and let stylesheet order pick the winner.
 *
 * A table over every variant the call chooses at runtime holds a leaf per combination, which grows
 * as their product and fails the build past `maxRecipeStates`. Most variants decide declarations of
 * their own, though, and those can be decided apart without giving that up. @see segmented
 */
export const createRecipeLookups = ({
  config,
  selection,
  axes,
  styleCompiler,
  maxRecipeStates,
  segmentAbove = SEGMENT_ABOVE_STATES,
}: RecipeLookupOptions) => {
  const variants = Object.keys(config.variants ?? {})
  const compounds = config.compoundVariants ?? []
  /** The base, each variant in the config's order, then each compound: the order fragments merge in. */
  const places = 1 + variants.length + compounds.length
  /** Where each axis merges: its variant's place. */
  const placeOfAxis = axes.map((axis) => 1 + variants.indexOf(axis))
  const valuesOf = (axis: string) => Object.keys(config.variants?.[axis] ?? {})
  const every = axes.map((_, index) => index)

  const assertStates = (axisIndices: readonly number[]) => {
    const states = axisIndices.reduce((product, index) => product * (valuesOf(axes[index]!).length + 2), 1)
    if (states <= maxRecipeStates) return
    throw new Error(
      `Static recipe compilation would inspect ${states.toLocaleString('en-US')} selections across ` +
        `${axisIndices.length} runtime variant axes that decide declarations together ` +
        `(${axisIndices.map((index) => axes[index]).join(', ')}), above maxRecipeStates=` +
        `${maxRecipeStates.toLocaleString('en-US')}. Make one or more axes statically known, split the recipe, ` +
        `or raise the limit explicitly.`,
    )
  }

  /**
   * The reduced decision table over `axisIndices`, or the one leaf every selection of them reaches.
   *
   * `undefined` is its own edge because it restores a default variant. `null` and any undeclared
   * value take the miss edge and explicitly suppress that default. Declared values use string keys,
   * matching JavaScript's property-key coercion in the recipe runtime. A flat alternating key/value
   * array avoids the special `__proto__` semantics of an object literal.
   *
   * A decision that changes nothing is left out, so a node names the value it decides. `.root` of a
   * slot recipe whose `tone` styles only its icon never reads `tone`, and the root of that table
   * decides `size`. Without the name, `cvaMap` read the value at the node's depth and decided
   * `size` by `tone`.
   */
  function buildTable(axisIndices: readonly number[], leafOf: (assignment: Dict) => string): string | RecipeTable
  function buildTable<Leaf>(
    axisIndices: readonly number[],
    leafOf: (assignment: Dict) => Leaf,
    shapeOf: (leaf: Leaf) => string,
  ): Leaf | [Ref, Node[], Leaf[]]
  function buildTable<Leaf>(
    axisIndices: readonly number[],
    leafOf: (assignment: Dict) => Leaf,
    shapeOf: (leaf: Leaf) => string = String,
  ): Leaf | [Ref, Node[], Leaf[]] {
    const nodes: Node[] = []
    const nodeByShape = new Map<string, number>()
    const leaves: Leaf[] = []
    const leafIds = new Map<string, number>()

    // Leaves are kept once each, so a class string many selections reach appears in the table once.
    const internLeaf = (value: Leaf): Ref => {
      const shape = shapeOf(value)
      let id = leafIds.get(shape)
      if (id === undefined) {
        id = leaves.length
        leaves.push(value)
        leafIds.set(shape, id)
      }
      return ~id
    }

    const buildNode = (depth: number, assignment: Dict): Ref => {
      if (depth === axisIndices.length) return internLeaf(leafOf(assignment))

      const index = axisIndices[depth]!
      const axis = axes[index]!
      const miss = buildNode(depth + 1, { ...assignment, [axis]: null })
      const absentAssignment = { ...assignment }
      delete absentAssignment[axis]
      const absent = buildNode(depth + 1, absentAssignment)

      const byValue: Array<string | Ref> = []
      for (const value of valuesOf(axis)) byValue.push(value, buildNode(depth + 1, { ...assignment, [axis]: value }))

      // Every value leads to the same place, so the decision is left out: the parent's edge goes
      // straight there, to a node deciding a later value than its depth says.
      const refs = [miss, absent, ...byValue.filter((_, valueIndex) => valueIndex % 2 === 1)] as Ref[]
      if (refs.every((ref) => ref === refs[0])) return refs[0]!

      const node: Node = [index, miss, absent, byValue]
      const shape = JSON.stringify(node)
      const known = nodeByShape.get(shape)
      if (known !== undefined) return known
      const id = nodes.length
      nodes.push(node)
      nodeByShape.set(shape, id)
      return id
    }

    const root = buildNode(0, {})
    return root < 0 ? leaves[~root]! : [root, nodes, leaves]
  }

  /** The states of one table over every axis, which `maxRecipeStates` bounds. */
  const jointStates = every.reduce((product, index) => product * (valuesOf(axes[index]!).length + 2), 1)

  /** One table over every axis, its leaves composed with the other arguments of an enclosing `cx()`. */
  const joint = (slot: string | undefined, before: Dict[], after: Dict[], emitted: Set<string>) => {
    assertStates(every)
    return buildTable(every, (assignment) => {
      const styles = styleCompiler.resolveRecipe(config, { ...selection, ...assignment }, slot)
      if (!styles) return ''
      // Beside the other arguments of a `cx()`, if any, merged as the runtime `cx` merges their classes.
      return record(emitted, styleCompiler.className(styleCompiler.composeCx(...before, styles, ...after)))
    })
  }

  /**
   * The call's class string as segments, each decided by one group of variants, or `undefined` when
   * its variants do not split.
   *
   * Fragments merge in a fixed order of places — the base, each variant, each compound — and the
   * class string names the merged object's declarations in the order its keys were first written.
   * Places that write the same top-level key, or the same property under the same conditions, are
   * one owner: that is how a variant overriding a base declaration takes the base's place with it,
   * and how two variants writing one property are decided together. A compound is decided with
   * the variants it names. A top-level `base` is merged into every other declaration a class names,
   * so a config holding one is not split at all.
   *
   * No owner then reads or writes another's keys, so a run of places one owner holds introduces its
   * keys together, in the merged object and in the class string alike. The string is the runs'
   * strings joined in order, each decided by its owner's variants alone. A table per run grows as
   * its own group's states, and the groups' states add where one table's multiply.
   */
  const segmented = (slot: string | undefined, emitted: Set<string>): ClassLookup | undefined => {
    const parent = Array.from({ length: places }, (_, place) => place)
    const find = (place: number): number => {
      while (parent[place] !== place) place = parent[place] = parent[parent[place]!]!
      return place
    }
    const join = (a: number, b: number) => {
      const [first, second] = [find(a), find(b)]
      if (first !== second) parent[Math.max(first, second)] = Math.min(first, second)
    }
    const dynamic = new Set(placeOfAxis)
    const slotOf = (fragment: unknown) =>
      isRecord(fragment) ? (slot === undefined ? fragment : fragment[slot]) : undefined

    // Every fragment a place can merge into this call: each value of a variant chosen at runtime,
    // and the one the call or its default selects of any other.
    const fragmentsAt = (place: number): unknown[] => {
      if (place === 0) return [config.base]
      if (place <= variants.length) {
        const variant = variants[place - 1]!
        const declared = config.variants?.[variant] ?? {}
        if (dynamic.has(place)) return Object.values(declared)
        const value = selection[variant] === undefined ? config.defaultVariants?.[variant] : selection[variant]
        return value == null ? [] : [declared[String(value)]]
      }
      const compound = compounds[place - 1 - variants.length]
      return isRecord(compound) ? [compound.css] : []
    }

    const topLevel = new Map<string, number>()
    const merging = new Map<string, number>()
    const claim = (owners: Map<string, number>, key: string, place: number) => {
      const owner = owners.get(key)
      if (owner === undefined) owners.set(key, place)
      else join(owner, place)
    }
    for (let place = 0; place < places; place++) {
      for (const fragment of fragmentsAt(place)) {
        const styles = slotOf(fragment)
        if (!isRecord(styles)) continue
        const normalized = styleCompiler.normalize(styles)
        if (Object.hasOwn(normalized, 'base')) return undefined
        for (const key of Object.keys(normalized)) claim(topLevel, key, place)
        for (const key of styleCompiler.mergeKeys(styles)) claim(merging, key, place)
      }
    }
    compounds.forEach((compound, index) => {
      if (!isRecord(compound) || !isRecord(slotOf(compound.css))) return
      const place = 1 + variants.length + index
      for (const key of Object.keys(compound)) {
        const variantPlace = 1 + variants.indexOf(key)
        if (key !== 'css' && dynamic.has(variantPlace)) join(place, variantPlace)
      }
    })

    /** Owner → the axes it decides, for every owner a runtime variant is part of. */
    const groups = new Map<number, number[]>()
    placeOfAxis.forEach((place, index) => {
      const owner = find(place)
      const group = groups.get(owner)
      if (group) group.push(index)
      else groups.set(owner, [index])
    })
    if (groups.size < 2) return undefined
    for (const group of groups.values()) assertStates(group)

    /** The run each place belongs to, and the owner of each run, in merge order. */
    const runOf: number[] = []
    const runOwners: number[] = []
    for (let place = 0; place < places; place++) {
      const owner = find(place)
      if (runOwners.at(-1) !== owner) runOwners.push(owner)
      runOf[place] = runOwners.length - 1
    }

    const nothing = Object.fromEntries(axes.map((axis) => [axis, null]))
    const runStrings = new Map<string, string[]>()
    /** The class string of each of `owner`'s runs, for one selection of its own variants, by run. */
    const runsOf = (owner: number, axisIndices: readonly number[], assignment: Dict) => {
      const key = [
        owner,
        ...axisIndices.map((index) => {
          const axis = axes[index]!
          return Object.hasOwn(assignment, axis) ? JSON.stringify(assignment[axis]) : ''
        }),
      ].join('\u0000')
      const known = runStrings.get(key)
      if (known) return known

      // Every other variant chosen at runtime merges nothing this owner reads, so none is chosen.
      const input: Dict = { ...selection, ...nothing }
      for (const index of axisIndices) delete input[axes[index]!]
      Object.assign(input, assignment)
      const own = (styleCompiler.recipeFragments(config, input, slot) ?? [])
        .filter((fragment) => find(fragment.place) === owner)
        .map((fragment) => ({ place: fragment.place, styles: styleCompiler.normalize(fragment.styles) }))
      const merged = mergeProps({}, ...own.map((fragment) => fragment.styles)) as Dict

      const byRun = new Map<number, Dict>()
      for (const top of Object.keys(merged)) {
        const run = runOf[own.find((fragment) => Object.hasOwn(fragment.styles, top))!.place]!
        let styles = byRun.get(run)
        if (!styles) byRun.set(run, (styles = {}))
        styles[top] = merged[top]
      }
      // The class string names each class once, where it first meets it, so a later run does not
      // name one an earlier run of the same owner did.
      const named = new Set<string>()
      const strings: string[] = []
      for (const [run, styles] of byRun) {
        const tokens = styleCompiler
          .className(styles)
          .split(' ')
          .filter((token) => token && !named.has(token))
        for (const token of tokens) named.add(token)
        strings[run] = tokens.join(' ')
      }
      runStrings.set(key, strings)
      return strings
    }

    const segments: Array<string | RecipeTable> = []
    const push = (segment: string | RecipeTable) => {
      if (typeof segment !== 'string') {
        for (const leaf of segment[2]) record(emitted, leaf)
        segments.push(segment)
        return
      }
      if (!segment) return
      record(emitted, segment)
      const last = segments.at(-1)
      if (typeof last === 'string') segments[segments.length - 1] = `${last} ${segment}`
      else segments.push(segment)
    }
    runOwners.forEach((owner, run) => {
      const axisIndices = groups.get(owner)
      // A run no runtime variant decides is the same for every call.
      if (!axisIndices) return push(runsOf(owner, [], {})[run] ?? '')
      push(buildTable(axisIndices, (assignment) => runsOf(owner, axisIndices, assignment)[run] ?? ''))
    })

    if (segments.length === 0) return ''
    return segments.length === 1 ? segments[0]! : segments
  }

  /**
   * The class string for one slot, or for a recipe without slots. In segments when its variants
   * split and one table would exceed `segmentAbove` states, or the limit, and as one table otherwise.
   *
   * A `cx()` around the call merges its declarations with the other arguments' by property and
   * conditions, which places a later argument's class where the first one setting that key stood.
   * Runs do not keep that order, so a composed call is decided whole.
   */
  const classes = (slot: string | undefined, before: Dict[], after: Dict[], emitted: Set<string>): ClassLookup => {
    if (before.length === 0 && after.length === 0 && axes.length > 1) {
      if (jointStates > segmentAbove || jointStates > maxRecipeStates) {
        const segments = segmented(slot, emitted)
        if (segments !== undefined) return segments
      }
    }
    return joint(slot, before, after, emitted)
  }

  /**
   * A slot recipe's whole object. One table whose leaves are slot objects while it is small, which
   * one walk and a copy read; past `segmentAbove` states, a lookup per slot, so each slot's table
   * holds only the variants that style it, segmented as its own declarations allow.
   */
  const slots = (emitted: Set<string>): SlotsLookup => {
    const names = config.slots ?? []
    if (jointStates > segmentAbove || jointStates > maxRecipeStates) {
      return Object.fromEntries(names.map((name) => [name, classes(name, [], [], emitted)]))
    }
    const table = buildTable(
      every,
      (assignment) =>
        Object.fromEntries(
          names.map((name) => {
            const styles = styleCompiler.resolveRecipe(config, { ...selection, ...assignment }, name)
            return [name, styles ? record(emitted, styleCompiler.className(styles)) : '']
          }),
        ),
      (leaf) => JSON.stringify(leaf),
    )
    return table
  }

  return { classes, slots }
}
