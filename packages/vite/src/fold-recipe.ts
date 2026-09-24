import type { FoldAnalysis, FoldCall, FoldSelection } from '@bamboocss/native-extractor'
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

    configs.set(name, { config })
  }

  return configs
}

/** Pick a complete precompiled StyleSet for one or more runtime recipe axes. */
export const RECIPE_MAP_HELPER = 'cvaMap'

/** Guard the exact compiler against accidentally materialising an enormous Cartesian product. */
export const DEFAULT_MAX_RECIPE_STATES = 65_536

/** What `recipe.splitVariantProps` calls, reached directly once the call is lowered. */
export const SPLIT_PROPS_HELPER = 'splitProps'

/** Marker for a binding the fold must never resolve — declared twice, or unresolvable. */
export const AMBIGUOUS: RecipeEntry = Object.freeze({ config: {} })

/** `.size`, or `["x-large"]` when the variant is not a valid identifier. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const propertyAccess = (key: string) => (IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`)

/** Where a helper import can be written, and under what name the call site can reach it. */
export interface HelperInsert {
  pos: number
  names: string[]
  module?: string
}

/**
 * Make a generated compile helper callable at this call site, by whatever name the file gives it.
 *
 * Unlike `cx`, an inline recipe's callee is a local binding, so there is nothing to match —
 * the host here is any import of the generated css module, which a file defining a recipe
 * necessarily has, since `cva` came from it.
 */
