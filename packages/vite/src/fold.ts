import { resolveTsPathPattern } from '@bamboocss/config/ts-path'
import type { Context } from '@bamboocss/core'
import type { FoldAnalysis, FoldCall, FoldCxArgument, FoldRefusal, FoldSpan } from '@bamboocss/native-extractor'
import { BambooError, viewTransitionClassName } from '@bamboocss/shared'
import type { Dict } from '@bamboocss/types'
import MagicString from 'magic-string'
import { dirname, relative, resolve as resolvePath } from 'node:path'
import {
  AMBIGUOUS,
  collectRecipeConfigs,
  ensureRecipeHelperImport,
  type HelperInsert,
  lowerRecipeCall,
  RECIPE_MAP_HELPER,
  SPLIT_PROPS_HELPER,
  type DynamicStyleMap,
  type RecipeConfig,
  type RecipeEntry,
} from './fold-recipe'
import { createRuntimeToken, createRuntimeTokenValue } from './runtime-css'
import type { StaticStyleSetCompiler } from './style-set'
import { UnwritableStyleError } from './unwritable-style'

/**
 * Why a call site could not be compiled. Surfaced through diagnostics so a user can tell
 * which part of the finite-style contract a source shape violates.
 */
export type SkipReason =
  | 'dynamic' // some part of the arguments could not be resolved at build time
  | 'raw-call' // `css.raw(...)` returns a style object, not a class string
  | 'recipe-call' // a recipe call whose selection the build could not represent finitely
  | 'unsupported-kind' // a recognized API/member whose result shape is not compilable
  | 'not-imported' // the callee is not a Bamboo import — a local function of the same name
  | 'no-call-expression' // could not locate the enclosing call to replace
  | 'overlapping' // nested inside another fold
  | 'unresolved-token' // `token(...)` resolves to no usable string, so the call has to stay
  | 'runtime-binding' // a bamboo import still referenced after the rewrite, whoever left it
  | 'compile-failed' // compilation threw on this module, so nothing about it was established
  | 'opaque-composition' // a `cx()` joining compiled atoms with a class the build cannot see
  | 'unknown-condition' // a nested key that is neither a property nor a condition, so no rule has its class
  | 'empty-value' // a declaration whose value is an empty string, which CSS has no value for

export interface FoldedCall {
  name: string
  /**
   * What the call collapsed to.
   *
   * `class` is every style surface: a class string bound for a `class` attribute. `value`
   * is `token()`, which resolves to a CSS *value* (`var(--colors-red-300)`). The two are
   * not interchangeable, and a consumer that checks folded classes against the emitted
   * stylesheet has to skip the latter — there is no rule named after a variable reference.
   */
  kind: 'class' | 'slots' | 'value' | 'definition'
  /** The class string resolved outright, empty when the whole call lowered to ternaries. */
  className: string
  /**
   * Every class literal the replacement emits, including both arms of each ternary — so a
   * consumer checking that folded classes have CSS behind them sees the branches too,
   * which `className` alone does not carry.
   */
  classNames: string[]
  /**
   * Of `classNames`, those a `cx()` passed through as written — `cx('external', css(…))` — which
   * are somebody else's to give a rule, not Bamboo's.
   */
  literalClassNames?: string[]
  /**
   * The literal written in place of the call, for a `value` fold: a string, or the number a
   * `token.value()` returns for one. Absent where the call names no token and its result is tested
   * or defaulted: `undefined` is written instead.
   */
  value?: string | number
  start: number
  end: number
}

export interface SkippedCall {
  name: string
  reason: SkipReason
  start: number
  end: number
  /**
   * For `dynamic`: the code the evaluator refused, when that is why. The call site alone does
   * not show it — the statement is in a helper, perhaps in another module, and a write to a
   * binding may be anywhere in its module.
   */
  refusal?: FoldRefusal
  /**
   * What to change, where the reason does not say: for `unknown-condition` the key and what it
   * was probably meant to be, for `empty-value` the property and what to write instead, for a
   * `recipe-call` or a `dynamic` call the shape it cannot take.
   */
  detail?: string
}

export interface FoldResult {
  code: string
  /** Null when nothing was folded, so callers can return the original module untouched. */
  map: ReturnType<MagicString['generateMap']> | null
  folded: FoldedCall[]
  skipped: SkippedCall[]
  /**
   * Other modules a folded value came from.
   *
   * Values resolve across files, so `css(importedStyles, { … })` folds to a string that
   * depends on a file this module only imports. Without registering that edge, editing the
   * imported module leaves a stale literal behind in every consumer. Bundlers need these as
   * watch files.
   */
  dependencies: string[]
}

export interface FoldOptions {
  ctx: Context
  code: string
  /** What the native analysis established about `code`. */
  analysis: FoldAnalysis
  filePath: string
  /** Compile every style surface to the shared symbolic/atomic representation. */
  styleCompiler: StaticStyleSetCompiler
  /** Maximum finite recipe selections the static compiler may enumerate for one call. */
  maxRecipeStates?: number
  /**
   * Also report bamboo bindings the rewrite left behind, whatever the skip ledger says.
   *
   * The ledger holds only calls something recognised, so it answers "of the calls I looked
   * at, which survived" — and a guarantee built on it is worth exactly what the recogniser
   * is. This asks what the guarantee actually claims: after the rewrite, is anything from a
   * bamboo module still referenced? Requires the analysis to have collected references.
   */
  reportSurvivors?: boolean
}

/**
 * The skip reasons that leave a `css()`-family call in the output.
 *
 * `overlapping` is handled by the enclosing fold, and `not-imported` is somebody else's
 * function of the same name — neither leaves a call of ours.
 */
export const SURVIVES_TO_RUNTIME = new Set<SkipReason>([
  'dynamic',
  // The `cx()` half of `dynamic`, told apart only so it can be reported differently. It has to
  // be here for the same reason `dynamic` is: the range it covers suppresses a `runtime-binding`
  // report for a watched binding standing among the call's arguments.
  'opaque-composition',
  // Not a declined call at all: a binding the rewrite left referenced. It is the one entry
  // here that does not depend on something having recognised a call.
  'runtime-binding',
  'raw-call',
  'unsupported-kind',
  'no-call-expression',
  'unresolved-token',
  // A module the fold threw on. Unknown has to read as survives: the guarantee is that
  // *nothing* still calls `css()`, and a module nobody checked cannot support it.
  'compile-failed',
  'unknown-condition',
  'empty-value',
])

/**
 * Imports a surviving reference to is not a failure.
 *
 * These are what the compiler itself writes; all live in `cx` and pull no engine, so a
 * reference to one is the fold having worked.
 */
const PERMITTED_BINDINGS = new Set(['cx', RECIPE_MAP_HELPER, SPLIT_PROPS_HELPER])

const LEADING_RELATIVE = /^(?:\.\.?\/)+/
const TRAILING_SLASH = /\/$/
const MODULE_EXTENSION = /\.[mc]?[jt]sx?$/
const TRAILING_INDEX = /\/index$/

/**
 * What the build says of a style it cannot write, as the reason a call was not compiled: a value
 * holding the retired `token(path, fallback)` form or a curly reference, which `bamboo cssgen` names
 * with what to write instead. The compiler said `css() — dynamic` of it, and to make its values
 * finite, of a value written as a literal. The first paragraph names both, and fits the line the
 * call is reported on.
 */
const styleErrorDetail = (error: unknown) =>
  error instanceof BambooError ? { detail: error.message.split('\n\n')[0]! } : undefined

const hasStyles = (data: unknown[]): data is Dict[] =>
  data.length > 0 && data.every((entry) => entry != null && typeof entry === 'object')

