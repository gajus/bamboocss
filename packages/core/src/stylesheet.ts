import merge from 'lodash.merge'
import { logger } from '@bamboocss/logger'
import { getPropertyPriority, isImportant } from '@bamboocss/shared'
import type { CascadeLayer, ConditionDetails, Dict, SystemStyleObject, ViewTransitionResult } from '@bamboocss/types'
import postcss, { CssSyntaxError } from 'postcss'
import { stringifyCustomProperties } from './global-vars'
import type { UtilitySublayerKey } from './layers'
import { optimizeCss, optimizeCssRoot } from './optimize'
import sortMediaQueries from './plugins/sort-mq'
import { serializeStyles } from './serialize'
import { sortStyleRules } from './sort-style-rules'
import {
  NO_SPECIFICITY,
  nestedSpecificity,
  selectorMembers,
  selectorSpecificity,
  type Specificity,
} from './specificity'
import { stringify } from './stringify'
import type { StyleDecoder } from './style-decoder'
import type { CssOptions, LayerName, ProcessOptions, StylesheetContext } from './types'
import { findInvalidDeclarations, type InvalidDeclaration } from './validate-declarations'

/**
 * The one sublayer key a style object resolves to when it does not branch, or `undefined`.
 *
 * Follows the object down while each level holds exactly one key, adding each selector's
 * specificity as nesting would, and stops at the container holding declarations: one path, so
 * one specificity, and one key if every declaration there agrees on importance — the shape of
 * nearly every atom. Anything else is handed to the full walk.
 */
const singleUtilityKey = (
  styles: Dict,
  conditions: ConditionDetails[] | undefined,
  priorityOf: (property: string) => number,
): UtilitySublayerKey | undefined => {
  let node: Dict = styles
  let specificity: Specificity = NO_SPECIFICITY
  let underSelector = false
  for (;;) {
    let name: string | undefined
    let count = 0
    for (const key in node) {
      name = key
      if (++count > 1) return undefined
    }
    if (name === undefined) return undefined
    const value = node[name]
    if (typeof value !== 'object' || value === null || Array.isArray(value)) break
    if (name[0] !== '@') {
      if (name.includes(',')) return undefined
      specificity = underSelector ? nestedSpecificity(specificity, name) : selectorSpecificity(name)
      underSelector = true
    }
    node = value as Dict
  }

  let important: boolean | undefined
  let property: string | undefined
  for (const name in node) {
    const value = node[name]
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return undefined
    const flag = typeof value === 'string' && isImportant(value)
    if (important === undefined) important = flag
    else if (important !== flag) return undefined
    property ??= name
    if (priorityOf(name) !== priorityOf(property)) return undefined
  }
  if (property === undefined || important === undefined) return undefined
  return { important, specificity, conditions, priority: priorityOf(property) }
}

export class Stylesheet {
  constructor(private context: StylesheetContext) {}

  /**
   * What the last `toCss` found the grammar rejecting, one entry per distinct declaration.
   *
   * Collected here because this is the one place the finished tree exists before the
   * optimizer consumes it; graded by `Generator.getCss`, which is where the sheet is emitted
   * and the severity is known. Empty under `invalidDeclaration: 'off'`, and before the first
   * `toCss`.
   */
  invalidDeclarations: InvalidDeclaration[] = []

  get layers() {
    return this.context.layers
  }

  getLayer(layer: LayerName) {
    return this.context.layers[layer] as postcss.AtRule | undefined
  }

  process(options: ProcessOptions) {
    const layer = this.getLayer(options.layer)
    if (!layer) return

    const { styles } = options

    // shouldn't happen, but just in case
    if (typeof styles !== 'object') return

    try {
      layer.append(stringify(styles))
    } catch (error) {
      if (error instanceof CssSyntaxError) {
        logger.error('sheet:process', error.showSourceCode(true))
      } else {
        logger.caughtError('sheet:process', 'Failed to process styles', error)
      }
    }
    return
  }

  serialize = (styles: Dict) => {
    return serializeStyles(this.context, styles)
  }

  processResetCss = (styles: Dict) => {
    const result = this.serialize(styles)

    let css = stringify(result)

    if (this.context.hooks['cssgen:done']) {
      css = this.context.hooks['cssgen:done']({ artifact: 'reset', content: css }) ?? css
    }

    this.context.layers.reset.append(css)
  }

  processGlobalCss = (styles: Dict) => {
    const result = this.serialize(styles)

    let css = stringify(result)
    // Registered before the user's own global vars: a utility's registration is part of the
    // framework's own plumbing, and a user naming the same variable should be the one whose
    // declaration reads last.
    css += stringifyCustomProperties(this.context.utility.customProperties)
    css += this.context.globalVars.toString()
    css += this.context.globalFontface.toString()
    css += this.context.globalPositionTry.toString()

    if (this.context.hooks['cssgen:done']) {
      css = this.context.hooks['cssgen:done']({ artifact: 'global', content: css }) ?? css
    }

    this.context.layers.base.append(css)
  }

