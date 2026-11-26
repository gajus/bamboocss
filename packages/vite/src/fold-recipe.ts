import type { FoldAnalysis, FoldCall, FoldSelection } from '@bamboocss/native-extractor'
import { inferSlots } from '@bamboocss/shared'
import { COMPILED_RUNTIME_ID } from './compiled-runtime'
import { type ClassLookup, createRecipeLookups, type SlotsLookup } from './recipe-table'
import type { StaticStyleSetCompiler, StyleSetRecipeConfig } from './style-set'

/**
 * Lowering a call of an inline recipe to the class string it produces.
 *
 * The prize is not the `cva` runtime, which is small. It is the *config*: `cva({ base, variants })`
 * ships the whole style object to the browser purely so the runtime can hash it into a name and
 * pick classes off it. Those styles are already in the stylesheet. Once every call of a binding
 * is lowered, the binding is unreferenced and a bundler drops the config with it — measured at
 * 81 kB gzipped across one application's 1,297 inline recipes, against 4.5 kB for the runtime.
 *
 * Recipe identity never enters the compiled representation. Only the selected authored
 * declarations and the finite decision graph survive.
 */

type Dict = Record<string, unknown>

/** A recipe's config, as the extractor resolved it. */
export interface RecipeConfig {
  className?: string
  base?: Dict
  variants?: Record<string, Record<string, unknown>>
  defaultVariants?: Record<string, unknown>
  compoundVariants?: unknown[]
  /** Present on a slot recipe, which resolves to one class per slot rather than a string. */
  slots?: unknown
}

/**
 * A recipe the fold can lower against.
 *
 * `filePath` is the module that declared it when that is not the module being folded, so the
 * fold can register it as a watch dependency. Without it, editing a config in another module
 * leaves every compiled consumer stale.
 */
export interface RecipeEntry {
  config: RecipeConfig
  filePath?: string
  /** Every module a call lowered against this entry depends on, besides the one being folded. */
  dependencies?: readonly string[]
}

/**
 * Binding name → the config it was declared with, for the module's own module-scope recipes.
 *
 * A name declared twice, or a config that resolved to more than one value, cannot be lowered
 * against one config, and guessing would fold half the call sites against the wrong recipe.
 */
export const collectRecipeConfigs = (analysis: Pick<FoldAnalysis, 'calls'>): Map<string, RecipeEntry> => {
  const configs = new Map<string, RecipeEntry>()

  for (const definition of analysis.calls) {
    if ((definition.kind !== 'cva' && definition.kind !== 'sva') || !definition.binding) continue
    const name = definition.binding

    if (definition.data.length !== 1 || configs.has(name)) {
      configs.set(name, AMBIGUOUS)
      continue
    }

    const config = definition.data[0] as RecipeConfig | undefined
    if (!config || typeof config !== 'object') continue

    // An `sva()` written without `slots` has the ones its styles name, as the stylesheet works them
    // out. Without them it read as a `cva`, and neither its call nor a slot of it was compiled.
    if (definition.kind === 'sva' && config.slots === undefined) {
      configs.set(name, { config: { ...config, slots: inferSlots(config as never) } })
      continue
    }

    configs.set(name, { config })
  }

  return configs
}

/** Pick a complete precompiled StyleSet for one or more runtime recipe axes. */
export const RECIPE_MAP_HELPER = 'cvaMap'

/**
 * What a lookup compiled in segments calls: the string `cvaMap` would join, the same one again for a
 * selection it has joined before. Its own helper so that `cvaMap`, at every table's call site, is
 * optimized without it.
 */
export const RECIPE_JOIN_HELPER = 'cvaJoin'

/** Guard the exact compiler against accidentally materialising an enormous Cartesian product. */
export const DEFAULT_MAX_RECIPE_STATES = 65_536

/** What `recipe.splitVariantProps` calls, reached directly once the call is lowered. */
export const SPLIT_PROPS_HELPER = 'splitProps'

/** Marker for a binding the fold must never resolve — declared twice, or unresolvable. */
export const AMBIGUOUS: RecipeEntry = Object.freeze({ config: {} })

/** `?.size`, or `?.["x-large"]` when the variant is not a valid identifier. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const optionalAccess = (key: string) => (IDENTIFIER.test(key) ? `?.${key}` : `?.[${JSON.stringify(key)}]`)

/** A helper a replacement calls that the module has to import, by name so duplicates can be dropped. */
export interface HelperInsert {
  names: string[]
}

