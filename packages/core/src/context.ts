import { isCssProperty } from '@bamboocss/is-valid-prop'
import { logger } from '@bamboocss/logger'
import { BambooError, compact, createPatternFns, flatten, isBoolean, isString, memo } from '@bamboocss/shared'
import { TokenDictionary } from '@bamboocss/token-dictionary'
import type {
  CascadeLayers,
  GlobalVarsDefinition,
  HashOptions,
  HashSetting,
  LoadConfigResult,
  BambooHooks,
  PrefixOptions,
  PropertyConfig,
  Theme,
  ThemeVariantsMap,
  UserConfig,
} from '@bamboocss/types'
import { Conditions } from './conditions'
import { FileEngine } from './file'
import { GlobalFontface } from './global-fontface'
import { GlobalPositionTry, positionTryIdent } from './global-position-try'
import { GlobalVars } from './global-vars'
import { HooksApi } from './hooks-api'
import { ImportMap } from './import-map'
import { JsxEngine } from './jsx'
import { Layers } from './layers'
import { getMessages, type Messages } from './messages'
import { Mixins } from './mixins'
import { PathEngine } from './path'
import { Patterns } from './patterns'
import { Recipes } from './recipes'
import { findGlobalCssMistakes, transformStyles } from './serialize'
import { StaticCss } from './static-css'
import { StyleDecoder } from './style-decoder'
import { StyleEncoder } from './style-encoder'
import { Stylesheet } from './stylesheet'
import type { ParserOptions, StylesheetContext } from './types'
import { Utility } from './utility'

const defaults = (config: UserConfig): UserConfig => ({
  cssVarRoot: ':where(:root, :host)',
  outExtension: 'mjs',
  shorthands: true,
  ...config,
  // Merged per key rather than spread, so `prune: { keyframes: false }` keeps the other
  // defaults instead of turning token and keyframe pruning off by omission.
  prune: {
    tokens: true,
    unresolvedPath: 'off',
    propertyRegistrations: true,
    keyframes: true,
    ...config.prune,
  },
  layers: {
    reset: 'reset',
    base: 'base',
    tokens: 'tokens',
    recipes: 'recipes',
    utilities: 'utilities',
    ...config.layers,
  },
})

export class Context {
  // Engines
  tokens: TokenDictionary
  utility: Utility
  recipes: Recipes
  conditions: Conditions
  patterns: Patterns
  mixins: Mixins
  staticCss: StaticCss
  jsx: JsxEngine
  imports: ImportMap
  paths: PathEngine
  file: FileEngine

  globalVars: GlobalVars
  globalFontface: GlobalFontface
  globalPositionTry: GlobalPositionTry

  encoder: StyleEncoder
  decoder: StyleDecoder
  hooksApi: HooksApi

  // Props
  properties!: Set<string>
  isValidProperty!: (key: string) => boolean
  messages: Messages
  parserOptions: ParserOptions