  processCss = (styles: SystemStyleObject | undefined, layer: LayerName) => {
    if (!styles) return
    this.process({ styles, layer })
  }

  /**
   * Write a style object into the sublayers of `utilities` its rules belong in.
   *
   * One object can hold rules of more than one specificity — a condition adds to the base
   * selector's, a selector list's members differ — and declarations of more than one
   * importance, and a sublayer is one of each. So the object is walked to its declarations,
   * each is keyed by the specificity of the selector it ends up under, its importance, the
   * rule's conditions and its property priority, and the declarations sharing a key are
   * written together under the path that led to them. For the ordinary atom, one property
   * under one path, that is the whole object.
   *
   * `priorityOf` is the sorter's last key. An atom sorts by the property it was written as,
   * so an atom passes a constant; a view transition's rules carry many properties and take
   * each one's own.
   */
  private processUtility = (
    styles: Dict,
    conditions: ConditionDetails[] | undefined,
    priorityOf: (property: string) => number,
  ) => {
    // The ordinary atom — one selector, perhaps a condition or two, then its declarations —
    // is one group, and can be written as it stands. Only an object that branches, or that
    // mixes importances or selector-list members of differing specificity, needs taking
    // apart. This is where a sheet spends its time, so the walk below is the exception.
    const single = singleUtilityKey(styles, conditions, priorityOf)
    if (single) {
      this.appendUtility(single, styles)
      return
    }

    const groups = new Map<string, { key: UtilitySublayerKey; styles: Dict }>()

    const place = (path: string[], pathKey: string, property: string, value: unknown, specificity: Specificity) => {
      const important = typeof value === 'string' && isImportant(value)
      const priority = priorityOf(property)
      const id = `${important ? 'i' : 'n'}${specificity[0]}.${specificity[1]}.${specificity[2]}\0${priority}\0${pathKey}`
      let group = groups.get(id)
      if (!group) {
        group = { key: { important, specificity, conditions, priority }, styles: {} }
        groups.set(id, group)
      }
      let cursor: Dict = group.styles
      for (const segment of path) cursor = (cursor[segment] ??= {}) as Dict
      cursor[property] = value
    }

    const walk = (node: Dict, path: string[], pathKey: string, specificity: Specificity, underSelector: boolean) => {
      for (const name in node) {
        const value = node[name]
        const nested = typeof value === 'object' && value !== null && !Array.isArray(value)
        if (!nested) {
          // An at-rule key holding a list of blocks, the one shape `stringify` reads an array as.
          if (name[0] === '@' && Array.isArray(value)) {
            for (const block of value as Dict[]) {
              walk(block, [...path, name], `${pathKey}\0${name}`, specificity, underSelector)
            }
            continue
          }
          place(path, pathKey, name, value, specificity)
          continue
        }
        if (name[0] === '@') {
          walk(value as Dict, [...path, name], `${pathKey}\0${name}`, specificity, underSelector)
          continue
        }
        for (const member of selectorMembers(name)) {
          const next = underSelector ? nestedSpecificity(specificity, member) : selectorSpecificity(member)
          walk(value as Dict, [...path, member], `${pathKey}\0${member}`, next, true)
        }
      }
    }

    walk(styles, [], '', NO_SPECIFICITY, false)

    for (const { key, styles: grouped } of groups.values()) this.appendUtility(key, grouped)
  }

  private appendUtility = (key: UtilitySublayerKey, styles: Dict) => {
    try {
      this.layers.utilitySublayer(key).append(stringify(styles))
    } catch (error) {
      if (error instanceof CssSyntaxError) {
        logger.error('sheet:process', error.showSourceCode(true))
      } else {
        logger.caughtError('sheet:process', 'Failed to process styles', error)
      }
    }
  }

