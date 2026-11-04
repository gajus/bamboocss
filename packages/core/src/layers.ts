import { BambooError } from '@bamboocss/shared'
import type { CascadeLayer, CascadeLayers, ConditionDetails } from '@bamboocss/types'
import postcss, { AtRule, type ChildNode, Root } from 'postcss'
import { compareConditionOrder } from './sort-style-rules'
import { compareSpecificity, type Specificity } from './specificity'
import type { WrittenOrder } from './style-encoder'

/**
 * What decides which sublayer of `utilities` a rule is written into.
 *
 * The utilities layer used to be one flat layer whose source order carried the precedence:
 * the sorter wrote shorthands before longhands, bare rules before conditional ones, and each
 * breakpoint in its place, and equal-specificity rules resolved by that order. Order is not
 * something a sheet split per chunk can promise — chunks load in whatever order a route
 * needs them — so the precedence moves into cascade sublayers, which the browser orders by
 * the declaration at the top of the sheet whatever order their rules arrive in.
 *
 * Specificity comes first because layer order outranks it. Two rules of different
 * specificity used to resolve by specificity alone, so the more specific one has to sit in
 * the later sublayer; two of equal specificity resolved by source order, so between them the
 * sublayers follow the sorter's order exactly: conditions, then property priority. Important
 * declarations all go to one sublayer of their own, because importance inverts layer order
 * and one layer is the only place the old resolution — specificity, then source order —
 * still holds between two of them.
 */
export interface UtilitySublayerKey {
  important: boolean
  specificity: Specificity
  /** The rule's conditions, for the sorter's order; `undefined` for a bare rule. */
  conditions: ConditionDetails[] | undefined
  /** Property priority, the sorter's last key. */
  priority: number
}

const IMPORTANT_SUBLAYER = 'important'

export interface LayerRootOptions {
  /** Name the utility sublayers by position alone, for a sheet nobody reads. */
  compact?: boolean
}

/** The atom a utility rule was written for, which is how a written order finds the rule. */
export interface UtilityAtom {
  hash: string
  className: string
  /** Its value, which says whether two atoms in conflict would show a difference. */
  value: unknown
}

/** The rules one atom put in a sublayer. */
interface UtilityEntry {
  atom: UtilityAtom | undefined
  nodes: ChildNode[]
}

interface UtilitySublayer {
  atRule: AtRule
  key: UtilitySublayerKey
  entries: UtilityEntry[]
  /** The conditions of each sublayer merged into this one, for its name. @see orderTiedRun */
  merged?: Array<ConditionDetails[] | undefined>
}

/** Whether the sort leaves two sublayers' order to something else: the conditions decide nothing. */
const isTied = (a: UtilitySublayerKey, b: UtilitySublayerKey) =>
  !a.important &&
  !b.important &&
  a.priority === b.priority &&
  compareSpecificity(a.specificity, b.specificity) === 0 &&
  compareConditionOrder(a.conditions, b.conditions) === 0

/** Positions, smallest first. */
class PositionHeap {
  private items: number[] = []
  get size() {
    return this.items.length
  }
  push(value: number) {
    const { items } = this
    let at = items.push(value) - 1
    while (at > 0) {
      const parent = (at - 1) >> 1
      if (items[parent]! <= value) break
      items[at] = items[parent]!
      at = parent
    }
    items[at] = value
  }
  pop(): number | undefined {
    const { items } = this
    const top = items[0]
    const last = items.pop()
    if (!items.length || last === undefined) return top
    let at = 0
    for (;;) {
      const left = at * 2 + 1
      if (left >= items.length) break
      const child = left + 1 < items.length && items[left + 1]! < items[left]! ? left + 1 : left
      if (items[child]! >= last) break
      items[at] = items[child]!
      at = child
    }
    items[at] = last
    return top
  }
}

/**
 * `items` in an order every edge agrees with, each as early as the edges allow. Where the edges
 * form a cycle, the earliest item left goes next, and the edges into it that this overrides are
 * returned as `[from, to]`: `from` had to come first, and comes after.
 */