/** `recipe(props).slot` names a slot only when the recipe declares one by that name. */
const slotsOf = (config: RecipeConfig | undefined) => (Array.isArray(config?.slots) ? (config.slots as string[]) : [])

/**
 * The most combinations of answers a `cx()` holding conditions is compiled to.
 *
 * Each is written out whole, as one arm of a ternary, so what the call compiles to doubles with each
 * independent condition: five are thirty-two. Past this the call stays the runtime join it was
 * written as, and a join does not merge: where two arguments set one property, the browser applies
 * whichever rule the stylesheet holds later, not the later argument. At eight, a variant component
 * with four conditions — a state, two variants and a flag — was left to that.
 */
export const MAX_CX_COMBINATIONS = 32

/** One `cx()` argument the fold can compose, in the order it is written. */
type CxPart<C> =
  | { kind: 'style'; candidate: C }
  | { kind: 'dynamic'; candidate: C }
  | { kind: 'class'; value: string; candidate?: C }

/** A condition among a `cx()` call's arguments, with what each answer contributes. */
interface CxBranch<C> {
  kind: 'branch'
  test: FoldSpan
  then: CxItem<C>[]
  otherwise: CxItem<C>[]
}

type CxItem<C> = CxPart<C> | CxBranch<C>

/** Every part `items` hold, in both answers of each condition. */
const flattenCxItems = <C>(items: CxItem<C>[]): CxPart<C>[] =>
  items.flatMap((item) =>
    item.kind === 'branch' ? [...flattenCxItems(item.then), ...flattenCxItems(item.otherwise)] : [item],
  )

/** How many combinations of answers `items` can produce, counting no further than past `limit`. */
const countCxCombinations = <C>(items: CxItem<C>[], limit: number): number => {
  const index = items.findIndex((item) => item.kind === 'branch')
  if (index < 0) return 1
  const branch = items[index] as CxBranch<C>
  const rest = items.slice(index + 1)
  const then = countCxCombinations([...branch.then, ...rest], limit)
  if (then > limit) return then
  return then + countCxCombinations([...branch.otherwise, ...rest], limit - then)
}

/**
 * A ternary choosing between the class strings `items` compose to, one per combination of answers.
 *
 * Each condition is asked where its argument asked it, and only on the path that reached it: the
 * conditions after it are asked again in each of its answers, as they would have been once in the
 * one taken. So every condition runs exactly when, and as often as, it did in the call.
 */
const writeCxBranches = <C>(
  items: CxItem<C>[],
  leaf: (parts: CxPart<C>[]) => string,
  testSource: (span: FoldSpan) => string,
  before: CxPart<C>[] = [],
): string => {
  const index = items.findIndex((item) => item.kind === 'branch')
  if (index < 0) return JSON.stringify(leaf([...before, ...(items as CxPart<C>[])]))
  const branch = items[index] as CxBranch<C>
  const rest = items.slice(index + 1)
  const prefix = [...before, ...(items.slice(0, index) as CxPart<C>[])]
  const answer = (answered: CxItem<C>[]) => {
    const written = writeCxBranches([...answered, ...rest], leaf, testSource, prefix)
    return written.startsWith('"') ? written : `(${written})`
  }
  return `(${testSource(branch.test)}) ? ${answer(branch.then)} : ${answer(branch.otherwise)}`
}

/**
 * The class string one combination of `cx()` arguments composes to: their declarations merged,
 * later ones winning, and the merged atoms written where the first style stood among the classes
 * passed through as written.
 */
const composeCxParts = <C extends { styleSet?: Dict }>(parts: CxPart<C>[], styleCompiler: StaticStyleSetCompiler) => {
  const styles = parts.flatMap((part) =>
    part.kind === 'style' && part.candidate.styleSet ? [part.candidate.styleSet] : [],
  )
  const compiled = styles.length > 0 ? styleCompiler.className(styleCompiler.compose(...styles)) : ''
  const classParts: string[] = []
  let wroteCompiled = false
  for (const part of parts) {
    if (part.kind === 'class') {
      if (part.value) classParts.push(part.value)
      continue
    }
    if (!wroteCompiled && compiled) {
      classParts.push(compiled)
      wroteCompiled = true
    }
  }
  return classParts.join(' ')
}

