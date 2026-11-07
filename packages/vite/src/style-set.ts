import type { Context } from '@bamboocss/core'
import {
  atomKey,
  compact,
  createMergeCss,
  filterBaseConditions,
  mergeProps,
  normalizeStyleObject,
} from '@bamboocss/shared'
import type { Dict } from '@bamboocss/types'
import { createCssContext, type RuntimeCss } from './runtime-css'
import { createConditionCheck } from './unknown-condition'

/**
 * The build-time meaning of a recipe, before any class name is allocated.
 *
 * Recipe names and source files are deliberately absent. They select a style set; they are
 * not part of a declaration's identity. Keeping this shape beside the Vite fold lets the
 * compiler merge a recipe with `css()` before either is materialised as a class string.
 */
export interface StyleSetRecipeConfig {
  base?: Dict
  variants?: Record<string, Record<string, unknown>>
  defaultVariants?: Record<string, unknown>
  compoundVariants?: Array<Record<string, unknown>>
  slots?: string[]
}

export interface StaticStyleSetCompiler {
  /** Merge style sets with the same left-to-right precedence as `css(a, b)`. */
  compose(...styles: Dict[]): Dict
  /**
   * Merge the style sets a `cx()` joins as the runtime `cx` merges the classes they compile to: of
   * the declarations that set one property under the same conditions, the last. @see composeCx
   */
  composeCx(...styles: Dict[]): Dict
  /** Resolve one recipe selection to authored styles. */
  resolveRecipe(config: StyleSetRecipeConfig, selection?: Dict, slot?: string): Dict | undefined
  /** Allocate the ordinary globally shared utility atoms for a style set. */
  className(...styles: Dict[]): string
  /** Allocate a compact class for a non-atomic compiler surface such as `viewTransition()`. */
  allocateClassString(className: string): string
}

const isRecord = (value: unknown): value is Dict => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** One declaration of a style set: its merge key, where it is written with its conditions outermost, and its value. */
interface Declaration {
  key: string
  path: string[]
  value: unknown
}

/** A compound selector matches only through variant classes the recipe actually emits. */
const matchesCompound = (
  compound: Record<string, unknown>,
  selection: Dict,
  variants: StyleSetRecipeConfig['variants'],
) => {
  for (const [key, expected] of Object.entries(compound)) {
    if (key === 'css') continue
    const declared = variants?.[key]
    const selected = selection[key]
    // The named-rule representation has no class for an absent or undeclared value, so a
    // compound selector requiring it can never match. Preserve that behavior when replacing
    // the selector with a complete StyleSet; this also makes static and finite-miss paths agree.
    if (selected == null || !declared || !Object.hasOwn(declared, String(selected))) return false
    const alternatives = Array.isArray(expected) ? expected : [expected]
    // Variant classes are named through property-key coercion. A boolean `false` selection
    // and a compound value written as `'false'` therefore select the same CSS conjunction.
    if (!alternatives.some((value) => value != null && String(selected) === String(value))) return false
  }
  return true
}

/**
 * Resolve the style fragments one recipe call contributes, in emitted-rule precedence.
 *
 * This intentionally rejects conditional variant *selections*. A scalar selects a style
 * object; an object such as `{ base: 'sm', md: 'lg' }` selects several objects under
 * conditions and needs a separate lowering. Returning `undefined` rejects that call instead
 * of silently compiling only one branch.
 */