  constructor(public conf: LoadConfigResult) {
    const config = defaults(conf.config)
    const theme = config.theme ?? {}
    conf.config = config

    this.tokens = this.createTokenDictionary(theme, theme.variants)
    this.hooks['tokens:created']?.({
      configure: (opts) => {
        if (opts.formatTokenName) {
          this.tokens.formatTokenName = opts.formatTokenName
        }
        if (opts.formatCssVar) {
          this.tokens.formatCssVar = opts.formatCssVar
        }
      },
    })
    this.tokens.init()

    this.utility = this.createUtility(config)
    let hooksReturned = false
    let ignoredToHash = false
    this.hooks['utility:created']?.({
      configure: (opts) => {
        if (!opts.toHash) return
        // A utility class has the fixed shape the runtime `cx` reads to merge it, so a hook's hash
        // cannot name it. Reported once the hooks return: thrown here, the hook runner would only
        // log it as the plugin's own error. A hook configuring past an `await` calls this after
        // that, when there is nothing left to fail, so it is said then. @see mergeableAtomName
        if (hooksReturned) this.reportIgnoredToHash(config, true)
        else ignoredToHash = true
      },
    })
    hooksReturned = true
    if (ignoredToHash) this.reportIgnoredToHash(config)

    this.conditions = this.createConditions(config)

    this.mixins = new Mixins({ mixins: theme.mixins, utility: this.utility })

    this.patterns = new Patterns({
      config,
      tokens: this.tokens,
      utility: this.utility,
      helpers: this.patternHelpers,
    })

    this.setupProperties()

    // Relies on this.conditions, this.utility, this.layers
    this.recipes = this.createRecipes(theme)

    this.encoder = new StyleEncoder({
      utility: this.utility,
      recipes: this.recipes,
      conditions: this.conditions,
      patterns: this.patterns,
      mixins: this.mixins,
      isValidProperty: this.isValidProperty,
    })

    this.decoder = new StyleDecoder({
      conditions: this.conditions,
      utility: this.utility,
      recipes: this.recipes,
      hash: this.hash,
    })

    // Relies on this.encoder, this.decoder
    this.setupCompositions(theme)
    this.registerAnimationName(theme)
    this.registerFontFamily(config.global?.fontface)
    this.registerPositionTryFallbacks(config.global?.positionTry)

    // Relies on this.conditions, and this.isValidProperty once the compositions are among them
    this.checkGlobalCss(config)

    this.recipes.save(this.baseSheetContext)

    this.staticCss = new StaticCss({
      config,
      hash: this.hash,
      utility: this.utility,
      patterns: this.patterns,
      recipes: this.recipes,
      createSheet: this.createSheet,
      encoder: this.encoder,
      decoder: this.decoder,
    })

    this.jsx = new JsxEngine({ recipes: this.recipes })

    this.imports = new ImportMap({
      jsx: this.jsx,
      conf: this.conf,
      config: this.config,
      patterns: this.patterns,
      recipes: this.recipes,
      isValidProperty: this.isValidProperty,
    })

    this.paths = new PathEngine({
      config: this.config,
    })

    this.file = new FileEngine({
      config: this.config,
    })

    this.globalVars = new GlobalVars({
      globalVars: this.config.global?.vars as GlobalVarsDefinition,
      cssVarRoot: this.config.cssVarRoot!,
    })

    this.globalFontface = new GlobalFontface({
      globalFontface: this.config.global?.fontface,
    })

    this.globalPositionTry = new GlobalPositionTry({
      globalPositionTry: this.config.global?.positionTry,
    })

    this.messages = getMessages({
      jsx: this.jsx,
      config: this.config,
      tokens: this.tokens,
      recipes: this.recipes,
      patterns: this.patterns,
    })

    this.parserOptions = {
      hash: this.hash,
      compilerOptions: this.conf.tsconfig?.compilerOptions ?? {},
      recipes: this.recipes,
      patterns: this.patterns,
      jsx: this.jsx,
      config: this.config,
      tokens: this.tokens,
      conditions: this.conditions,
      utility: this.utility,
      encoder: this.encoder,
      tsOptions: this.conf.tsOptions,
      join: (...paths: string[]) => paths.join('/'),
      imports: this.imports,
    }

    this.hooksApi = new HooksApi(this)
    this.hooks['context:created']?.({ ctx: this.hooksApi, logger: logger })
  }

  get config() {
    return this.conf.config
  }

  get hooks() {
    return this.conf.hooks ?? ({} as BambooHooks)
  }

