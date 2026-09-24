import type { AtomOrigin, DeadImport, ParserOptions } from '@bamboocss/core'
import { BambooError, getOrCreateSet } from '@bamboocss/shared'
import type { ParserResultInterface, ResultItem } from '@bamboocss/types'

export interface UnresolvedStyle {
  /**
   * What the loss costs, which decides how it is explained.
   *
   * - `atomic` — a `css()` call. The declarations the build saw still apply; the ones it
   *   did not have no rule behind them, so they are simply absent.
   * - `recipe` — a `cva`/`sva` config. A declaration the build cannot see has no rule behind
   *   any selection that includes it.
   */
  kind: 'atomic' | 'recipe'
  /** The property the build could not resolve, or `undefined` when only the count differs. */
  prop?: string
  filePath: string
  line: number
  column: number
  /**
   * How the build lost the call:
   *
   * - `unresolvable-value` — a value it could not evaluate.
   * - `missing-property` — a key whose value never arrived at all.
   * - `unenumerable-keys` — a spread or computed key, so it cannot say what the call sets.
   * - `unresolved-raw` — `css(recipe.raw(props), …)`. A recipe or pattern's `.raw` takes
   *   *props* and returns *styles*, so the build would compose the props instead and the
   *   browser would ask for classes no rule backs.
   */
  reason: 'unresolvable-value' | 'missing-property' | 'unenumerable-keys' | 'unresolved-raw'
}

/**
 * What extraction found in one file, and the encoder calls that turn it into rules.
 *
 * Filled from the native analysis by `BambooContext.parseFile`; nothing here reads source.
 */
export class ParserResult implements ParserResultInterface {
  /** Ordered list of all ResultItem */
  all: ResultItem[] = []
  css = new Set<ResultItem>()
  cva = new Set<ResultItem>()
  sva = new Set<ResultItem>()
  token = new Set<ResultItem>()
  viewTransition = new Set<ResultItem>()

  recipe = new Map<string, Set<ResultItem>>()
  pattern = new Map<string, Set<ResultItem>>()

  filePath: string | undefined
  encoder: ParserOptions['encoder']
  /** Resolver targets crossed while extracting values which contributed CSS. */
  private dependencies = new Set<string>()

  /** Styles the build could not fully see. @see `UnresolvedStyle` */
  unresolved: UnresolvedStyle[] = []

  /**
   * Calls to a name the pattern or recipe entrypoint no longer exports.
   *
   * Separate from `unresolved`, which grades a call the build *did* see and could only
   * partly resolve. These it saw and could not resolve at all: the binding is dead, so every
   * rule the call would have contributed is absent rather than incomplete. Reported by
   * `assertNoDeadCalls` rather than warned about, for that reason.
   */
  deadCalls: DeadImport[] = []

  /**
   * Whether each result item is attributed to its call site, for a source map.
   *
   * Off for a source a `parser:before` hook rewrote: its positions are the hook's output's,
   * not the file's, and a wrong line is worse than none.
   */
  origins = true

  /** Set on a result the native engine produced, with the reads it reported. @internal */
  native = false
  nativePendingCandidates: readonly string[] = []
  nativeConfigurationFiles: readonly string[] = []

  constructor(
    private context: ParserOptions,
    encoder?: ParserOptions['encoder'],
  ) {
    this.encoder = encoder ?? context.encoder
  }

  append(result: ResultItem) {
    this.all.push(result)
    return result
  }

  set(name: 'cva' | 'css' | 'sva' | 'token', result: ResultItem) {
    switch (name) {
      case 'css':
        this.setCss(result)
        break
      case 'cva':
        this.setCva(result)
        break
      case 'sva':
        this.setSva(result)
        break
      case 'token':
        this.setToken(result)
        break
      default:
        throw new BambooError(
          'UNKNOWN_RESULT_TYPE',
          `Unknown parser result type: "${name}". Expected one of: css, cva, sva, token`,
        )
    }
  }

  setCss(result: ResultItem) {
    this.css.add(this.append(Object.assign({ type: 'css' }, result)))

    // `walkObject` would read an array's indices as property names and emit a rule per index —
    // junk classes, no error. Caught here, inside the per-file parse, so the failure names the
    // file it came from.
    if (result.data.some(Array.isArray)) {
      throw new BambooError('INVALID_STYLE_ARGUMENT', 'An array is not a style argument.', {
        hint: 'Spread it instead, e.g. css(...styles) rather than css(styles).',
      })
    }

    const encoder = this.encoder
    encoder.withOrigin(this.originOf(result), () => result.data.forEach((obj) => encoder.processAtomic(obj)))
  }