export const createStaticStyleSetCompiler = (
  ctx: Context,
  runtimeCss: RuntimeCss,
  allocateClassString: (className: string) => string = (className) => className,
): StaticStyleSetCompiler => {
  const cssContext = createCssContext(ctx)
  const { mergeCssUncached } = createMergeCss(cssContext)
  const checkConditions = createConditionCheck(ctx)
  const { shift, finalize } = ctx.conditions
  const { resolveShorthand } = cssContext.utility

  /**
   * One style set's fragments, with every mixin written out, alone too: first in the fragment
   * applying it, the fragment's own declarations after it.
   *
   * A mixin kept as its own class is one opaque `mixin` key, and the class sits in the
   * `compositions` layer, below every other utility. Merged that way, a later fragment's mixin
   * replaced an earlier one outright. Ranked that way, it lost to every utility its declarations
   * would rank above written out: a variant's mixin lost to the base, its `_hover` to any `color`,
   * its `'& input'` to the input's own `fontSize`, and its `paddingTop` to another class's
   * `padding`, which a longhand outranks. Written out, its declarations merge like any others and
   * rank by their own selectors, conditions and properties. The stylesheet interns the same
   * declarations at every application, so these classes have rules. @see Mixins.expand
   */
  const prepare = (styles: Dict[]) => {
    if (!styles.some((style) => ctx.mixins.has(style))) return styles
    return styles.map((style) => (isRecord(style) ? ctx.mixins.expand(style) : style))
  }

  const compose = (...styles: Dict[]) => mergeCssUncached(...prepare(styles))

  /**
   * One style's declarations as `composeCx` merges them, read once per style set: a `cx()` with
   * four conditions composes the same five in sixteen combinations, and reading each again for
   * every one of them made the fold of six such calls half again as slow. Style sets are not
   * written to once composed.
   */
  const declarationCache = new WeakMap<Dict, Declaration[]>()

  /**
   * The leaves `walkObject` would hand `css()`, in its order, without the mapped copy it builds. A
   * property at the top, most of what a style holds, has no conditions to order or check.
   */
  const readDeclarations = (node: Dict, paths: string[], into: Declaration[]) => {
    for (const [key, value] of Object.entries(node)) {
      if (value == null) continue
      if (typeof value === 'object') {
        readDeclarations(value as Dict, [...paths, key], into)
        continue
      }
      if (paths.length === 0) {
        const property = key.trim()
        into.push({ key: atomKey([], resolveShorthand(property)), path: [property], value })
        continue
      }
      const at = [...paths, key]
      checkConditions(at)
      const [property, ...rawConditions] = shift(at)
      const conditions = filterBaseConditions(rawConditions)
      into.push({
        key: atomKey(finalize(conditions), resolveShorthand(property!)),
        path: [...conditions, property!],
        value,
      })
    }
  }

  const declarationsOf = (style: Dict) => {
    const cached = declarationCache.get(style)
    if (cached) return cached
    const declarations: Declaration[] = []
    const { base, ...rest } = style
    readDeclarations(
      normalizeStyleObject(base === undefined ? rest : mergeProps(rest, base as Dict), cssContext),
      [],
      declarations,
    )
    declarationCache.set(style, declarations)
    return declarations
  }

  /**
   * The style sets a `cx()` joins, merged by property and conditions as the runtime `cx` merges the
   * classes they compile to: each declaration keyed as its atom's merge code is, the last of each
   * key kept in the place the first stood.
   *
   * Merged as `css(a, b)` merges objects, a later `{ p: '3' }` replaced an earlier
   * `{ p: { base: '2', md: '4' } }` outright and dropped the `md` padding, which the runtime keeps
   * when the same class arrives as a `className` prop: one call meant two things, depending on
   * whether the compiler could see its arguments. `{ md: { p: '4' } }` and `{ p: { md: '5' } }`
   * merged into one object holding both, two classes for one key.
   *
   * Each style is read as `css()` reads it, a top-level `base` over the rest and shorthands
   * resolved, and every key is checked as written, as naming checks it. What comes out is written
   * with its conditions outermost, which names the same atoms however the source nested them.
   *
   * One style has nothing to merge with, and the runtime `cx` returns one class string as it came,
   * so it composes as it always has: a lone recipe lookup is written exactly as before.
   */
  const composeCx = (...styles: Dict[]) => {
    const prepared = prepare(styles)
    if (prepared.length < 2) return mergeCssUncached(...prepared)
    // A key set again keeps the place it was first set in, as `Map#set` does.
    const declarations = new Map<string, Declaration>()
    for (const style of prepared) {
      if (!isRecord(style)) continue
      for (const declaration of declarationsOf(style)) declarations.set(declaration.key, declaration)
    }
    const composed: Dict = {}
    for (const { path, value } of declarations.values()) {
      let target = composed
      for (const key of path.slice(0, -1)) target = (target[key] ??= {}) as Dict
      target[path.at(-1)!] = value
    }
    return composed
  }

  const resolveRecipe = (config: StyleSetRecipeConfig, input: Dict = {}, slot?: string): Dict | undefined => {
    const slots = Array.isArray(config.slots) ? config.slots : undefined
    if (Boolean(slots) !== Boolean(slot)) return undefined
    if (slot && !slots?.includes(slot)) return undefined

    const selection = { ...(config.defaultVariants ?? {}), ...compact(input) }
    if (Object.values(selection).some((value) => isRecord(value))) return undefined

    const fragments: Dict[] = []
    const take = (candidate: unknown) => {
      if (!isRecord(candidate)) return
      const styles = slot ? candidate[slot] : candidate
      if (isRecord(styles)) fragments.push(styles)
    }

    take(config.base)

    // Recipe rules are emitted in declaration order, and later variant axes therefore win
    // when two selected axes write the same property. A call site's object-key order never
    // changes that CSS precedence. Resolve in the config's order as well, so replacing those
    // rules with one complete StyleSet is behavior-preserving and an opaque props object does
    // not make precedence depend on how a caller happened to construct it.
    for (const variant of Object.keys(config.variants ?? {})) {
      const value = selection[variant]
      if (value == null) continue
      take(config.variants?.[variant]?.[String(value)])
    }

    for (const compound of config.compoundVariants ?? []) {
      if (!isRecord(compound) || !matchesCompound(compound, selection, config.variants)) continue
      take(compound.css)
    }

    return compose(...fragments)
  }

  return {
    compose,
    composeCx,
    resolveRecipe,
    className: (...styles) => runtimeCss(...prepare(styles)),
    allocateClassString,
  }
}