const topologicalOrder = <T>(items: T[], successors: Map<T, Set<T>>) => {
  const position = new Map<T, number>(items.map((item, at) => [item, at]))
  const indegree = new Int32Array(items.length)
  const predecessors = new Map<T, T[]>()
  for (const [from, targets] of successors) {
    if (!position.has(from)) continue
    for (const to of targets) {
      const at = position.get(to)
      if (at === undefined) continue
      indegree[at]!++
      let before = predecessors.get(to)
      if (!before) predecessors.set(to, (before = []))
      before.push(from)
    }
  }

  const ready = new PositionHeap()
  for (let at = 0; at < items.length; at++) if (indegree[at] === 0) ready.push(at)
  const placed = new Uint8Array(items.length)
  const order: T[] = []
  const overridden: Array<[T, T]> = []
  let earliest = 0
  while (order.length < items.length) {
    let at = ready.pop()
    while (at !== undefined && placed[at]) at = ready.pop()
    if (at === undefined) {
      while (placed[earliest]) earliest++
      at = earliest
      for (const from of predecessors.get(items[at]!) ?? []) {
        if (!placed[position.get(from)!]) overridden.push([from, items[at]!])
      }
    }
    placed[at] = 1
    const item = items[at]!
    order.push(item)
    for (const to of successors.get(item) ?? []) {
      const next = position.get(to)
      if (next === undefined || placed[next]) continue
      if (--indegree[next]! === 0) ready.push(next)
    }
  }
  return { order, overridden }
}

/** The strongly connected components of a graph, each in `items` order. */
const components = <T>(items: T[], successors: Map<T, Set<T>>): T[][] => {
  const index = new Map<T, number>()
  const low = new Map<T, number>()
  const stack: T[] = []
  const onStack = new Set<T>()
  const found: T[][] = []
  let counter = 0
  const visit = (item: T) => {
    index.set(item, counter)
    low.set(item, counter++)
    stack.push(item)
    onStack.add(item)
    for (const next of successors.get(item) ?? []) {
      if (!index.has(next)) {
        visit(next)
        low.set(item, Math.min(low.get(item)!, low.get(next)!))
      } else if (onStack.has(next)) low.set(item, Math.min(low.get(item)!, index.get(next)!))
    }
    if (low.get(item) === index.get(item)) {
      const component: T[] = []
      let member: T
      do {
        member = stack.pop()!
        onStack.delete(member)
        component.push(member)
      } while (member !== item)
      found.push(component)
    }
  }
  for (const item of items) if (!index.has(item)) visit(item)
  const position = new Map(items.map((item, at) => [item, at]))
  return found.map((component) => component.sort((a, b) => position.get(a)! - position.get(b)!))
}

const addEdge = <T>(edges: Map<T, Set<T>>, from: T, to: T) => {
  let targets = edges.get(from)
  if (!targets) edges.set(from, (targets = new Set()))
  targets.add(to)
}

/** The file an owner reads, for a message: `extract:/abs/src/a.tsx` is `/abs/src/a.tsx`. */
const ownerFile = (owner: string | undefined) => (owner ? owner.slice(owner.indexOf(':') + 1) : 'the config')

/**
 * One string per distinct set of conditions, cheap enough to ask for once per atom.
 *
 * A condition's `raw` is its text, and the text is the identity: two conditions spelled the
 * same resolve the same. Only the compound shapes carry structure, and those are serialized.
 * Memoised on the array itself, which every atom hands over exactly once per pass.
 */
const signatures = new WeakMap<ConditionDetails[], string>()
const NO_CONDITIONS = ''

export const conditionSignature = (conditions: ConditionDetails[] | undefined) => {
  if (!conditions?.length) return NO_CONDITIONS
  let signature = signatures.get(conditions)
  if (signature !== undefined) return signature
  signature = ''
  for (const condition of conditions) {
    signature += typeof condition.raw === 'string' ? condition.raw : JSON.stringify(condition.raw)
    signature += '\u0001'
  }
  signatures.set(conditions, signature)
  return signature
}

const identityOf = (key: UtilitySublayerKey) =>
  key.important
    ? IMPORTANT_SUBLAYER
    : `${key.specificity[0]}.${key.specificity[1]}.${key.specificity[2]}\0${conditionSignature(key.conditions)}\0${key.priority}`

const compareSublayers = (a: UtilitySublayerKey, b: UtilitySublayerKey) => {
  if (a.important !== b.important) return a.important ? 1 : -1
  return (
    compareSpecificity(a.specificity, b.specificity) ||
    compareConditionOrder(a.conditions, b.conditions) ||
    a.priority - b.priority
  )
}

export class Layers {
  root: Root
  reset: AtRule
  base: AtRule
  tokens: AtRule