/**
 * Make a compiled helper callable at this call site, by whatever name the file gives it.
 *
 * Imported from `virtual:bamboo/compiled`, which the plugin serves from its own release, and never
 * from a `styled-system`, whose helpers can be another release's. The import is written after the
 * module's last one, which a module calling a recipe has: the recipe's, or the `cva` that made it.
 */
export const ensureRecipeHelperImport = (
  helper: typeof RECIPE_MAP_HELPER | typeof RECIPE_JOIN_HELPER | typeof SPLIT_PROPS_HELPER,
  analysis: Pick<FoldAnalysis, 'imports' | 'moduleScopeNames'>,
  /** Helper names a nested scope around the call site rebinds. */
  shadowedHere: readonly string[],
): { name: string; insert?: HelperInsert } | undefined => {
  for (const declaration of analysis.imports) {
    if (declaration.typeOnly || declaration.module !== COMPILED_RUNTIME_ID) continue
    for (const named of declaration.specifiers) {
      if (named.typeOnly || named.imported !== helper) continue
      return shadowedHere.includes(named.local) ? undefined : { name: named.local }
    }
  }

  // A module-scope binding of this name would collide with the one being added, and one in
  // scope at the call site would be reached instead of it.
  if (analysis.moduleScopeNames.includes(helper)) return undefined
  if (shadowedHere.includes(helper)) return undefined
  if (analysis.imports.length === 0) return undefined

  return { name: helper, insert: { names: [helper] } }
}

export type LowerResult =
  | { kind: 'class'; className: string; styles?: Dict }
  | {
      kind: 'slots'
      expression: string
      classNames: string[]
      helper?: typeof RECIPE_MAP_HELPER
      dynamic: boolean
    }
  | { kind: 'dynamic-style'; map: DynamicStyleMap }
  | {
      kind: 'decline'
      reason: 'dynamic' | 'unsupported-shape' | 'unknown-recipe'
      /** What the call site has to change, where the reason alone would not say. */
      detail?: string
    }

export interface CompiledStyleMap {
  /**
   * The source the call compiles to: `helper([...values], table)`, with the table written as
   * `tableRef` writes it, or the one leaf every state reduces to. A table is the JSON text of
   * `[root, nodes, leaves]`.
   */
  source(helper: string, tableRef: (table: string) => string): string
  classNames: string[]
  staticClasses: string
  outputKind: 'class' | 'slots'
  /** Whether `source` actually calls `cvaMap`; reduced constant maps do not. */
  usesHelper: boolean
  /** Whether the lookup is segments, which `RECIPE_JOIN_HELPER` reads, rather than one table. */
  segmented: boolean
}

/** A finite recipe state space kept symbolic until an enclosing `cx()` has composed it. */
export interface DynamicStyleMap {
  outputKind: 'class' | 'slots'
  compile(before?: Dict[], after?: Dict[]): CompiledStyleMap
}

/**
 * Lower one invocation, or say why not.
 *
 * Every property written at the call site has to be a literal. A selection is not additive —
 * an unresolved variant does not merely omit a class, it can change which of several the
 * recipe applies — so a partially-known selection is not foldable at all.
 */