export const foldSource = (options: FoldOptions): FoldResult => {
  const { ctx, code, analysis, styleCompiler, maxRecipeStates, reportSurvivors } = options

  const runtimeToken = createRuntimeToken(ctx)
  const runtimeTokenValue = createRuntimeTokenValue(ctx)

  /**
   * Does this specifier name a module that exports the css API, exactly?
   *
   * `ImportMap.match` is substring-based, which is right for deciding whether a call is
   * bamboo's and wrong for deciding whether a module can be imported *from*:
   * `styled-system/css/css` matches while exporting no `cx`. So the comparison is equality,
   * after resolving a tsconfig path alias the way `ImportMap.match` does and stripping an
   * extension or a trailing `/index`, which bamboo's own output makes a file spell.
   */
  const cssModules = ctx.imports.matchers.css?.mods ?? []

  /**
   * The generated css module, the only one whose exports are known. A configured
   * `importMap.css` points at the user's own wrapper, which need not re-export `cx`.
   */
  const generatedCssModule = [ctx.imports.outdir, 'css'].join('/')
  const pathMappings = ctx.conf.tsOptions?.pathMappings
  const trim = (value: string) =>
    value
      .replaceAll('\\', '/')
      .replace(LEADING_RELATIVE, '')
      .replace(TRAILING_SLASH, '')
      .replace(MODULE_EXTENSION, '')
      .replace(TRAILING_INDEX, '')

  const matchesModule = (mod: string, entries: string[]) => {
    const candidates = [mod]
    if (pathMappings) {
      const resolved = resolveTsPathPattern(pathMappings, mod)
      if (resolved) candidates.push(resolved)
    }
    return candidates.some((candidate) => {
      const normalized = trim(candidate)
      return entries.some((entry) => {
        const target = trim(entry)
        return normalized === target || normalized.endsWith(`/${target}`)
      })
    })
  }

  const isBambooCssModule = (mod: string) => matchesModule(mod, cssModules)
  const isGeneratedCssModule = (mod: string) => matchesModule(mod, [generatedCssModule])

  /**
   * Where the compiler's helpers can be imported from, for a file that imports the generated
   * css module by *subpath* — `styled-system/css/cva.js` exports `cva`, not `cvaMap`, so the
   * sibling `cx` module is the host, spelled with the caller's own prefix and extension.
   */
  const helperModuleFromSubpath = (mod: string): string | undefined => {
    const normalized = mod.replaceAll('\\', '/')
    const marker = '/css/'
    const at = normalized.lastIndexOf(marker)
    if (at < 0) return undefined

    const prefix = normalized.slice(0, at + marker.length - 1)
    if (!isGeneratedCssModule(prefix)) return undefined

    const rest = normalized.slice(at + marker.length)
    if (!rest || rest.includes('/')) return undefined

    const dot = rest.lastIndexOf('.')
    const extension = dot > 0 ? rest.slice(dot) : ''
    if (rest === `cx${extension}`) return undefined

    return `${prefix}/cx${extension}`
  }

  /** The generated css entry as spelled beside an imported config recipe. */
  const configRecipeCssSpecifier = (binding: string): string => {
    for (const declaration of analysis.imports) {
      if (declaration.typeOnly) continue
      const namesBinding = declaration.specifiers.some((named) => !named.typeOnly && named.local === binding)
      if (!namesBinding) continue

      const mod = declaration.module.replaceAll('\\', '/')
      const marker = '/recipes'
      const at = mod.lastIndexOf(marker)
      if (at >= 0) return `${mod.slice(0, at)}/css`
    }
    return generatedCssModule
  }

  /** A relative specifier learnt from another module, expressed from the module being folded. */
  const rebaseSpecifier = (specifier: string, declaringPath: string, consumingPath: string): string | undefined => {
    if (!specifier.startsWith('.')) return specifier
    const absolute = resolvePath(dirname(declaringPath), specifier)
    const rebased = relative(dirname(consumingPath), absolute).replaceAll('\\', '/')
    if (!rebased) return undefined
    return rebased.startsWith('.') ? rebased : `./${rebased}`
  }

  const folded: FoldedCall[] = []
  const skipped: SkippedCall[] = []

  /** Modules other than this one whose declarations a folded recipe call selected. */
  const foreignDependencies = new Set<string>()

  // The module's own recipes, then the ones it imports — by the name the file bound.
  const recipeConfigs = collectRecipeConfigs(analysis)
  /** The specifier a call's helper import is written with when the file has none to extend. */
  const helperModules = new Map<string, string | undefined>()
  for (const imported of analysis.importedRecipes) {
    if (recipeConfigs.has(imported.local)) continue
    const config = imported.config as RecipeConfig | undefined
    recipeConfigs.set(
      imported.local,
      config && typeof config === 'object'
        ? { config, filePath: imported.filePath, dependencies: imported.dependencies }
        : AMBIGUOUS,
    )
    const cssSpecifier = imported.declaringImports.find((specifier) => isGeneratedCssModule(specifier))
    helperModules.set(
      imported.local,
      cssSpecifier ? rebaseSpecifier(cssSpecifier, imported.filePath, options.filePath) : undefined,
    )
  }

  interface Candidate {
    call: FoldCall
    name: string
    /** Symbolic declarations this candidate contributes, before class allocation. */
    styleSet?: Dict
    className?: string
    /** Every class literal emitted, when that is more than `className` — see FoldedCall. */
    classNames?: string[]
    /** Of `classNames`, the ones passed through as written — see FoldedCall. */
    literalClassNames?: string[]
    /** A finite runtime recipe lookup, intentionally unallocated until semantic `cx()`. */
    styleMap?: DynamicStyleMap
    /** Local name of the generated map helper, when the import was aliased. */
    mapHelperName?: string
    /** Set once an enclosing semantic composition owns this candidate. */
    subsumed?: boolean
    /**
     * Reported already, as `unknown-condition` or `empty-value`. Nothing is emitted for it, and a
     * `cx()` holding it adds no report of its own.
     */
    failed?: boolean
    /** The replacement evaluates to a slot-name → class-string object. */
    outputKind?: 'slots'
    /** Replacement text for a compiled call, in place of a bare class string. */
    replacement?: string
    /** The resolved value, for a `token()` call. Its presence, or `missing`, is what marks one. */
    value?: string | number
    /** A guarded `token()` call naming no token, compiled to the `undefined` it returns. */
    missing?: true
    /** Bindings to add to an existing import, by name so duplicates can be dropped. */
    insert?: HelperInsert
    /** Modules another module's recipe was read from, or through. */
    foreign?: readonly string[]
    start: number
    end: number
  }

  const candidates: Candidate[] = []
  /**
   * `token.value()` calls whose token holds what no literal stands in for, neither a string nor a
   * finite number. Not candidates, since nothing is written for one: a style compiled around it takes
   * it with it, and where nothing does, it stays and is reported.
   */
  const unwritableTokens: Array<{ name: string; start: number; end: number }> = []
  const seenRanges = new Set<string>()
  const recipeDefinitions: Array<{ name: string; factory: string; start: number; end: number }> = []

  /**
   * What `allocate` found that no rule can be written for — a key that is neither a property nor a
   * condition, or an empty value — when that is why it threw. Anything else it throws is not this
   * call's to report.
   */
  const unwritableIn = (allocate: () => unknown) => {
    try {
      allocate()
    } catch (error) {
      if (error instanceof UnwritableStyleError) return error
      throw error
    }
    return undefined
  }

  const reportUnwritable = (name: string, start: number, end: number, error: UnwritableStyleError) => {
    skipped.push({ name, reason: error.reason, start, end, detail: error.message })
  }

  /**
   * Report what no rule can be written for, found composing `parts` in `composition`, by the parts
   * it is written in.
   *
   * Composing is where the key surfaces, but a `cx()` is rarely where it is written. Each part that
   * holds one on its own reports it and is not emitted; the composition reports it only when none
   * does. That is a fallback: the one case known to reach it, a mixin written out only once its part
   * was no longer alone, is now written out alone too. Run only once composing has thrown, so naming
   * the parts again costs nothing on the way to a successful build.
   */
  const reportComposing = (
    composition: { name: string; start: number; end: number },
    parts: Candidate[],
    error: UnwritableStyleError,
  ) => {
    let reported = false
    for (const part of parts) {
      const unknown = unwritableIn(() =>
        part.styleMap ? part.styleMap.compile() : styleCompiler.className(part.styleSet ?? {}),
      )
      if (!unknown) continue
      reportUnwritable(part.name, part.start, part.end, unknown)
      part.failed = true
      reported = true
    }
    if (!reported) reportUnwritable(composition.name, composition.start, composition.end, error)
  }

  for (const call of analysis.calls) {
    const { kind } = call
    const name = kind === 'tokenValue' ? 'token' : call.name
    const start = call.span.start
    const end = call.span.end

    // Recipe factories are a compile-time declaration form. Once the config has been
    // extracted, the executable factory and its style object have no runtime meaning.
    if (kind === 'cva' || kind === 'sva') {
      const entry = call.binding ? recipeConfigs.get(call.binding) : undefined
      if (call.binding && entry && entry !== AMBIGUOUS) {
        recipeDefinitions.push({ name: call.binding, factory: name, start, end })
      }
      continue
    }

    if (kind === 'cx') continue

    if (call.notImported) {
      skipped.push({ name, reason: 'not-imported', start, end })
      continue
    }

    // `token()` resolves to a CSS value rather than a class, so it takes its own path.
    // `token.value()` shares it: every guard is the same question, and only the end differs.
    if (kind === 'token' || kind === 'tokenValue') {
      const rangeKey = `${start}:${end}`
      if (seenRanges.has(rangeKey)) continue
      seenRanges.add(rangeKey)

      const wantsValue = kind === 'tokenValue'
      // The reference side accepts two spellings: a bare callee, and `ns.token(path)`. Any
      // other member named there is a method of somebody's object, not ours.
      if (!wantsValue && call.calleeProperty !== undefined) {
        skipped.push({ name, reason: 'unsupported-kind', start, end })
        continue
      }

      // The path has to be one resolved literal: `exact` covers the first argument, which a
      // conditional would have left undecided, and nothing else. Later entries in `data` are
      // the trailing arguments, judged below by what they are rather than what they evaluate to.
      if (!call.exact || typeof call.data[0] !== 'string') {
        skipped.push({ name, reason: 'dynamic', start, end, ...(call.refusal && { refusal: call.refusal }) })
        continue
      }

      // Everything after the path is dead once the token resolves, but only inert literal
      // arguments are provably free to delete.
      if (!call.trailingArgumentsInert) {
        skipped.push({ name, reason: 'dynamic', start, end })
        continue
      }

      const path = call.data[0] as string
      const value = wantsValue ? runtimeTokenValue(path) : runtimeToken(path)
      if (value === undefined) {
        const unresolved = ctx.utility.unresolvedTokenCall(wantsValue ? 'token.value' : 'token', path)
        // Tested or defaulted, `token(path) ?? '#fff'`, a path naming no token is a case its
        // author handled: the runtime returns `undefined` for it, and so does the compiled call.
        if (unresolved && call.guarded) {
          candidates.push({ call, name, start, end, missing: true })
          continue
        }
        // A `token.value()` whose token holds what no literal stands in for names one. Inside a
        // style that compiles, it goes with the style, whose value the analysis read; only where
        // nothing replaces it does it stay, and is reported.
        if (!unresolved) {
          unwritableTokens.push({ name, start, end })
          continue
        }
        // A path naming no token, in the build's own words for it — without what the call
        // returns, which nothing here reads.
        skipped.push({
          name,
          reason: 'unresolved-token',
          start,
          end,
          detail: ctx.utility.explainUnresolvedTokenCall(unresolved, { consequence: false }),
        })
        continue
      }

      candidates.push({ call, name, start, end, value })
      continue
    }

    // `keyframes()` returns the name of its block, which the analysis computed from the stops by
    // the same function that named the block the stylesheet writes.
    if (kind === 'keyframes') {
      const rangeKey = `${start}:${end}`
      if (seenRanges.has(rangeKey)) continue
      seenRanges.add(rangeKey)

      if (call.calleeProperty !== undefined) {
        skipped.push({ name, reason: 'unsupported-kind', start, end })
        continue
      }

      if (call.value === undefined) {
        skipped.push({
          name,
          reason: 'dynamic',
          start,
          end,
          ...(call.refusal
            ? { refusal: call.refusal }
            : { detail: 'the name it returns is a hash of its stops, so they have to be known at build time' }),
        })
        continue
      }

      candidates.push({ call, name, start, end, value: call.value })
      continue
    }

    if (kind === 'cva-call' || kind === 'recipe') {
      const rangeKey = `${start}:${end}`
      if (seenRanges.has(rangeKey)) continue
      seenRanges.add(rangeKey)

      // `recipe.raw()` returns style data, not the selected class value. It is a live
      // runtime API and cannot be mistaken for an invocation of the recipe itself.
      //
      // Only a config recipe is reported here. An inline recipe's binding is erased once its
      // calls compile, so a `.raw` read of one is a read of a value that no longer exists —
      // the binding report below names it as that, and a `raw-call` range here would hide it.
      if (call.raw) {
        if (kind === 'recipe') skipped.push({ name, reason: 'raw-call', start, end })
        continue
      }

      if (kind === 'recipe' && !recipeConfigs.has(name)) {
        // Config recipes expose the same finite variant map as inline declarations. Their
        // configured class name is metadata only; selected authored styles resolve through the
        // shared StyleSet compiler below.
        const config = ctx.recipes.getConfig(name) as RecipeConfig | undefined
        if (config) {
          recipeConfigs.set(name, { config })
          helperModules.set(name, configRecipeCssSpecifier(name))
        }
      }

      const entry = recipeConfigs.get(name)
      const declaredSlots = slotsOf(entry?.config)
      const slot = call.slot !== undefined && declaredSlots.includes(call.slot) ? call.slot : undefined
      const replaceEnd = slot !== undefined ? (call.slotEnd ?? end) : end

      let lowered: ReturnType<typeof lowerRecipeCall>
      try {
        lowered = lowerRecipeCall(call, entry, styleCompiler, slot, maxRecipeStates)
      } catch (error) {
        if (!(error instanceof UnwritableStyleError)) throw error
        reportUnwritable(name, start, end, error)
        candidates.push({ call, name, start, end: replaceEnd, failed: true })
        continue
      }
      const helperFor = (helper: string) =>
        ensureRecipeHelperImport(
          helper,
          analysis,
          call.shadowedHelpers,
          isBambooCssModule,
          isGeneratedCssModule,
          helperModules.get(name),
          helperModuleFromSubpath,
        )
      const foreign = entry && entry !== AMBIGUOUS ? entry.dependencies : undefined

      if (lowered.kind === 'dynamic-style') {
        const helper = helperFor(RECIPE_MAP_HELPER)
        if (helper) {
          candidates.push({
            call,
            name,
            start,
            end: replaceEnd,
            className: '',
            classNames: [],
            styleMap: lowered.map,
            mapHelperName: helper.name,
            insert: helper.insert,
            outputKind: lowered.map.outputKind === 'slots' ? 'slots' : undefined,
            foreign,
          })
          continue
        }
        skipped.push({ name, reason: 'recipe-call', start, end })
        continue
      }

      if (lowered.kind === 'slots') {
        const helper = lowered.helper ? helperFor(lowered.helper) : undefined
        if (!lowered.helper || helper) {
          const replacement =
            lowered.helper && helper && helper.name !== lowered.helper
              ? lowered.expression.replaceAll(`${lowered.helper}(`, `${helper.name}(`)
              : lowered.expression
          candidates.push({
            call,
            name,
            start,
            end: replaceEnd,
            replacement,
            className: '',
            classNames: lowered.classNames,
            insert: helper?.insert,
            outputKind: 'slots',
            foreign,
          })
          continue
        }
        skipped.push({ name, reason: 'recipe-call', start, end })
        continue
      }

      if (lowered.kind === 'class') {
        candidates.push({
          call,
          name,
          start,
          end: replaceEnd,
          replacement: JSON.stringify(lowered.className),
          className: lowered.className,
          classNames: lowered.className.split(' ').filter(Boolean),
          styleSet: lowered.styles,
          foreign,
        })
        continue
      }

      skipped.push({
        name,
        reason: 'recipe-call',
        start,
        end,
        ...(lowered.kind === 'decline' && lowered.detail && { detail: lowered.detail }),
      })
      continue
    }

    // `css`, `pattern`, `viewTransition`.
    const rangeKey = `${start}:${end}`
    if (seenRanges.has(rangeKey)) continue
    seenRanges.add(rangeKey)

    if (call.raw) {
      skipped.push({ name, reason: 'raw-call', start, end })
      continue
    }

    if (!call.exact || !hasStyles(call.data)) {
      skipped.push({ name, reason: 'dynamic', start, end, ...(call.refusal && { refusal: call.refusal }) })
      continue
    }

    candidates.push({ call, name, start, end })
  }

  /**
   * Resolve every fully static candidate to symbolic declarations before allocating a class.
   * An enclosing `cx()` needs the declarations of its arguments so it can discard overridden
   * values before any string exists.
   */
  for (const candidate of candidates) {
    if (
      candidate.styleSet ||
      candidate.value !== undefined ||
      candidate.missing ||
      candidate.replacement ||
      candidate.styleMap
    ) {
      continue
    }
    if (candidate.failed) continue

    const { call } = candidate
    const data = call.data as Dict[]
    if (call.kind === 'css') {
      candidate.styleSet = styleCompiler.compose(...data)
      continue
    }

    if (call.kind === 'pattern') {
      candidate.styleSet = styleCompiler.compose(...data.map((entry) => ctx.patterns.transform(call.name, entry)))
      continue
    }

    if (call.kind === 'viewTransition') {
      const semantic = viewTransitionClassName(data[0], ctx.utility.prefix)
      candidate.className = styleCompiler.allocateClassString(semantic)
      candidate.classNames = [candidate.className]
      candidate.replacement = JSON.stringify(candidate.className)
    }
  }

  // Semantic `cx()`: compose every analyzable argument's declarations before allocating.
  const byRange = new Map(candidates.map((candidate) => [`${candidate.start}:${candidate.end}`, candidate]))

  /**
   * A style binding another module declares, by the name this one imports it as: its declarations,
   * composed once however many `cx()` calls name it, and the modules they were read from. Absent
   * where its data holds no styles.
   */
  const importedStyleSets = new Map<string, { styleSet: Dict; dependencies: string[] } | undefined>()
  const importedStyleSet = (local: string) => {
    if (importedStyleSets.has(local)) return importedStyleSets.get(local)
    const style = analysis.importedStyles.find((entry) => entry.local === local)
    const resolved =
      style && hasStyles(style.data)
        ? {
            styleSet: styleCompiler.compose(
              ...(style.kind === 'pattern'
                ? style.data.map((entry) => ctx.patterns.transform(style.callee, entry))
                : style.data),
            ),
            dependencies: style.dependencies,
          }
        : undefined
    importedStyleSets.set(local, resolved)
    return resolved
  }

  /**
   * Whether copying the condition at `span` would copy something the fold rewrites or counts on
   * rewriting: a call it compiles, or a read of a binding a compiled template reaches through
   * `$setup`. The analysis has already declined a condition reading a Bamboo binding or a recipe.
   */
  const copiesCompiledCode = (span: FoldSpan) => {
    const within = (inner: FoldSpan) => inner.start >= span.start && inner.end <= span.end
    return (
      analysis.calls.some((other) => !other.notImported && within(other.span)) ||
      analysis.vueExposures.some((exposure) => exposure.reads.some(within))
    )
  }

  for (const call of analysis.calls) {
    if (call.kind !== 'cx' || call.notImported) continue

    const matched: Candidate[] = []
    const items: CxItem<Candidate>[] = []
    const dynamic: Candidate[] = []
    const constantCandidates: Candidate[] = []
    const tests: FoldSpan[] = []
    let holdsFailure = false
    /** The classes among the arguments written as strings, passed through as they are. */
    const literalClasses = () =>
      flattenCxItems(items)
        .flatMap((part) => (part.kind === 'class' && !part.candidate ? part.value.split(' ') : []))
        .filter(Boolean)

    const take = (arg: FoldCxArgument, into: CxItem<Candidate>[]): boolean => {
      // A module-scope binding of a style call: here, the call itself, which is a candidate like
      // any other; elsewhere, its declarations, which the analysis evaluated where they are written.
      if (arg.kind === 'binding') {
        let candidate = arg.definition ? byRange.get(`${arg.definition.start}:${arg.definition.end}`) : undefined
        const imported = arg.binding === undefined ? undefined : importedStyleSet(arg.binding)
        if (imported && arg.binding !== undefined) {
          candidate = {
            call,
            name: arg.binding,
            start: arg.span.start,
            end: arg.span.end,
            styleSet: imported.styleSet,
            foreign: imported.dependencies,
          }
        }
        if (candidate?.failed) {
          holdsFailure = true
          return false
        }
        if (!candidate?.styleSet) return false
        matched.push(candidate)
        into.push({ kind: 'style', candidate })
        return true
      }
      // `test && value` and `test ? a : b`: each answer is a list of its own, and the call is
      // compiled once per combination of answers.
      if (arg.kind === 'when' || arg.kind === 'choose') {
        const [consequent, alternate] = arg.elements ?? []
        if (!arg.test || !consequent || copiesCompiledCode(arg.test)) return false
        const then: CxItem<Candidate>[] = []
        const otherwise: CxItem<Candidate>[] = []
        if (!take(consequent, then) || (alternate && !take(alternate, otherwise))) return false
        tests.push(arg.test)
        into.push({ kind: 'branch', test: arg.test, then, otherwise })
        return true
      }
      const candidate = byRange.get(`${arg.span.start}:${arg.span.end}`)
      if (candidate?.failed) {
        holdsFailure = true
        return false
      }
      if (candidate?.styleMap?.outputKind === 'class') {
        dynamic.push(candidate)
        into.push({ kind: 'dynamic', candidate })
        return true
      }
      if (candidate?.styleSet) {
        matched.push(candidate)
        into.push({ kind: 'style', candidate })
        return true
      }
      if (candidate?.call.kind === 'viewTransition' && candidate.replacement && candidate.className) {
        constantCandidates.push(candidate)
        into.push({ kind: 'class', value: candidate.className, candidate })
        return true
      }
      if (arg.kind === 'string') {
        into.push({ kind: 'class', value: arg.value ?? '' })
        return true
      }
      if (arg.kind === 'array') {
        if (!arg.elements) return false
        for (const element of arg.elements) if (!take(element, into)) return false
        return true
      }
      // Values the runtime `cx` ignores and whose evaluation is inert.
      return arg.kind === 'ignored'
    }

    /** Arguments the fold cannot read — a `className` forwarded from props, usually — by position. */
    const opaque: Array<{ index: number; arg: FoldCxArgument }> = []
    /** Where each argument the fold reads stands, and how many conditions it holds. */
    const read: Array<{ index: number; tests: number }> = []

    for (const [index, arg] of call.cxArguments.entries()) {
      const marks = [items.length, matched.length, dynamic.length, constantCandidates.length, tests.length] as const
      if (take(arg, items)) {
        read.push({ index, tests: tests.length - marks[4] })
        continue
      }
      // An argument reported already says what is wrong; the composition has nothing to add.
      if (holdsFailure) break
      // What the argument contributed before it turned out unreadable goes with it.
      items.length = marks[0]
      matched.length = marks[1]
      dynamic.length = marks[2]
      constantCandidates.length = marks[3]
      tests.length = marks[4]
      opaque.push({ index, arg })
    }
    if (holdsFailure) continue

    /**
     * Every argument the fold reads, composed: a class string, or a ternary choosing one per
     * combination of answers. Absent where composing found a key that is not a condition, which is
     * reported by the arguments that hold it.
     */
    const compose = (): { written: string; classNames: string[] } | undefined => {
      const classNames = new Set<string>()
      const leaf = (parts: CxPart<Candidate>[]) => {
        const className = composeCxParts(parts, styleCompiler)
        for (const name of className.split(' ')) if (name) classNames.add(name)
        return className
      }
      try {
        const written =
          tests.length > 0
            ? writeCxBranches(items, leaf, (span) => code.slice(span.start, span.end))
            : JSON.stringify(leaf(flattenCxItems(items)))
        return { written, classNames: [...classNames] }
      } catch (error) {
        if (!(error instanceof UnwritableStyleError)) throw error
        reportComposing({ name: 'cx', start: call.span.start, end: call.span.end }, matched, error)
        return undefined
      }
    }

    const composesBamboo = matched.length > 0 || constantCandidates.length > 0
    const withinLimit = () => countCxCombinations(items, MAX_CX_COMBINATIONS) <= MAX_CX_COMBINATIONS

    // Arguments it cannot read stay a runtime join, beside one argument composing all the others.
    // The conditions are asked where the first of them stood, so every argument still runs in the
    // order it was written: none the fold cannot read may stand between two conditions, and each is
    // copied as written, which nothing compiled or counted on being compiled may be inside.
    if (opaque.length > 0) {
      const testing = read.filter((entry) => entry.tests > 0)
      const firstTest = testing[0]?.index ?? -1
      const lastTest = testing.at(-1)?.index ?? -1
      const written = call.cxArguments.map((arg) => arg.written)
      const partial =
        dynamic.length === 0 &&
        composesBamboo &&
        // One style composed with nothing is the class it already was.
        (tests.length > 0 || flattenCxItems(items).length > 1) &&
        written.every(Boolean) &&
        opaque.every(({ index, arg }) => {
          const span = written[index]!
          return !arg.readsBamboo && !copiesCompiledCode(span) && (index < firstTest || index > lastTest)
        }) &&
        withinLimit()
      if (partial) {
        const composed = compose()
        if (!composed) continue
        const position = testing[0]?.index ?? read[0]!.index
        const runtime = new Set(opaque.map(({ index }) => index))
        const args = written.flatMap((span, index) => {
          if (runtime.has(index)) return [code.slice(span!.start, span!.end)]
          return index === position ? [composed.written] : []
        })
        candidates.push({
          call,
          name: 'cx',
          // The arguments only: the call stays, spelled as it was — an alias, a namespace member or
          // a compiled template's `$setup.cx` included.
          start: written[0]!.start,
          end: written.at(-1)!.end,
          replacement: args.join(', '),
          className: '',
          classNames: composed.classNames,
          literalClassNames: literalClasses(),
          foreign: matched.flatMap((candidate) => candidate.foreign ?? []),
        })
        continue
      }
    }

    // Two runtime maps cannot be reduced to a single lookup, so more than one declines the
    // call — as does one beside a condition, whose answers would each need a lookup of their
    // own. It is the *mix* of compiled atoms and an opaque class that is worth a separate word.
    if (opaque.length > 0 || dynamic.length > 1 || (dynamic.length > 0 && tests.length > 0)) {
      const composesStyleSet = (arg: FoldCxArgument): boolean => {
        if (arg.kind === 'binding') return true
        const candidate = byRange.get(`${arg.span.start}:${arg.span.end}`)
        if (candidate?.styleSet || candidate?.styleMap?.outputKind === 'class' || candidate?.replacement) return true
        return (
          (arg.kind === 'array' || arg.kind === 'when' || arg.kind === 'choose') &&
          (arg.elements ?? []).some(composesStyleSet)
        )
      }
      const mixed = opaque.length > 0 && call.cxArguments.some(composesStyleSet)
      skipped.push({
        name: 'cx',
        reason: mixed ? 'opaque-composition' : 'dynamic',
        start: call.span.start,
        end: call.span.end,
      })
      continue
    }

    // Conditions: one complete composition per combination of answers, chosen by a ternary that
    // asks each condition where and in the order the arguments did.
    if (tests.length > 0) {
      // Classes passed through as written and nothing of Bamboo's: the join is somebody else's.
      if (!composesBamboo || !withinLimit()) {
        skipped.push({ name: 'cx', reason: 'dynamic', start: call.span.start, end: call.span.end })
        continue
      }
      const composed = compose()
      if (!composed) continue
      candidates.push({
        call,
        name: 'cx',
        start: call.span.start,
        end: call.span.end,
        // Parenthesized, since a ternary binds more loosely than the call it replaces; and at the
        // start of a statement, after `void 0, `, so it cannot continue the line before it.
        replacement: `${call.statementStart ? 'void 0, ' : ''}(${composed.written})`,
        className: '',
        classNames: composed.classNames,
        literalClassNames: literalClasses(),
        foreign: matched.flatMap((candidate) => candidate.foreign ?? []),
      })
      continue
    }

    const parts = flattenCxItems(items)
    const calleeName = localNameOf(analysis, 'cx', isBambooCssModule) ?? 'cx'

    if (dynamic.length === 1 && matched.length > 0) {
      const dynamicCandidate = dynamic[0]!
      const styleParts = parts.filter(
        (part): part is { kind: 'style' | 'dynamic'; candidate: Candidate } => part.kind !== 'class',
      )
      const dynamicIndex = styleParts.findIndex((part) => part.kind === 'dynamic')
      const before = styleParts
        .slice(0, dynamicIndex)
        .filter((part) => part.kind === 'style')
        .map((part) => part.candidate.styleSet!)
      const after = styleParts
        .slice(dynamicIndex + 1)
        .filter((part) => part.kind === 'style')
        .map((part) => part.candidate.styleSet!)
      let compiled: ReturnType<DynamicStyleMap['compile']>
      try {
        compiled = dynamicCandidate.styleMap!.compile(before, after)
      } catch (error) {
        if (!(error instanceof UnwritableStyleError)) throw error
        reportComposing(
          { name: 'cx', start: call.span.start, end: call.span.end },
          styleParts.map((part) => part.candidate),
          error,
        )
        continue
      }
      const expression =
        compiled.usesHelper && dynamicCandidate.mapHelperName && dynamicCandidate.mapHelperName !== RECIPE_MAP_HELPER
          ? compiled.expression.replaceAll(`${RECIPE_MAP_HELPER}(`, `${dynamicCandidate.mapHelperName}(`)
          : compiled.expression

      const arguments_: string[] = []
      let wroteCompiled = false
      for (const part of parts) {
        if (part.kind === 'class') {
          if (part.value) arguments_.push(JSON.stringify(part.value))
          continue
        }
        if (!wroteCompiled) {
          arguments_.push(expression)
          wroteCompiled = true
        }
      }

      dynamicCandidate.subsumed = true
      candidates.push({
        call,
        name: 'cx',
        start: call.span.start,
        end: call.span.end,
        replacement: arguments_.length === 1 ? arguments_[0] : `${calleeName}(${arguments_.join(', ')})`,
        className: '',
        classNames: [
          ...compiled.classNames,
          ...parts.filter((part) => part.kind === 'class').flatMap((part) => part.value.split(' ')),
        ].filter(Boolean),
        literalClassNames: literalClasses(),
        insert: compiled.usesHelper ? dynamicCandidate.insert : undefined,
        foreign: styleParts.flatMap((part) => part.candidate.foreign ?? []),
      })
      continue
    }

    if (matched.length === 0) {
      if (constantCandidates.length === 0) continue
      const className = parts
        .filter((part): part is { kind: 'class'; value: string; candidate?: Candidate } => part.kind === 'class')
        .map((part) => part.value)
        .filter(Boolean)
        .join(' ')
      candidates.push({
        call,
        name: 'cx',
        start: call.span.start,
        end: call.span.end,
        replacement: JSON.stringify(className),
        className,
        classNames: className.split(' ').filter(Boolean),
        literalClassNames: literalClasses(),
      })
      continue
    }

    const merged = styleCompiler.compose(...matched.map((candidate) => candidate.styleSet!))
    let compiled: string
    try {
      compiled = styleCompiler.className(merged)
    } catch (error) {
      if (!(error instanceof UnwritableStyleError)) throw error
      reportComposing({ name: 'cx', start: call.span.start, end: call.span.end }, matched, error)
      continue
    }
    const classParts: string[] = []
    let wroteCompiled = false
    for (const part of parts) {
      if (part.kind === 'class') {
        if (part.value) classParts.push(part.value)
        continue
      }
      if (!wroteCompiled && compiled) {
        classParts.push(compiled)
        wroteCompiled = true
      }
    }

    candidates.push({
      call,
      name: 'cx',
      start: call.span.start,
      end: call.span.end,
      replacement: JSON.stringify(classParts.join(' ')),
      className: classParts.join(' '),
      classNames: classParts.flatMap((part) => part.split(' ')).filter(Boolean),
      literalClassNames: literalClasses(),
      styleSet: merged,
      foreign: matched.flatMap((candidate) => candidate.foreign ?? []),
    })
  }

  // Runtime maps are allocated only after semantic `cx()` has had a chance to merge every
  // leaf. This prevents the uncomposed intermediate atoms from entering the stylesheet.
  for (const candidate of candidates) {
    if (!candidate.styleMap || candidate.subsumed || candidate.replacement || candidate.failed) continue
    let compiled: ReturnType<DynamicStyleMap['compile']>
    try {
      compiled = candidate.styleMap.compile()
    } catch (error) {
      if (!(error instanceof UnwritableStyleError)) throw error
      reportUnwritable(candidate.name, candidate.start, candidate.end, error)
      candidate.failed = true
      continue
    }
    candidate.replacement =
      compiled.usesHelper && candidate.mapHelperName && candidate.mapHelperName !== RECIPE_MAP_HELPER
        ? compiled.expression.replaceAll(`${RECIPE_MAP_HELPER}(`, `${candidate.mapHelperName}(`)
        : compiled.expression
    if (!compiled.usesHelper) candidate.insert = undefined
    candidate.className = compiled.staticClasses
    candidate.classNames = compiled.classNames
    candidate.outputKind = compiled.outputKind === 'slots' ? 'slots' : undefined
  }

  /** Compile every style fragment a recipe config declares, for nothing but the throw. */
  const assertCompiles = (config: RecipeConfig | undefined) => {
    if (!config) return
    const fragments: unknown[] = [config.base, ...Object.values(config.variants ?? {}).flatMap(Object.values)]
    for (const compound of config.compoundVariants ?? []) {
      if (compound && typeof compound === 'object') fragments.push((compound as Dict).css)
    }
    const slots = Array.isArray(config.slots) ? (config.slots as string[]) : undefined
    for (const fragment of fragments) {
      if (!fragment || typeof fragment !== 'object') continue
      for (const styles of slots ? slots.map((slot) => (fragment as Dict)[slot]) : [fragment]) {
        if (styles && typeof styles === 'object') styleCompiler.className(styles as Dict)
      }
    }
  }

  /** Ranges the rewrite actually replaced. */
  const applied: Array<[number, number]> = []

  /**
   * A `token.value()` no literal stands in for goes with whatever compiled around it, as a resolved
   * one does, and stays where nothing did. Settled once every rewrite that can take one is applied.
   */
  const settleUnwritableTokens = () => {
    for (const { name, start, end } of unwritableTokens) {
      const covered = applied.some(([from, to]) => start < to && from < end)
      skipped.push({ name, reason: covered ? 'overlapping' : 'unresolved-token', start, end })
    }
  }

  if (candidates.length === 0 && recipeDefinitions.length === 0 && analysis.vueExposures.length === 0) {
    settleUnwritableTokens()
    if (reportSurvivors) reportRuntimeBindings()
    return { code, map: null, folded, skipped, dependencies: [] }
  }

  // Outermost-first, so a nested candidate can be detected and dropped rather than producing
  // an overlapping overwrite (which magic-string rejects).
  candidates.sort((a, b) => a.start - b.start || b.end - a.end)

  const magic = new MagicString(code)

  // Which bindings have already been added, for the whole module rather than per insertion
  // point — a module-level binding is in scope everywhere in the file.
  const insertedNames = new Set<string>()
  const applyInsert = (insert: HelperInsert | undefined) => {
    if (!insert) return
    const missing = insert.names.filter((name) => !insertedNames.has(name))
    if (!missing.length) return
    magic.appendLeft(
      insert.pos,
      insert.module
        ? `\nimport { ${missing.join(', ')} } from '${insert.module}'`
        : missing.map((name) => `, ${name}`).join(''),
    )
    for (const name of missing) insertedNames.add(name)
  }

  const collides = (start: number, end: number) => applied.some(([from, to]) => start < to && from < end)
  /**
   * A call written inside a recipe config the loop below erases: `token()` or `keyframes()` in a
   * `cva` base. The stylesheet read its value out of the config, so it goes with the declaration.
   * Rewritten in place first, it was an edit the erasure then collided with, which left the
   * declaration, and the `cva` import with it, standing.
   */
  const withinDefinition = (start: number, end: number) =>
    recipeDefinitions.some((definition) => definition.start <= start && end <= definition.end)

  for (const candidate of candidates) {
    if (candidate.subsumed || candidate.failed) continue
    const { name, start, end } = candidate

    if (collides(start, end) || withinDefinition(start, end)) {
      skipped.push({ name, reason: 'overlapping', start, end })
      continue
    }

    for (const dependency of candidate.foreign ?? []) foreignDependencies.add(dependency)

    // A `token()` call, which becomes the value itself. No class is involved.
    if (candidate.value !== undefined || candidate.missing) {
      const source =
        typeof candidate.value === 'number'
          ? numberSource(candidate.value, candidate.call.statementStart, code.slice(end, end + 2))
          : candidate.missing
            ? 'undefined'
            : JSON.stringify(candidate.value)
      magic.overwrite(start, end, source)
      applied.push([start, end])
      folded.push({
        name,
        kind: 'value',
        className: '',
        classNames: [],
        ...(candidate.value !== undefined && { value: candidate.value }),
        start,
        end,
      })
      continue
    }

    if (candidate.replacement) {
      magic.overwrite(start, end, candidate.replacement)
      applyInsert(candidate.insert)
      applied.push([start, end])
      folded.push({
        name,
        kind: candidate.outputKind ?? 'class',
        className: candidate.className ?? '',
        classNames: (candidate.classNames ?? [candidate.className ?? '']).filter(Boolean),
        ...(candidate.literalClassNames?.length && { literalClassNames: candidate.literalClassNames }),
        start,
        end,
      })
      continue
    }

    let className: string
    try {
      className = styleCompiler.className(candidate.styleSet ?? {})
    } catch (error) {
      if (error instanceof UnwritableStyleError) reportUnwritable(name, start, end, error)
      else skipped.push({ name, reason: 'dynamic', start, end, ...styleErrorDetail(error) })
      continue
    }

    // JSON.stringify escapes the backslashes bamboo puts in class names for escaped
    // characters, and any quote an arbitrary value introduced.
    magic.overwrite(start, end, JSON.stringify(className))
    applied.push([start, end])
    folded.push({ name, kind: 'class', className, classNames: className ? [className] : [], start, end })
  }

  // `input.splitVariantProps(props)` — the other way a wrapper reaches its recipe. Lowered to
  // the `splitProps` it runs anyway, with the recipe's variant keys, so nothing reads the
  // binding and the config it was declared with can be dropped.
  // Only in a module that had something to fold, as before: a split alone keeps its binding.
  for (const split of candidates.length > 0 ? analysis.splitCalls : []) {
    const entry = split.imported
      ? ({ config: ctx.recipes.getConfig(split.binding) as RecipeConfig } satisfies RecipeEntry)
      : recipeConfigs.get(split.binding)
    if (!entry || entry === AMBIGUOUS || !entry.config) continue

    const { start, end } = split.span
    if (collides(start, end)) continue

    const helper = ensureRecipeHelperImport(
      SPLIT_PROPS_HELPER,
      analysis,
      split.shadowedHelpers,
      isBambooCssModule,
      isGeneratedCssModule,
      helperModules.get(split.binding),
      helperModuleFromSubpath,
    )
    if (!helper) continue

    const keys = Object.keys(entry.config.variants ?? {})
    magic.overwrite(start, end, `${helper.name}(${split.argumentText}, ${JSON.stringify(keys)})`)
    applyInsert(helper.insert)
    applied.push([start, end])
  }

  // Erase every successfully extracted recipe declaration. Calls and supported metadata
  // operations above no longer read the binding; any other read is reported below.
  for (const { name, factory, start, end } of recipeDefinitions) {
    if (collides(start, end)) continue
    // Only a config whose every fragment compiles. Erasing one the stylesheet cannot emit —
    // a retired `{token}` reference, say — deletes the only place the error was visible, and
    // the module the user sees is a recipe that silently became `undefined`. A throw here is
    // what makes the plugin report the module as one it could not compile — or, for a key that
    // is not a condition, the declaration as the place it is written.
    const unknown = unwritableIn(() => assertCompiles(recipeConfigs.get(name)?.config))
    if (unknown) {
      reportUnwritable(factory, start, end, unknown)
      continue
    }
    magic.overwrite(start, end, 'undefined')
    applied.push([start, end])
    folded.push({ name, kind: 'definition', className: '', classNames: [], start, end })
  }

  settleUnwritableTokens()

  // A `<script setup>` the dev server compiles exposes its imports to the template through
  // `__returned__` getters, and the template reads them off `$setup`. Once every `$setup.css`
  // the module reads has been compiled, `get css() { return css }` is the one thing still holding
  // the import, so it is emptied as an erased recipe declaration is. One left uncompiled keeps
  // it, and the getter's read is then reported as the binding it is.
  for (const exposure of analysis.vueExposures) {
    const compiled = exposure.reads.every((read) => applied.some(([from, to]) => read.start >= from && read.end <= to))
    if (!compiled || collides(exposure.span.start, exposure.span.end)) continue
    magic.overwrite(exposure.span.start, exposure.span.end, exposure.replacement)
    applied.push([exposure.span.start, exposure.span.end])
  }

  /**
   * Bindings from a bamboo module still referenced once every rewrite is applied.
   *
   * Deliberately not driven by the call ledger: that is the recogniser, and the point here is
   * to catch what it did not see. A namespace import, a default import, a re-export — each
   * leaves a live reference and no ledger entry at all.
   */
  function reportRuntimeBindings() {
    const bambooModules = [
      ...cssModules,
      ...(ctx.imports.matchers.recipe?.mods ?? []),
      ...(ctx.imports.matchers.pattern?.mods ?? []),
      ...(ctx.imports.matchers.tokens?.mods ?? []),
    ]

    const declinedRanges = () =>
      skipped
        .filter((entry) => SURVIVES_TO_RUNTIME.has(entry.reason) && entry.end > entry.start)
        .map((entry) => [entry.start, entry.end] as const)
    const inside = (ranges: ReadonlyArray<readonly [number, number]>, start: number) =>
      ranges.some(([from, to]) => start >= from && start < to)

    // Inline recipe bindings are local variables, so the import scan below cannot see reads
    // such as `badge.raw`, `badge.config`, `badge.merge(...)`, or a bare re-export. Every value
    // read has to sit inside a range the compiler actually replaced; otherwise a static build
    // could remove the recipe layer while silently retaining an API whose result depends on it.
    // Each module answers only for its own reads — a recipe declared elsewhere is reported by
    // the consumer that reads it unsafely, at a position in the consumer's own text.
    const recipeBindings = new Set<string>()
    for (const [name, entry] of recipeConfigs) if (entry !== AMBIGUOUS) recipeBindings.add(name)
    for (const imported of analysis.importedRecipes) recipeBindings.add(imported.local)

    for (const binding of recipeBindings) {
      const references = analysis.references.filter((reference) => reference.name === binding)
      if (references.length === 0) continue
      const declined = declinedRanges()
      if (references.some((reference) => inside(declined, reference.span.start))) continue
      const survivor = references.find((reference) => !inside(applied, reference.span.start))
      if (!survivor) continue
      skipped.push({ name: binding, reason: 'runtime-binding', start: survivor.span.start, end: survivor.span.end })
    }

    // Imports that do not create a static ES binding still retain the generated runtime
    // module. The compiler cannot rewrite an API selected from an opaque namespace at runtime.
    // Calls first, then import-equals, each in document order — the order diagnostics print.
    const shapes = analysis.runtimeShapes.filter((shape) => matchesModule(shape.module, bambooModules))
    const byStart = (a: { span: { start: number } }, b: { span: { start: number } }) => a.span.start - b.span.start
    for (const shape of shapes.filter((entry) => entry.kind === 'import' || entry.kind === 'require').sort(byStart)) {
      skipped.push({ name: shape.name, reason: 'runtime-binding', start: shape.span.start, end: shape.span.end })
    }
    for (const shape of shapes.filter((entry) => entry.kind === 'import-equals').sort(byStart)) {
      skipped.push({ name: shape.name, reason: 'runtime-binding', start: shape.span.start, end: shape.span.end })
    }

    /** Local name -> what to call it in the report. */
    const watched = new Map<string, string>()
    for (const declaration of analysis.imports) {
      if (declaration.typeOnly || !matchesModule(declaration.module, bambooModules)) continue
      for (const named of declaration.specifiers) {
        if (named.typeOnly || PERMITTED_BINDINGS.has(named.imported)) continue
        watched.set(named.local, named.imported)
      }
      if (declaration.namespaceLocal) watched.set(declaration.namespaceLocal, `${declaration.namespaceLocal}.*`)
      if (declaration.defaultLocal) watched.set(declaration.defaultLocal, declaration.defaultLocal)
    }

    // `export { css } from 'styled-system/css'`, `export * from`, `export * as ns from` — each
    // keeps the module alive, which is exactly how a wrapper module keeps the engine.
    for (const shape of shapes) {
      if (shape.kind !== 'export-star' && shape.kind !== 'export-from') continue
      if (shape.kind === 'export-from' && PERMITTED_BINDINGS.has(shape.name)) continue
      skipped.push({ name: shape.name, reason: 'runtime-binding', start: shape.span.start, end: shape.span.end })
    }

    // `import { css } … export { css as style }` — the same wrapper in two statements.
    for (const exported of analysis.localExports) {
      const imported = watched.get(exported.local)
      if (imported === undefined) continue
      skipped.push({ name: imported, reason: 'runtime-binding', start: exported.span.start, end: exported.span.end })
    }

    if (watched.size === 0) return

    // Suppressed by *range* rather than by name: the ledger records the imported name and
    // this sees the local one, which `css as c` makes different.
    const declined = declinedRanges()
    const exportRanges = analysis.localExports.map((exported) => [exported.span.start, exported.span.end] as const)
    const survivors: SkippedCall[] = []
    for (const [local, imported] of watched) {
      // References arrive in document order; one report per name, the first that survives.
      for (const reference of analysis.references) {
        if (reference.name !== local) continue
        const { start, end } = reference.span
        if (inside(applied, start) || inside(declined, start) || inside(exportRanges, start)) continue
        survivors.push({ name: imported, reason: 'runtime-binding', start, end })
        break
      }
    }
    survivors.sort((a, b) => a.start - b.start)
    skipped.push(...survivors)
  }

  if (reportSurvivors) reportRuntimeBindings()

  if (folded.length === 0) {
    return { code, map: null, folded, skipped, dependencies: [] }
  }

  const dependencies = new Set<string>([...analysis.dependencies, ...foreignDependencies])
  dependencies.delete(options.filePath)

  return {
    code: magic.toString(),
    map: magic.generateMap({ source: options.filePath, hires: true, includeContent: true }),
    folded,
    skipped,
    dependencies: [...dependencies],
  }
}