  /**
   * Resolved to booleans here, once, so nothing downstream has to know about `'auto'`.
   *
   * That is also what keeps a name stable: the mode is read at context creation and every class
   * the sheet and the compiler produce comes from this one answer. Deciding it later, per call
   * site, is how the emitted CSS and the compiled literal would come to disagree.
   *
   * Class names left unset are `'auto'`: a readable name costs every server render that writes
   * it, and nobody reads it in production. Variables left unset stay readable, since hand-written
   * CSS refers to them by name.
   */
  get hash(): HashOptions {
    const resolve = (setting: HashSetting | undefined) => (setting === 'auto' ? !this.config.dev : !!setting)
    const { hash } = this.config
    const whole = isBoolean(hash) || hash === 'auto'

    return {
      tokens: resolve(whole ? hash : hash?.cssVar),
      className: resolve(whole ? hash : (hash?.className ?? 'auto')),
    }
  }

  get prefix(): PrefixOptions {
    return {
      tokens: isString(this.config.prefix) ? this.config.prefix : this.config.prefix?.cssVar,
      className: isString(this.config.prefix) ? this.config.prefix : this.config.prefix?.className,
    }
  }

  createTokenDictionary = (theme: Theme, themeVariants?: ThemeVariantsMap): TokenDictionary => {
    return new TokenDictionary({
      breakpoints: theme.breakpoints,
      tokens: theme.tokens,
      semanticTokens: theme.semanticTokens,
      themes: themeVariants,
      prefix: this.prefix.tokens,
      hash: this.hash.tokens,
      colorPalette: theme.colorPalette,
    })
  }

  createUtility = (config: UserConfig): Utility => {
    return new Utility({
      prefix: this.prefix.className,
      tokens: this.tokens,
      config: Object.assign({}, config.utilities),
      separator: config.separator,
      shorthands: config.shorthands,
      strictValues: config.strictValues,
      keyframes: config.theme?.keyframes,
      containerNames: config.theme?.containerNames,
      unresolvedToken: config.unresolvedToken,
      invalidDeclaration: config.invalidDeclaration,
    })
  }

  createConditions = (config: UserConfig): Conditions => {
    return new Conditions({
      conditions: config.conditions,
      containerNames: config.theme?.containerNames,
      containerSizes: config.theme?.containerSizes,
      breakpoints: config.theme?.breakpoints,
      themes: config.theme?.variants,
    })
  }

  createLayers = (layers: CascadeLayers): Layers => {
    return new Layers(layers)
  }

  /** The pattern helpers this context answers token lookups with. */
  patternHelpers = createPatternFns((path, fallback) => this.tokens.view.getVar(path) ?? fallback)

  setupCompositions = (theme: Theme): void => {
    const compositions = compact({ mixin: theme.mixins })

    const stylesheetCtx = {
      ...this.baseSheetContext,
      layers: this.createLayers(this.config.layers as CascadeLayers),
    }

    for (const [key, values] of Object.entries(compositions)) {
      // add the composition to the list of valid properties
      this.properties.add(key)

      const flatValues = flatten(values ?? {})

      const config: PropertyConfig = {
        layer: 'compositions',
        className: key,
        values: Object.keys(flatValues),
        // Into the context's own record whatever is being serialized when a mixin is first used:
        // it is config, and its styles are cached by value after that first use, so a sheet that
        // kept the finding would lose it from every later build.
        transform: (value) => {
          return this.utility.withinSerializedStyles(
            () => transformStyles(stylesheetCtx, flatValues[value], key + '.' + value),
            this.utility.serializedUnresolvedTokens,
          )
        },
      }

      this.utility.register(key, config)
    }
  }

  private registerAnimationName = (theme: Theme): void => {
    this.utility.addPropertyType('animationName', Object.keys(theme.keyframes ?? {}))
  }

  private registerFontFamily = (fontFaces: Record<string, any> | undefined): void => {
    this.utility.addPropertyType('fontFamily', Object.keys(fontFaces ?? {}))
  }

