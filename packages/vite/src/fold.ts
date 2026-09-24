import { resolveTsPathPattern } from '@bamboocss/config/ts-path'
import type { Context } from '@bamboocss/core'
import type { FoldAnalysis, FoldCall, FoldCxArgument } from '@bamboocss/native-extractor'
import { viewTransitionClassName } from '@bamboocss/shared'
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
  /** The literal written in place of the call, for a `value` fold. */
  value?: string
  start: number
  end: number
}

export interface SkippedCall {
  name: string
  reason: SkipReason
  start: number
  end: number
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

const hasStyles = (data: unknown[]): data is Dict[] =>
  data.length > 0 && data.every((entry) => entry != null && typeof entry === 'object')

/** `recipe(props).slot` names a slot only when the recipe declares one by that name. */
const slotsOf = (config: RecipeConfig | undefined) => (Array.isArray(config?.slots) ? (config.slots as string[]) : [])

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
    /** A finite runtime recipe lookup, intentionally unallocated until semantic `cx()`. */
    styleMap?: DynamicStyleMap
    /** Local name of the generated map helper, when the import was aliased. */
    mapHelperName?: string
    /** Set once an enclosing semantic composition owns this candidate. */
    subsumed?: boolean
    /** The replacement evaluates to a slot-name → class-string object. */
    outputKind?: 'slots'
    /** Replacement text for a compiled call, in place of a bare class string. */
    replacement?: string
    /** The resolved value, for a `token()` call. Its presence is what marks one. */
    value?: string
    /** Bindings to add to an existing import, by name so duplicates can be dropped. */
    insert?: HelperInsert
    /** Modules another module's recipe was read from, or through. */
    foreign?: readonly string[]
    start: number
    end: number
  }

  const candidates: Candidate[] = []
  const seenRanges = new Set<string>()
  const recipeDefinitions: Array<{ name: string; start: number; end: number }> = []

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
        recipeDefinitions.push({ name: call.binding, start, end })
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
        skipped.push({ name, reason: 'dynamic', start, end })
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
      if (!value) {
        skipped.push({ name, reason: 'unresolved-token', start, end })
        continue
      }

      candidates.push({ call, name, start, end, value })
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

      const lowered = lowerRecipeCall(call, entry, styleCompiler, slot, maxRecipeStates)
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

      skipped.push({ name, reason: 'recipe-call', start, end })
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
      skipped.push({ name, reason: 'dynamic', start, end })
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
    if (candidate.styleSet || candidate.value !== undefined || candidate.replacement || candidate.styleMap) continue

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
  for (const call of analysis.calls) {
    if (call.kind !== 'cx' || call.notImported) continue

    const matched: Candidate[] = []
    const parts: Array<
      | { kind: 'style'; candidate: Candidate }
      | { kind: 'dynamic'; candidate: Candidate }
      | { kind: 'class'; value: string; candidate?: Candidate }
    > = []
    const dynamic: Candidate[] = []
    const constantCandidates: Candidate[] = []
    let supported = true

    const take = (arg: FoldCxArgument): boolean => {
      const candidate = byRange.get(`${arg.span.start}:${arg.span.end}`)
      if (candidate?.styleMap?.outputKind === 'class') {
        dynamic.push(candidate)
        parts.push({ kind: 'dynamic', candidate })
        return true
      }
      if (candidate?.styleSet) {
        matched.push(candidate)
        parts.push({ kind: 'style', candidate })
        return true
      }
      if (candidate?.call.kind === 'viewTransition' && candidate.replacement && candidate.className) {
        constantCandidates.push(candidate)
        parts.push({ kind: 'class', value: candidate.className, candidate })
        return true
      }
      if (arg.kind === 'string') {
        parts.push({ kind: 'class', value: arg.value ?? '' })
        return true
      }
      if (arg.kind === 'array') {
        if (!arg.elements) return false
        for (const element of arg.elements) if (!take(element)) return false
        return true
      }
      // Values the runtime `cx` ignores and whose evaluation is inert.
      return arg.kind === 'ignored'
    }

    for (const arg of call.cxArguments) {
      if (take(arg)) continue
      supported = false
      break
    }

    // Two runtime maps cannot be reduced to a single lookup, so more than one declines the
    // call whether or not the walk finished. It is the *mix* of compiled atoms and an opaque
    // class that is worth a separate word.
    if (!supported || dynamic.length > 1) {
      const composesStyleSet = (arg: FoldCxArgument): boolean => {
        const candidate = byRange.get(`${arg.span.start}:${arg.span.end}`)
        if (candidate?.styleSet || candidate?.styleMap?.outputKind === 'class' || candidate?.replacement) return true
        return arg.kind === 'array' && (arg.elements ?? []).some(composesStyleSet)
      }
      const mixed = !supported && call.cxArguments.some(composesStyleSet)
      skipped.push({
        name: 'cx',
        reason: mixed ? 'opaque-composition' : 'dynamic',
        start: call.span.start,
        end: call.span.end,
      })
      continue
    }

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
      const compiled = dynamicCandidate.styleMap!.compile(before, after)
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
      })
      continue
    }

    const merged = styleCompiler.compose(...matched.map((candidate) => candidate.styleSet!))
    const compiled = styleCompiler.className(merged)
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
      styleSet: merged,
      foreign: matched.flatMap((candidate) => candidate.foreign ?? []),
    })
  }

  // Runtime maps are allocated only after semantic `cx()` has had a chance to merge every
  // leaf. This prevents the uncomposed intermediate atoms from entering the stylesheet.
  for (const candidate of candidates) {
    if (!candidate.styleMap || candidate.subsumed || candidate.replacement) continue
    const compiled = candidate.styleMap.compile()
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

  if (candidates.length === 0 && recipeDefinitions.length === 0) {
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

  for (const candidate of candidates) {
    if (candidate.subsumed) continue
    const { name, start, end } = candidate

    if (collides(start, end)) {
      skipped.push({ name, reason: 'overlapping', start, end })
      continue
    }

    for (const dependency of candidate.foreign ?? []) foreignDependencies.add(dependency)

    // A `token()` call, which becomes the value itself. No class is involved.
    if (candidate.value !== undefined) {
      magic.overwrite(start, end, JSON.stringify(candidate.value))
      applied.push([start, end])
      folded.push({ name, kind: 'value', className: '', classNames: [], value: candidate.value, start, end })
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
        start,
        end,
      })
      continue
    }

    let className: string
    try {
      className = styleCompiler.className(candidate.styleSet ?? {})
    } catch {
      skipped.push({ name, reason: 'dynamic', start, end })
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
  for (const { name, start, end } of recipeDefinitions) {
    if (collides(start, end)) continue
    // Only a config whose every fragment compiles. Erasing one the stylesheet cannot emit —
    // a retired `{token}` reference, say — deletes the only place the error was visible, and
    // the module the user sees is a recipe that silently became `undefined`. A throw here is
    // what makes the plugin report the module as one it could not compile.
    assertCompiles(recipeConfigs.get(name)?.config)
    magic.overwrite(start, end, 'undefined')
    applied.push([start, end])
    folded.push({ name, kind: 'definition', className: '', classNames: [], start, end })
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