export const lowerRecipeCall = (
  /** The call as the native analysis describes it: its argument count and written selection. */
  call: Pick<FoldCall, 'argumentCount' | 'selection'>,
  entry: RecipeEntry | undefined,
  styleCompiler: StaticStyleSetCompiler,
  /** A directly-accessed slot of an inline `sva()` invocation. */
  slot?: string,
  /** Maximum complete selections an exact runtime decision table may inspect. */
  maxRecipeStates = DEFAULT_MAX_RECIPE_STATES,
): LowerResult => {
  if (!entry || entry === AMBIGUOUS) return { kind: 'decline', reason: 'unknown-recipe' }

  const { config } = entry

  // A slot recipe call itself returns an object. A direct `.slot` access is a string.
  if (config.slots !== undefined) {
    if (!Array.isArray(config.slots) || (slot !== undefined && !config.slots.includes(slot))) {
      return { kind: 'decline', reason: 'unsupported-shape' }
    }
  } else if (slot) {
    return { kind: 'decline', reason: 'unsupported-shape' }
  }

  // A config the extractor could not read is not an empty config. Folding against one emits
  // the bare identity of `{}` and deletes the call that would have produced real classes,
  // leaving the element permanently unstyled with nothing to report it.
  if (!config.base && !config.variants && !config.className) {
    return { kind: 'decline', reason: 'unknown-recipe' }
  }

  // `cvaFn` takes one selection. A second argument is a shape this does not model.
  if (call.argumentCount > 1) return { kind: 'decline', reason: 'unsupported-shape' }

  const selection: Dict = {}
  /** Variant → the source expression selecting it, for axes that stay runtime decisions. */
  const dynamicAxes = new Map<string, string>()
  /**
   * Variants whose expression could run something, in the order the source evaluates them.
   *
   * The text is kept, not just the key: a later property writing the same key replaces the
   * entry in `dynamicAxes`, and the expression recorded here would then never be emitted.
   */
  const effectful: Array<{ key: string; text: string }> = []

  if (call.argumentCount === 1) {
    const written: FoldSelection | undefined = call.selection
    if (!written) return { kind: 'decline', reason: 'dynamic' }

    /**
     * `input(variantProps)` — a selection the build cannot see inside.
     *
     * The complete StyleSets are knowable: the config declares every scalar value each axis
     * accepts. This is the shape a wrapper component takes, where variants are its public API
     * and therefore cannot be literals by definition.
     *
     * An identifier only. Each variant reads the binding again, and re-reading anything else —
     * a call, a property access — would evaluate it once per axis instead of once.
     *
     * Each read is optional. A recipe's props are optional in its type, and `badge(props)` with
     * `props` undefined selects the defaults, as `badge()` does; `props.tone` threw instead.
     */
    if (written.identifier !== undefined) {
      for (const key of Object.keys(config.variants ?? {})) {
        dynamicAxes.set(key, `${written.identifier}${optionalAccess(key)}`)
      }
    } else {
      // A spread contributes keys the build cannot enumerate, and a computed key is one it
      // cannot name — neither leaves a knowable set of classes.
      if (written.unenumerable || !written.properties) return { kind: 'decline', reason: 'dynamic' }

      for (const property of written.properties) {
        const { key } = property

        // `{ size: { base: 'sm', md: 'lg' } }`. Taken for a runtime value, an object reached the
        // decision table as `[object Object]`, matched no variant, and rendered the call without
        // one: no error, and no size.
        if (property.structured) {
          return {
            kind: 'decline',
            reason: 'dynamic',
            detail: `\`${key}\` is selected with an object, and a recipe call takes one variant per axis: write the condition inside the variant's styles`,
          }
        }

        // `{ tone }`, the idiomatic spelling. The name is the expression. Last write wins, as
        // the object literal itself would evaluate.
        if (property.shorthand) {
          dynamicAxes.set(key, property.text)
          delete selection[key]
          continue
        }

        // An expression that could run something has to survive into the output, so it takes
        // the runtime path whatever its value resolves to. Folding it to a literal would delete
        // the call as surely as declining to fold would have kept the whole recipe.
        if (!property.inert) {
          // `hasOwn`, for the same reason the value side of these tables uses it: a key of
          // `toString` or `__proto__` reaches `Object.prototype`.
          if (!Object.hasOwn(config.variants ?? {}, key)) return { kind: 'decline', reason: 'dynamic' }

          effectful.push({ key, text: property.text })
          dynamicAxes.set(key, property.text)
          delete selection[key]
          continue
        }

        if (property.literal !== undefined) {
          selection[key] = property.literal
          dynamicAxes.delete(key)
          continue
        }

        // Not a literal, but the analysis may still have resolved it exactly — a module
        // constant, an imported one, a helper's return value. A parameter resolves to nothing.
        if (property.resolved === undefined) {
          // Not resolvable, but still knowable: the config declares every value this variant
          // can take, so the choice among them is what ships.
          dynamicAxes.set(key, property.text)
          delete selection[key]
          continue
        }

        const value = property.resolved
        // A nested object is not a variant selection, and `undefined` is `compact`'s job.
        if (value !== null && typeof value === 'object') return { kind: 'decline', reason: 'dynamic' }

        selection[key] = value
        dynamicAxes.delete(key)
      }
    }
  }

  /**
   * Every expression that could run something has to reach the output carrying its own text.
   *
   * A later property writing the same key replaces it in `dynamicAxes` — `badge({ tone: a(),
   * tone: 'b' })` is last-wins for the *value*, but `a()` still runs, and emitting only the
   * literal would delete it. Duplicate keys are a type error in TypeScript; the fold does not
   * typecheck and does transform `.js`, so this is reachable.
   */
  const everyEffectSurvives = () => effectful.every(({ key, text }) => dynamicAxes.get(key) === text)

  const compiledSelection = (selected: Dict) => {
    if (Array.isArray(config.slots) && slot === undefined) {
      const slots: Record<string, string> = {}
      const classNames = new Set<string>()
      for (const slotName of config.slots) {
        const styles = styleCompiler.resolveRecipe(config as StyleSetRecipeConfig, selected, slotName)
        if (!styles) return undefined
        const className = styleCompiler.className(styles)
        slots[slotName] = className
        for (const token of className.split(' ')) if (token) classNames.add(token)
      }
      return { value: slots, classNames: [...classNames] }
    }

    const styles = styleCompiler.resolveRecipe(config as StyleSetRecipeConfig, selected, slot)
    if (!styles) return undefined
    const className = styleCompiler.className(styles)
    return { value: className, classNames: className.split(' ').filter(Boolean), styles }
  }

  if (dynamicAxes.size === 0) {
    if (!everyEffectSurvives()) return { kind: 'decline', reason: 'dynamic' }

    const compiled = compiledSelection(selection)
    if (!compiled) return { kind: 'decline', reason: 'dynamic' }
    if (typeof compiled.value === 'string') {
      return { kind: 'class', className: compiled.value, styles: compiled.styles }
    }
    return {
      kind: 'slots',
      expression: JSON.stringify(compiled.value),
      classNames: compiled.classNames,
      dynamic: false,
    }
  }

  // Terms are emitted in the config's variant order, so two properties that could both run
  // something would evaluate in that order rather than the source's. One effectful property
  // cannot be reordered against itself; more than one has to already agree.
  if (!everyEffectSurvives()) return { kind: 'decline', reason: 'dynamic' }

  if (effectful.length > 1) {
    const variantOrder = Object.keys(config.variants ?? {})
    const keys = effectful.map((entry) => entry.key)
    const reordered = [...keys].sort((a, b) => variantOrder.indexOf(a) - variantOrder.indexOf(b))
    if (reordered.join('\u0000') !== keys.join('\u0000')) return { kind: 'decline', reason: 'dynamic' }
  }

  // Axes the config declares no values for contribute nothing at runtime either — `cvaFn`
  // looks one up and skips it — so they are dropped rather than declining the call.
  for (const key of [...dynamicAxes.keys()]) {
    if (!Object.hasOwn(config.variants ?? {}, key)) dynamicAxes.delete(key)
  }

  if (dynamicAxes.size === 0) {
    const compiled = compiledSelection(selection)
    if (!compiled) return { kind: 'decline', reason: 'dynamic' }
    if (typeof compiled.value === 'string') {
      return { kind: 'class', className: compiled.value, styles: compiled.styles }
    }
    return {
      kind: 'slots',
      expression: JSON.stringify(compiled.value),
      classNames: compiled.classNames,
      dynamic: false,
    }
  }

  /**
   * The lookups the call compiles to, kept symbolic until an enclosing `cx()` has had the chance to
   * compose them. @see createRecipeLookups
   *
   * Each table is constant, so the fold declares it once at module scope for every call that reads
   * it. Written inside the call, it was built again on every render.
   */
  const axes = Object.keys(config.variants ?? {}).filter((key) => dynamicAxes.has(key))
  const expressions = axes.map((axis) => dynamicAxes.get(axis)!)
  const wholeSlots = Array.isArray(config.slots) && slot === undefined
  const lookups = createRecipeLookups({
    config: config as StyleSetRecipeConfig,
    selection,
    axes,
    styleCompiler,
    maxRecipeStates,
  })

  const map: DynamicStyleMap = {
    outputKind: wholeSlots ? 'slots' : 'class',
    compile(before = [], after = []) {
      const emitted = new Set<string>()
      const lookup: ClassLookup | SlotsLookup = wholeSlots
        ? lookups.slots(emitted)
        : lookups.classes(slot, before, after, emitted)
      // A table is an array; a slot object of nothing but strings is the object every call reaches.
      const constant =
        typeof lookup === 'string' ||
        (wholeSlots && !Array.isArray(lookup) && Object.values(lookup).every((value) => typeof value === 'string'))
      // A variant may not affect the requested slot, or every state may compile alike. When the
      // discarded selector expressions are inert, emit that string, or slot object, directly: no
      // helper import, lookup table, or runtime read is necessary. One that could run something
      // still has to, so it is read by a table with no decisions.
      const usesHelper = !(constant && effectful.length === 0)
      const table = JSON.stringify(typeof lookup === 'string' ? [~0, [], [lookup]] : lookup)
      return {
        source: (helper, tableRef) =>
          usesHelper ? `${helper}([${expressions.join(', ')}], ${tableRef(table)})` : JSON.stringify(lookup),
        classNames: [...emitted],
        staticClasses: typeof lookup === 'string' ? lookup : '',
        outputKind: wholeSlots ? 'slots' : 'class',
        usesHelper,
        // A table opens with its root's index, and segments with a constant or a table.
        segmented: Array.isArray(lookup) && typeof lookup[0] !== 'number',
      }
    },
  }

  return { kind: 'dynamic-style', map }
}