  /**
   * The `@position-try` names a config declares, as values the properties that take one accept.
   *
   * The same trade as `registerFontFamily`: declaring the rule is what makes its name known, so
   * `positionTryFallbacks: '--flip'` autocompletes and — under `strictValues` — is a build error. A
   * rule written as a raw `@position-try` in `globalCss` still ships, but its name stays unknown.
   *
   * Registered under the dashed spelling because that is what the property takes: `position-try-
   * fallbacks: flip` is invalid css. `positionTryOrder` is left alone — it takes keywords, not a
   * name.
   */
  private registerPositionTryFallbacks = (positionTry: Record<string, any> | undefined): void => {
    const names = Object.keys(positionTry ?? {}).map(positionTryIdent)

    this.utility.addPropertyType('positionTryFallbacks', names)
    this.utility.addPropertyType('positionTry', names)
  }

  setupProperties = (): void => {
    this.properties = new Set(['css', ...this.utility.keys(), ...this.conditions.keys()])
    this.isValidProperty = memo((key: string) => this.properties.has(key) || isCssProperty(key))
  }

  /**
   * Report what in `global.css` cannot mean what it says, the way the config's own validation
   * reports: a warning, a failure under `validation: 'error'`, and nothing under `'off'`.
   *
   * Here rather than beside the rest of that validation because telling a selector from a
   * condition or a property takes the conditions and utilities this context builds. Once per
   * context, because the styles are the config's, and every sheet serializes the same ones.
   * @see findGlobalCssMistakes
   */
  private checkGlobalCss = (config: UserConfig): void => {
    const css = config.global?.css
    if (!css || config.validation === 'off') return

    const mistakes = findGlobalCssMistakes(this, css)
    if (!mistakes.length) return

    const errors = `⚠️ Invalid config:\n${mistakes.map((mistake) => `- [global.css] ${mistake}`).join('\n')}\n`
    if (config.validation === 'error') throw new BambooError('CONFIG_ERROR', errors)
    logger.warn('config', errors)
  }

  /**
   * A `toHash` a `utility:created` hook configures, which is no longer used, reported the way
   * `checkGlobalCss` reports: a warning, a failure under `validation: 'error'`, and nothing under
   * `'off'`. One configured `late`, once the context is built, can only be a warning: thrown then,
   * it would reject a promise nothing awaits.
   */
  private reportIgnoredToHash = (config: UserConfig, late = false): void => {
    if (config.validation === 'off') return

    const errors =
      '⚠️ Invalid config:\n- [plugins] A `utility:created` hook configures `toHash`, which is no longer used: a ' +
      'utility class name has the fixed shape the runtime `cx` reads to merge it. Remove it from the hook.\n'
    if (config.validation === 'error' && !late) throw new BambooError('CONFIG_ERROR', errors)
    logger.warn('config', errors)
  }

  get baseSheetContext() {
    return {
      conditions: this.conditions,
      utility: this.utility,
      hash: this.hash.className,
      encoder: this.encoder,
      decoder: this.decoder,
      mixins: this.mixins,
      hooks: this.hooks,
      isValidProperty: this.isValidProperty,
      browserslist: this.config.browserslist,
      cssVarRoot: this.config.cssVarRoot!,
      helpers: this.patternHelpers,
      globalVars: this.globalVars,
      globalFontface: this.globalFontface,
      globalPositionTry: this.globalPositionTry,
    } satisfies Omit<StylesheetContext, 'layers'>
  }

  /** Order conflicts already reported, so a dev server rebuilding its sheet says each once. */
  private reportedOrderConflicts = new Set<string>()

  createSheet = (): Stylesheet => {
    const layers = this.createLayers(this.config.layers as CascadeLayers)
    layers.reportConflict = (message) => {
      if (this.reportedOrderConflicts.has(message)) return
      this.reportedOrderConflicts.add(message)
      logger.warn('sheet:order', message)
    }
    return new Stylesheet({ ...this.baseSheetContext, layers })
  }

  createRecipes = (theme: Theme): Recipes => {
    const recipeConfigs = Object.assign({}, theme.recipes ?? {}, theme.slotRecipes ?? {})
    return new Recipes(recipeConfigs)
  }
}