  recipes: AtRule
  recipes_base: AtRule

  recipes_slots: AtRule
  recipes_slots_base: AtRule

  utilities: AtRule
  compositions: AtRule

  /** The sublayers of `utilities`, by the identity of their key. */
  private utilitySublayers = new Map<string, UtilitySublayer>()
  /** The `@layer a, b, c;` statement fixing the sublayers' order, once there are any. */
  private utilityOrder?: AtRule
  /** The orders the sheet's style objects wrote their conditions in. @see noteWrittenOrders */
  private writtenOrders: WrittenOrder[] = []
  private notedOrderLists = new WeakSet<readonly WrittenOrder[]>()
  /** Told of two atoms written in both orders whose values differ. @see orderTiedRun */
  reportConflict?: (message: string) => void

  constructor(private names: CascadeLayers) {
    this.root = postcss.root()
    this.reset = postcss.atRule({ name: 'layer', params: names.reset, nodes: [] })
    this.base = postcss.atRule({ name: 'layer', params: names.base, nodes: [] })
    this.tokens = postcss.atRule({ name: 'layer', params: names.tokens, nodes: [] })
    this.recipes = postcss.atRule({ name: 'layer', params: names.recipes, nodes: [] })
    this.recipes_base = postcss.atRule({ name: 'layer', params: '_base', nodes: [] })
    this.recipes_slots = postcss.atRule({ name: 'layer', params: names.recipes + '.slots', nodes: [] })
    this.recipes_slots_base = postcss.atRule({ name: 'layer', params: '_base', nodes: [] })
    this.utilities = postcss.atRule({ name: 'layer', params: names.utilities, nodes: [] })
    this.compositions = postcss.atRule({ name: 'layer', params: 'compositions', nodes: [] })
  }

  getLayerRoot(layer: CascadeLayer, options: LayerRootOptions = {}) {
    // inset in order: reset, base, tokens, recipes, utilities
    const { reset, base, tokens, recipes, recipes_base, recipes_slots, recipes_slots_base, utilities, compositions } =
      this

    switch (layer) {
      case 'base':
        return base

      case 'reset':
        return reset

      case 'tokens': {
        return tokens
      }

      case 'recipes': {
        const recipeRoot = postcss.root()

        // Base rules go *into* the recipe layer ahead of the variants, not into a nested
        // `@layer _base` inside it.
        //
        // A layer's own unlayered rules always beat its nested sublayers, whatever their
        // selectors say — layer order outranks specificity. So a base declaration written
        // under a condition lost to an unconditional variant declaration *even while the
        // condition held*: `base: { _hover: { boxShadow: '6px' } }` with
        // `variants.color.black: { boxShadow: 'none' }` rendered `none` on hover, silently
        // dropping the hover style. The identical config through `cva` merges in JS and
        // keeps it, so the two pipelines disagreed on the same input.
        //
        // In one layer the ordinary rules apply again: the conditional selector wins on
        // specificity, and two equal-specificity declarations fall back to order — which is
        // why base is prepended rather than appended.
        if (recipes_base.nodes?.length) recipes.prepend(recipes_base.nodes)
        if (recipes_slots_base.nodes?.length) recipes_slots.prepend(recipes_slots_base.nodes)

        if (recipes.nodes?.length) recipeRoot.append(recipes)
        if (recipes_slots.nodes?.length) recipeRoot.append(recipes_slots)

        return recipeRoot
      }

      case 'utilities': {
        this.orderUtilitySublayers(options.compact === true)
        if (compositions.nodes?.length) utilities.prepend(compositions)
        return utilities
      }

      default:
        throw new BambooError('INVALID_LAYER', `Unknown layer: ${layer}`)
    }
  }

  /** Write `css`, the rules of `atom`, into the sublayer `key` belongs in. */
  appendUtility(key: UtilitySublayerKey, css: string, atom?: UtilityAtom) {
    const sublayer = this.sublayerFor(key)
    const nodes = sublayer.atRule.nodes!
    const before = nodes.length
    sublayer.atRule.append(css)
    sublayer.entries.push({ atom, nodes: nodes.slice(before) })
  }

