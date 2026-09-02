import { BambooError } from '@bamboocss/shared'
import type { CascadeLayer, CascadeLayers, ConditionDetails } from '@bamboocss/types'
import postcss, { AtRule, Root } from 'postcss'
import { compareConditionOrder } from './sort-style-rules'
import { compareSpecificity, type Specificity } from './specificity'

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

interface UtilitySublayer {
  atRule: AtRule
  key: UtilitySublayerKey
}

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

  /**
   * The sublayer of `utilities` a rule with this key belongs in, created on first use.
   *
   * Named provisionally: the names that mean anything are assigned once every sublayer is
   * known, in `orderUtilitySublayers`, and nothing reads them before that.
   */
  utilitySublayer(key: UtilitySublayerKey): AtRule {
    const identity = identityOf(key)
    let sublayer = this.utilitySublayers.get(identity)
    if (!sublayer) {
      sublayer = { atRule: postcss.atRule({ name: 'layer', params: identity, nodes: [] }), key }
      this.utilitySublayers.set(identity, sublayer)
      this.utilities.append(sublayer.atRule)
    }
    return sublayer.atRule
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
    const sublayers = [...this.utilitySublayers.values()].sort((a, b) => compareSublayers(a.key, b.key))

    // Distinct condition signatures, numbered in sorter order and shared across specificities,
    // so the same condition reads the same wherever it appears.
    const distinct = new Map<string, ConditionDetails[] | undefined>()
    for (const { key } of sublayers) {
      if (key.important) continue
      const signature = conditionSignature(key.conditions)
      if (!distinct.has(signature)) distinct.set(signature, key.conditions)
    }
    const ordered = [...distinct.entries()].sort(([, a], [, b]) => compareConditionOrder(a, b))
    const ranks = new Map(ordered.map(([signature], rank) => [signature, rank]))
    const rankOf = (conditions: ConditionDetails[] | undefined) => ranks.get(conditionSignature(conditions))!

    const names: string[] = []
    if (this.compositions.nodes?.length) names.push(this.compositions.params)
    sublayers.forEach(({ atRule, key }, position) => {
      atRule.params = compact
        ? `u${position}`
        : key.important
          ? IMPORTANT_SUBLAYER
          : `s${key.specificity.join('')}-c${rankOf(key.conditions)}-p${key.priority}`
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