  /** The call site of `result`, when the encoder is recording them. */
  private originOf = (result: ResultItem): AtomOrigin | undefined => {
    if (!this.origins || !this.encoder.recordOrigins) return undefined
    return result.atomOrigin
  }

  setCva(result: ResultItem) {
    this.cva.add(this.append(Object.assign({ type: 'cva' }, result)))
    const encoder = this.encoder
    encoder.withOrigin(this.originOf(result), () => result.data.forEach((data) => encoder.processAtomicRecipe(data)))
  }

  setSva(result: ResultItem) {
    this.sva.add(this.append(Object.assign({ type: 'sva' }, result)))
    const encoder = this.encoder
    encoder.withOrigin(this.originOf(result), () =>
      result.data.forEach((data) => encoder.processAtomicSlotRecipe(data)),
    )
  }

  /**
   * `kind` separates the variable reference — `token()` — from `token.value()`, the resolved
   * literal. They share this set deliberately: everything that reads a result for the token
   * *path* wants both, and only the fold cares which half was asked for.
   */
  setToken(result: ResultItem, kind: 'token' | 'tokenValue' = 'token') {
    this.token.add(this.append(Object.assign({ type: kind }, result)))
  }

  setViewTransition(result: ResultItem) {
    this.viewTransition.add(this.append(Object.assign({ type: 'viewTransition' }, result)))
    const encoder = this.encoder
    result.data.forEach((obj) => encoder.processViewTransition(obj))
  }

  setPattern(name: string, result: ResultItem) {
    const set = getOrCreateSet(this.pattern, name)
    set.add(this.append(Object.assign({ type: 'pattern', name }, result)))

    this.encoder.withOrigin(this.originOf(result), () =>
      result.data.forEach((obj) => this.encoder.processPattern(name, obj)),
    )
  }

  /**
   * @param unresolved The variant axes the call site passed and the build could not read.
   * `button({ size })` with a dynamic `size` and `button()` both arrive as `{}`, and the
   * difference decides whether a class the encoder is about to emit has a rule behind it.
   */
  setRecipe(recipeName: string, result: ResultItem, unresolved?: ReadonlySet<string>) {
    const set = getOrCreateSet(this.recipe, recipeName)
    set.add(this.append(Object.assign({ type: 'recipe' }, result)))

    const encoder = this.encoder
    const recipes = this.context.recipes

    const recipeConfig = recipes.getConfig(recipeName)
    if (!recipeConfig) return

    const axes = unresolved?.size ? new Set(unresolved) : undefined

    // treat recipe jsx like regular recipe + atomic
    if (result.type) {
      result.data.forEach((data) => {
        const [recipeProps, styleProps] = recipes.splitProps(recipeName, data)
        encoder.processStyleProps(styleProps)
        encoder.processRecipe(recipeName, recipeProps, axes)
      })
    } else {
      result.data.forEach((data) => {
        encoder.processRecipe(recipeName, data, axes)
      })
    }
  }

  isEmpty() {
    return this.all.length === 0
  }

  setFilePath(filePath: string) {
    this.filePath = filePath
    return this
  }

  /** @internal Called with each resolver target the native evaluation crossed. */
  addDependency(filePath: string) {
    this.dependencies.add(filePath.replaceAll('\\', '/'))
  }

  /** Local source paths crossed while resolving values this extraction encoded. */
  getDependencies() {
    const own = this.filePath?.replaceAll('\\', '/')
    return [...this.dependencies].filter((path) => path !== own).sort()
  }

  toArray() {
    return this.all
  }

  toJSON() {
    return {
      css: Array.from(this.css),
      cva: Array.from(this.cva),
      sva: Array.from(this.sva),
      token: Array.from(this.token),
      viewTransition: Array.from(this.viewTransition),
      recipe: Object.fromEntries(Array.from(this.recipe.entries()).map(([key, value]) => [key, Array.from(value)])),
      pattern: Object.fromEntries(Array.from(this.pattern.entries()).map(([key, value]) => [key, Array.from(value)])),
    }
  }
}