  /**
   * The sublayer of `utilities` a rule with this key belongs in, created on first use.
   *
   * Named provisionally: the names that mean anything are assigned once every sublayer is
   * known, in `orderUtilitySublayers`, and nothing reads them before that.
   */
  private sublayerFor(key: UtilitySublayerKey): UtilitySublayer {
    const identity = identityOf(key)
    let sublayer = this.utilitySublayers.get(identity)
    if (!sublayer) {
      sublayer = { atRule: postcss.atRule({ name: 'layer', params: identity, nodes: [] }), key, entries: [] }
      this.utilitySublayers.set(identity, sublayer)
      this.utilities.append(sublayer.atRule)
    }
    return sublayer
  }

  /**
   * The orders a decoder's style objects wrote their conditions in, for `orderTiedSublayers`.
   * An encoder hands back the same list while nothing changed, so two decoders collecting it
   * for one sheet note it once.
   */
  noteWrittenOrders(orders: readonly WrittenOrder[]) {
    if (this.notedOrderLists.has(orders)) return
    this.notedOrderLists.add(orders)
    for (const order of orders) this.writtenOrders.push(order)
  }

  /**
   * `sorted` with each run of sublayers it leaves tied — same importance, specificity and
   * priority, conditions the sorter ranks alike — put in the order their rules were written in.
   *
   * The sort says nothing between `_dark` and `&[data-active]`, so they kept the order the build
   * met them in, and any call anywhere writing both decided it for every other: a `css()` setting
   * `fontWeight` under `&[data-active]` and then `_dark` made a recipe's `_dark` color beat its
   * `&[data-active]` one, written after it. Each style object's written order is what decides
   * now, for the property it was written for.
   *
   * Two objects can want opposite orders. When they are about different atoms — one sets
   * `color`, the other `fontWeight`, or both `color` to different values — no order of
   * sublayers serves both, so those sublayers become one and their rules are put in an order
   * that does: in one sublayer, source order decides. Only the same two atoms written in both
   * orders cannot both be served; the earlier one then wins its place, and `reportConflict`
   * hears of it when their values differ.
   */
  private orderTiedSublayers(sorted: UtilitySublayer[]): UtilitySublayer[] {
    if (!this.writtenOrders.length) return sorted

    const runs: UtilitySublayer[][] = []
    const runOf = new Map<UtilitySublayer, number>()
    for (let start = 0; start < sorted.length; ) {
      let end = start + 1
      while (end < sorted.length && isTied(sorted[start]!.key, sorted[end]!.key)) end++
      if (end - start > 1) {
        const run = sorted.slice(start, end)
        for (const sublayer of run) runOf.set(sublayer, runs.length)
        runs.push(run)
      }
      start = end
    }
    if (!runs.length) return sorted

    // Where each atom's rules sit, among the tied sublayers.
    const placements = new Map<string, Array<{ sublayer: UtilitySublayer; entry: UtilityEntry }>>()
    for (const run of runs) {
      for (const sublayer of run) {
        for (const entry of sublayer.entries) {
          if (!entry.atom) continue
          let placed = placements.get(entry.atom.hash)
          if (!placed) placements.set(entry.atom.hash, (placed = []))
          placed.push({ sublayer, entry })
        }
      }
    }

    const sublayerEdges = runs.map(() => new Map<UtilitySublayer, Set<UtilitySublayer>>())
    const entryEdges = runs.map(() => new Map<UtilityEntry, Set<UtilityEntry>>())
    for (const { hashes } of this.writtenOrders) {
      for (let first = 0; first < hashes.length; first++) {
        const from = placements.get(hashes[first]!)
        if (!from) continue
        for (let later = first + 1; later < hashes.length; later++) {
          const to = placements.get(hashes[later]!)
          if (!to) continue
          for (const a of from) {
            for (const b of to) {
              const run = runOf.get(a.sublayer)
              if (a.sublayer === b.sublayer || run === undefined || run !== runOf.get(b.sublayer)) continue
              addEdge(sublayerEdges[run]!, a.sublayer, b.sublayer)
              addEdge(entryEdges[run]!, a.entry, b.entry)
            }
          }
        }
      }
    }

    const ordered: UtilitySublayer[] = []
    for (const sublayer of sorted) {
      const run = runOf.get(sublayer)
      if (run === undefined) ordered.push(sublayer)
      else if (runs[run]![0] === sublayer) {
        for (const placed of this.orderTiedRun(runs[run]!, sublayerEdges[run]!, entryEdges[run]!)) {
          ordered.push(placed)
        }
      }
    }
    return ordered
  }