/** A dot or a name the digits of a number would run into: `1400.toFixed()` reads a decimal point. */
const RUNS_INTO_NUMBER = /^[\p{ID_Continue}$.\\]/u

/**
 * The source a `token.value()` of a number is written as, standing where the call stood.
 *
 * The call binds as tightly as anything does, and a number does not quite. A negative one is a
 * unary minus, looser than a member access, a call or the `**` the call may be the left of —
 * `-1.toFixed()` is not source, and `-1 ** 2` a syntax error — so it is parenthesized. A statement
 * opening with that parenthesis continues the line before it where that line has no semicolon, so
 * there `void 0, ` goes first. Any other number only needs a space from a dot or a name after it.
 * `JSON.stringify` writes it as the generated runtime's own table does.
 */
const numberSource = (value: number, statementStart: boolean, following: string) => {
  const literal = JSON.stringify(value)
  if (value < 0) return `${statementStart ? 'void 0, ' : ''}(${literal})`
  return RUNS_INTO_NUMBER.test(following) ? `${literal} ` : literal
}

/** The local name a module gives an import of `imported` from a Bamboo css module. */
const localNameOf = (
  analysis: FoldAnalysis,
  imported: string,
  isBambooCssModule: (mod: string) => boolean,
): string | undefined => {
  for (const declaration of analysis.imports) {
    if (declaration.typeOnly || !isBambooCssModule(declaration.module)) continue
    for (const named of declaration.specifiers) {
      if (!named.typeOnly && named.imported === imported) return named.local
    }
  }
  return undefined
}