export const ensureRecipeHelperImport = (
  imported: string,
  analysis: Pick<FoldAnalysis, 'imports' | 'moduleScopeNames'>,
  /** Helper names a nested scope around the call site rebinds. */
  shadowedHere: readonly string[],
  isBambooCssModule: (mod: string) => boolean,
  isGeneratedCssModule: (mod: string) => boolean,
  /**
   * The specifier to write a *new* import declaration with, when the file has none to extend.
   *
   * Only supplied for a recipe declared in another module, which is the case where the premise
   * above stops holding: such a file imports the binding, not the factory, so it need not
   * import the css module at all.
   */
  newImportModule?: string,
  /**
   * Given an import specifier in this file, where the helper could be imported from instead —
   * a project importing `styled-system/css/cva.js` rather than the barrel has no declaration
   * this can extend, because `cva.js` does not export the helper.
   */
  helperModuleFromSubpath?: (mod: string) => string | undefined,
): { name: string; insert?: HelperInsert } | undefined => {
  let host: FoldAnalysis['imports'][number] | undefined
  let subpathModule: string | undefined

  for (const declaration of analysis.imports) {
    if (declaration.typeOnly) continue

    for (const named of declaration.specifiers) {
      if (named.typeOnly) continue

      if (named.imported === imported) {
        // Somebody else's helper, or one shadowed here, is not the one this calls.
        if (!isBambooCssModule(declaration.module)) return undefined
        return shadowedHere.includes(named.local) ? undefined : { name: named.local }
      }
    }

    if (!host && isGeneratedCssModule(declaration.module) && declaration.specifiers.length > 0) host = declaration
    if (!subpathModule) subpathModule = helperModuleFromSubpath?.(declaration.module)
  }

  // A subpath spelling is only reached for when there is no barrel to extend, so a file that
  // imports both keeps its existing declaration rather than growing a second one.
  const fallbackModule = newImportModule ?? subpathModule

  if (!host && !fallbackModule) return undefined

  // A module-scope binding of this name would collide with the one being added, and one in
  // scope at the call site would be reached instead of it.
  if (analysis.moduleScopeNames.includes(imported)) return undefined
  if (shadowedHere.includes(imported)) return undefined

  if (!host) {
    // After the last import rather than at the top of the file. A directive prologue —
    // `'use client'`, which is exactly what a component file calling a recipe tends to open
    // with — stops being a directive the moment a statement precedes it.
    const anchor = analysis.imports.at(-1)
    if (!anchor) return undefined

    return { name: imported, insert: { pos: anchor.span.end, names: [imported], module: fallbackModule } }
  }

  const last = host.specifiers.at(-1)
  if (!last) return undefined

  return { name: imported, insert: { pos: last.end, names: [imported] } }
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
  | { kind: 'decline'; reason: 'dynamic' | 'unsupported-shape' | 'unknown-recipe' }

export interface CompiledStyleMap {
  expression: string
  classNames: string[]
  staticClasses: string
  outputKind: 'class' | 'slots'
  /** Whether `expression` actually calls `cvaMap`; reduced constant maps do not. */
  usesHelper: boolean
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
     */
    if (written.identifier !== undefined) {
      for (const key of Object.keys(config.variants ?? {})) {
        dynamicAxes.set(key, `${written.identifier}${propertyAccess(key)}`)
      }
    } else {
      // A spread contributes keys the build cannot enumerate, and a computed key is one it
      // cannot name — neither leaves a knowable set of classes.
      if (written.unenumerable || !written.properties) return { kind: 'decline', reason: 'dynamic' }

      for (const property of written.properties) {
        const { key } = property

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
   * Compile the finite recipe state space into a reduced decision table.
   *
   * Each leaf is a *complete* final StyleSet. This matters for declarations overridden by
   * variants and compounds: selecting independent per-axis atoms would put both values in
   * the utility layer and let stylesheet order, rather than the recipe's merge order, pick
   * the winner. Complete leaves retain the same precedence while sharing their atoms with
   * every `css()` and recipe in the build.
   *
   * `undefined` is its own edge because it restores a default variant. `null` and any
   * undeclared value take the miss edge and explicitly suppress that default. Declared
   * values use string keys, matching JavaScript's property-key coercion in the recipe
   * runtime. A flat alternating key/value array avoids the special `__proto__` semantics
   * of an object literal.
   */
  const axes = Object.keys(config.variants ?? {}).filter((key) => dynamicAxes.has(key))
  const stateCount = axes.reduce(
    (product, axis) => product * (Object.keys(config.variants?.[axis] ?? {}).length + 2),
    1,
  )
  if (stateCount > maxRecipeStates) {
    throw new Error(
      `Static recipe compilation would inspect ${stateCount.toLocaleString('en-US')} selections across ` +
        `${axes.length} runtime variant axes, above maxRecipeStates=${maxRecipeStates.toLocaleString('en-US')}. ` +
        `Make one or more axes statically known, split the recipe, or raise the limit explicitly.`,
    )
  }
  type SlotClasses = Record<string, string>
  type Leaf = string | SlotClasses
  type Ref = number

  const expressions = axes.map((axis) => dynamicAxes.get(axis)!)
  const wholeSlots = Array.isArray(config.slots) && slot === undefined

  const map: DynamicStyleMap = {
    outputKind: wholeSlots ? 'slots' : 'class',
    compile(before = [], after = []) {
      const nodes: Array<[Ref, Ref, Array<string | Ref>]> = []
      const nodeByShape = new Map<string, number>()
      const leaves: Leaf[] = []
      const leafByShape = new Map<string, number>()
      const emittedClasses = new Set<string>()

      const leaf = (dynamicSelection: Dict): Ref => {
        const selected = { ...selection, ...dynamicSelection }

        if (wholeSlots) {
          const compiled = compiledSelection(selected)
          if (!compiled || typeof compiled.value === 'string') return internLeaf('')
          for (const token of compiled.classNames) emittedClasses.add(token)
          return internLeaf(compiled.value)
        }

        const styles = styleCompiler.resolveRecipe(config as StyleSetRecipeConfig, selected, slot)
        if (!styles) return internLeaf('')
        const className = styleCompiler.className(styleCompiler.compose(...before, styles, ...after))
        for (const token of className.split(' ')) if (token) emittedClasses.add(token)
        return internLeaf(className)
      }

      // Leaves are referenced as bitwise-complemented indices (-1, -2, ...), while node
      // indices are non-negative. Complete class strings therefore appear once even when
      // many variant combinations resolve to the same StyleSet.
      function internLeaf(value: Leaf): Ref {
        const shape = JSON.stringify(value)
        const known = leafByShape.get(shape)
        if (known !== undefined) return ~known
        const id = leaves.length
        leaves.push(value)
        leafByShape.set(shape, id)
        return ~id
      }

      const buildNode = (index: number, dynamicSelection: Dict): Ref => {
        if (index === axes.length) return leaf(dynamicSelection)

        const axis = axes[index]!
        const values = Object.keys(config.variants?.[axis] ?? {})
        const miss = buildNode(index + 1, { ...dynamicSelection, [axis]: null })
        const absentSelection = { ...dynamicSelection }
        delete absentSelection[axis]
        const absent = buildNode(index + 1, absentSelection)

        const byValue: Array<string | Ref> = []
        for (const value of values) {
          byValue.push(value, buildNode(index + 1, { ...dynamicSelection, [axis]: value }))
        }

        const refs = [miss, absent, ...byValue.filter((_, valueIndex) => valueIndex % 2 === 1)] as Ref[]
        if (refs.every((ref) => ref === refs[0])) return refs[0]!

        const node: [Ref, Ref, Array<string | Ref>] = [miss, absent, byValue]
        const shape = JSON.stringify(node)
        const known = nodeByShape.get(shape)
        if (known !== undefined) return known

        const id = nodes.length
        nodes.push(node)
        nodeByShape.set(shape, id)
        return id
      }

      const root = buildNode(0, {})
      const staticLeaf = root < 0 ? leaves[~root] : undefined
      // A variant may not affect the requested slot (or every state may reduce to the
      // same complete StyleSet). When the discarded selector expressions are inert, emit
      // that leaf directly: no helper import, lookup table, or runtime read is necessary.
      const expression =
        root < 0 && effectful.length === 0
          ? JSON.stringify(staticLeaf)
          : `${RECIPE_MAP_HELPER}([${expressions.join(', ')}], ${JSON.stringify(nodes)}, ${JSON.stringify(leaves)}, ${root})`
      return {
        expression,
        classNames: [...emittedClasses],
        staticClasses: typeof staticLeaf === 'string' ? staticLeaf : '',
        outputKind: wholeSlots ? 'slots' : 'class',
        usesHelper: !(root < 0 && effectful.length === 0),
      }
    },
  }

  return { kind: 'dynamic-style', map }
}