  processDecoder = (decoder: StyleDecoder, { includeRecipes = true }: { includeRecipes?: boolean } = {}) => {
    sortStyleRules([...decoder.atomic]).forEach((css) => {
      const layer = (css.layer as LayerName) ?? 'utilities'
      if (layer !== 'utilities') {
        this.processCss(css.result, layer)
        return
      }
      // The sorter's last key is the property the atom was written as, resolved shorthand
      // and all; every declaration the atom emits inherits it, as it did in the flat layer.
      const priority = getPropertyPriority(css.entry.prop)
      this.processUtility(css.result, css.conditions, () => priority)
    })

    if (includeRecipes)
      decoder.recipes.forEach((recipeSet) => {
        // Merged per layer before processing, rather than one `processCss` per result.
        //
        // A scoped slot rule is keyed by its `@scope` prelude, and a recipe with more than
        // one anchor emits every non-anchor slot under each of them — so the same prelude
        // recurs across results with a different anchor's block in between, and identical
        // at-rules only collapse when they are adjacent. Merging first makes the prelude an
        // object key, which deduplicates it by construction. On a 15-slot two-anchor recipe
        // that is 130 `@scope` blocks against 10.
        //
        // Order is preserved: `merge` keeps the target's existing keys in place and appends
        // new ones, so results still emit in the order they were collected.
        const scopedByLayer = new Map<LayerName, Dict>()

        recipeSet.forEach((recipe) => {
          const layer: LayerName = recipe.entry.slot ? 'recipes_slots' : 'recipes'

          // Only the scoped ones are merged. Merging everything also collapses a variant's
          // declarations — which arrive as one result per declaration — into a single rule,
          // and that moves later declarations up to where the variant first appeared,
          // reordering the layer. Unscoped results keep emitting exactly as they did.
          if (!recipe.scoped) {
            this.processCss(recipe.result, layer)
            return
          }

          const target = scopedByLayer.get(layer) ?? {}
          merge(target, recipe.result)
          scopedByLayer.set(layer, target)
        })

        // After the unscoped rules. The two never select the same thing — an anchor's own
        // variant class against a slot's constant class inside a scope — so nothing collides
        // on the way past.
        scopedByLayer.forEach((result, layer) => this.processCss(result, layer))
      })

    if (includeRecipes)
      decoder.recipes_base.forEach((recipeSet) => {
        recipeSet.forEach((recipe) => {
          this.processCss(recipe.result, recipe.slot ? 'recipes_slots_base' : 'recipes_base')
        })
      })

    decoder.view_transitions.forEach((viewTransition) => {
      this.processViewTransition(viewTransition)
    })
  }

  /**
   * `utilities` for the same reason atomic styles land there — last in the cascade, so a
   * transition overrides the theme rather than the other way round.
   *
   * What matters is that it is one of the *existing* layers: both pruning passes scan a
   * hardcoded list of them, so a layer of its own would make every keyframe and token a
   * transition names look unreachable and get pruned away.
   */
  processViewTransition = (viewTransition: ViewTransitionResult) => {
    // Serialized rather than appended raw: the slot bodies are authored style objects, so
    // tokens, shorthands and conditions inside them resolve the same as anywhere else.
    this.processUtility(this.serialize(viewTransition.styles), undefined, getPropertyPriority)
  }

  getLayerCss = (...layers: CascadeLayer[]) => {
    const breakpoints = this.context.conditions.breakpoints
    return optimizeCss(
      layers
        .map((layer: CascadeLayer) => {
          const root = this.context.layers.getLayerRoot(layer)
          breakpoints.expandScreenAtRule(root as postcss.Root)
          return root.toString()
        })
        .join('\n'),
      {
        minify: false,
        browserslist: this.context.browserslist,
        hooks: this.context.hooks,
      },
    )
  }

  toCss = ({ minify }: CssOptions = {}) => {
    try {
      const breakpoints = this.context.conditions.breakpoints

      /**
       * Cloned, because `insert()` hands back the `Layers` instance's own root and everything
       * below rewrites what it is given -- `expandScreenAtRule` and the two plugins here, and
       * then the whole optimize pipeline, which merges rules and drops nodes.
       *
       * Serializing the tree and letting `optimizeCss` parse it back was doing this by
       * accident: a string cannot be mutated, so the round trip was the only thing keeping the
       * context's layers intact across two `toCss` calls. Doing it deliberately is both safer
       * and much cheaper -- 3.7ms against 15.2ms on a 663 kB sheet -- and it extends the
       * protection to `sortMediaQueries`, which ran against the shared tree even under the old
       * spelling.
       */
      const root = this.context.layers.insert({ compact: Boolean(minify) }).clone()

      breakpoints.expandScreenAtRule(root)

      const plugins: postcss.AcceptedPlugin[] = [sortMediaQueries()]

      // The tree, not its text: `optimizeCssRoot` consumes what it is handed, and the clone
      // above exists to be consumed. Serializing it for `optimizeCss` to parse straight back
      // cost 13.0ms against the clone's 6.8ms on a 432 kB sheet.
      const result = postcss(plugins).process(root)

      // Asked of the tree the optimizer is about to consume: the breakpoints are expanded, so
      // every declaration a utility, mixin, recipe or the reset emitted is present, and
      // nothing the optimizer does afterwards invents a value.
      const { utility } = this.context
      this.invalidDeclarations =
        utility.invalidDeclaration === 'off' ? [] : findInvalidDeclarations(result.root, utility.matchesCssGrammar)

      return optimizeCssRoot(result.root, {
        minify,
        browserslist: this.context.browserslist,
        hooks: this.context.hooks,
      })
    } catch (error) {
      if (error instanceof CssSyntaxError) {
        logger.error('sheet:toCss', error.showSourceCode(true))
      }

      throw error
    }
  }
}