  /** One run of tied sublayers in written order, those that cannot be ordered merged. */
  private orderTiedRun(
    run: UtilitySublayer[],
    sublayerEdges: Map<UtilitySublayer, Set<UtilitySublayer>>,
    entryEdges: Map<UtilityEntry, Set<UtilityEntry>>,
  ): UtilitySublayer[] {
    if (!sublayerEdges.size) return run

    // Sublayers some objects order one way and others the other: no order of them serves both.
    const groups = components(run, sublayerEdges)
    const merged = new Map<UtilitySublayer, UtilitySublayer>()
    for (const group of groups) {
      const sublayer = group.length === 1 ? group[0]! : this.mergeSublayers(group, entryEdges)
      for (const member of group) merged.set(member, sublayer)
    }

    const units = [...new Set(run.map((sublayer) => merged.get(sublayer)!))]
    const unitEdges = new Map<UtilitySublayer, Set<UtilitySublayer>>()
    for (const [from, targets] of sublayerEdges) {
      for (const to of targets) {
        const a = merged.get(from)!
        const b = merged.get(to)!
        if (a !== b) addEdge(unitEdges, a, b)
      }
    }
    return topologicalOrder(units, unitEdges).order
  }

  /**
   * For each pair, the files writing its first atom before its second, in one pass over the
   * written orders: `` `a.tsx`, `b.tsx` ``.
   */
  private writersOf(pairs: Array<[first: string, later: string]>) {
    const wanted = new Map<string, Map<string, Set<string>>>()
    for (const [first, later] of pairs) {
      let laters = wanted.get(first)
      if (!laters) wanted.set(first, (laters = new Map()))
      laters.set(later, new Set())
    }
    for (const { owner, hashes } of this.writtenOrders) {
      for (let at = 0; at < hashes.length; at++) {
        const laters = wanted.get(hashes[at]!)
        if (!laters) continue
        for (let next = at + 1; next < hashes.length; next++) laters.get(hashes[next]!)?.add(ownerFile(owner))
      }
    }
    return (first: string, later: string) =>
      [...(wanted.get(first)?.get(later) ?? [])]
        .sort()
        .map((file) => `\`${file}\``)
        .join(', ')
  }

  /** One sublayer holding the rules of `group`, in an order every written order agrees with. */
  private mergeSublayers(group: UtilitySublayer[], entryEdges: Map<UtilityEntry, Set<UtilityEntry>>): UtilitySublayer {
    const entries = group.flatMap((sublayer) => sublayer.entries)
    const { order, overridden } = topologicalOrder(entries, entryEdges)

    // `first` wrote before `later` and `later` before `first`; `first` went first, so `later` wins.
    // Only a difference in value is worth saying: otherwise either order renders the same.
    const conflicts = this.reportConflict
      ? overridden.filter(([later, first]) => !Object.is(first.atom?.value, later.atom?.value))
      : []
    const writers = conflicts.length
      ? this.writersOf(
          conflicts.flatMap(
            ([later, first]) =>
              [
                [first.atom!.hash, later.atom!.hash],
                [later.atom!.hash, first.atom!.hash],
              ] as Array<[string, string]>,
          ),
        )
      : undefined
    for (const [later, first] of conflicts) {
      const files = (from: UtilityEntry, to: UtilityEntry) => writers!(from.atom!.hash, to.atom!.hash)
      // As markup writes it: the selector form escapes it for CSS.
      const earlier = first.atom!.className.replaceAll('\\', '')
      const winning = later.atom!.className.replaceAll('\\', '')
      // Two written orders can contradict each other through a third atom, none of them writing
      // these two the other way round.
      const kept = files(first, later)
      this.reportConflict!(
        `\`${earlier}\` and \`${winning}\` set one property under conditions that rank alike, and are written in ` +
          `both orders: ${kept ? `${kept} writes \`${earlier}\` first` : `the order others write puts \`${earlier}\` first`}, ` +
          `${files(later, first)} writes \`${winning}\` first. One stylesheet can keep only one order, so where both ` +
          `apply \`${winning}\` wins. To choose, nest one condition inside the other.`,
      )
    }

    // The nodes are handed over whole rather than appended one by one, which would find and splice
    // each out of the sublayer it leaves: quadratic in a sublayer's size.
    const nodes: ChildNode[] = []
    const moved = new Set<ChildNode>()
    for (const entry of order) {
      for (const node of entry.nodes) {
        nodes.push(node)
        moved.add(node)
      }
    }
    // Anything written into a sublayer without an entry keeps its sublayer's place.
    for (const member of group) for (const node of member.atRule.nodes ?? []) if (!moved.has(node)) nodes.push(node)
    const atRule = postcss.atRule({ name: 'layer', params: group[0]!.atRule.params })
    atRule.nodes = nodes
    for (const node of nodes) node.parent = atRule
    for (const member of group) {
      member.atRule.nodes = []
      member.atRule.remove()
    }

    const sublayer: UtilitySublayer = {
      atRule,
      key: group[0]!.key,
      entries: order,
      merged: group.flatMap((member) => member.merged ?? [member.key.conditions]),
    }
    for (const [identity, existing] of this.utilitySublayers) {
      if (group.includes(existing)) this.utilitySublayers.set(identity, sublayer)
    }
    this.utilities.append(atRule)
    return sublayer
  }

  /**
   * Put the sublayers in the order their keys decide, name them for it, and say so first.
   *
   * The statement is what carries the order: a browser orders layers by first appearance,
   * and a chunk arriving later must not be able to append a sublayer the entry sheet did not
   * place. Idempotent, so the layer root can be asked for more than once.
   *
   * Names read as their key — `s010-c3-p3000` is specificity (0,1,0), the third distinct
   * condition in sorter order, property priority 3000 — so a rule's place in the cascade can
   * be read off the sheet in the browser's inspector. A minified sheet is not read there, and
   * each name appears twice per sublayer, so it gets the position alone: `u12`.
   */
  private orderUtilitySublayers(compact: boolean) {
    if (!this.utilitySublayers.size) return
    // A merged sublayer stands for each of its members' keys.
    const unique = [...new Set(this.utilitySublayers.values())]
    const sublayers = this.orderTiedSublayers(unique.sort((a, b) => compareSublayers(a.key, b.key)))

    // Distinct condition signatures, numbered in sorter order and shared across specificities,
    // so the same condition reads the same wherever it appears.
    const distinct = new Map<string, ConditionDetails[] | undefined>()
    for (const { key, merged } of sublayers) {
      if (key.important) continue
      for (const conditions of merged ?? [key.conditions]) {
        const signature = conditionSignature(conditions)
        if (!distinct.has(signature)) distinct.set(signature, conditions)
      }
    }
    const ordered = [...distinct.entries()].sort(([, a], [, b]) => compareConditionOrder(a, b))
    const ranks = new Map(ordered.map(([signature], rank) => [signature, rank]))
    const rankOf = (conditions: ConditionDetails[] | undefined) => ranks.get(conditionSignature(conditions))!
    /** `c3`, or `c3c5` for a sublayer holding the rules of two conditions. */
    const conditionsName = ({ key, merged }: UtilitySublayer) =>
      merged
        ? merged
            .map(rankOf)
            .sort((a, b) => a - b)
            .map((rank) => `c${rank}`)
            .join('')
        : `c${rankOf(key.conditions)}`

    const names: string[] = []
    if (this.compositions.nodes?.length) names.push(this.compositions.params)
    sublayers.forEach((sublayer, position) => {
      const { atRule, key } = sublayer
      atRule.params = compact
        ? `u${position}`
        : key.important
          ? IMPORTANT_SUBLAYER
          : `s${key.specificity.join('')}-${conditionsName(sublayer)}-p${key.priority}`
      names.push(atRule.params)
      this.utilities.append(atRule)
    })

    this.utilityOrder ??= postcss.atRule({ name: 'layer' })
    this.utilityOrder.params = names.join(compact ? ',' : ', ')
    this.utilities.prepend(this.utilityOrder)
  }

  insert(options: LayerRootOptions = {}) {
    const { root } = this

    const reset = this.getLayerRoot('reset')
    if (reset.nodes?.length) root.append(reset)

    const base = this.getLayerRoot('base')
    if (base.nodes?.length) root.append(base)

    const tokens = this.getLayerRoot('tokens')
    if (tokens.nodes?.length) root.append(tokens)

    const recipes = this.getLayerRoot('recipes')
    if (recipes.nodes?.length) root.append(recipes)

    const utilities = this.getLayerRoot('utilities', options)
    if (utilities.nodes?.length) root.append(utilities)

    return root
  }

  get layerNames() {
    return Object.values(this.names)
  }

  get params() {
    return `@layer ${this.layerNames.join(', ')};`
  }
}
