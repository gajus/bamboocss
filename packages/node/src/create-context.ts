import type { DeadImport, StyleEncoder, Stylesheet } from '@bamboocss/core'
import type {
  FoldAnalysis,
  NativeEntrypoint,
  NativeFileAnalysis,
  NativeProjectOptions,
  NativeSource,
  NativeTokenAccounting,
  NativeTokenTable,
} from '@bamboocss/native-extractor'
import { filesReadBy, getConfigDependencies } from '@bamboocss/config'
import { checkNamingAgreement, formatNamingDisagreement } from '@bamboocss/core'
import { Generator } from '@bamboocss/generator'
import { logger } from '@bamboocss/logger'
import { BambooError, groupBy, truncateList, uniq } from '@bamboocss/shared'
import { selectExtractable } from './extractable-files'
import type {
  LoadConfigResult,
  ParserResultConfigureOptions,
  Runtime,
  WatchOptions,
  WatcherEventType,
} from '@bamboocss/types'
import { debounce } from 'perfect-debounce'
import { statSync } from 'node:fs'
import { createBox } from './cli-box'
import { DiffEngine } from './diff-engine'
import { ParserResult, type UnresolvedStyle } from './parser-result'
import { SourceProject } from './source-project'
import { nodeRuntime } from './node-runtime'
import { loadNativeExtractor } from './native-extractor'
import { firstSpellingOfEachFile } from './real-sources'
import { OutputEngine } from './output-engine'

/** A thrown value's message, for a `catch` binding that is typed `unknown`. */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** What to do about a value the build could not read, in a `css()` or pattern call. */
const VALUE_FIX =
  'Write the value out, or choose between values written out with a ternary. One known only at runtime belongs ' +
  "in the `style` attribute, or in a CSS variable a declaration reads, `width: 'var(--width)'`."

/**
 * What each loss is, and what the author can do about it: in a `css()` or pattern call, and in a
 * recipe's config where that differs.
 *
 * Kept apart from the sentence around it so every reason has to answer both questions.
 * "Write the value out" is the fix for a value the build could not evaluate and no help at all
 * for two arguments it could not tell apart, and a diagnostic that gives the wrong instruction is
 * worse than one that gives none. `name` is the property or recipe the loss is at, quoted, and
 * absent for a whole argument.
 */
const unresolvedReasons: Record<
  UnresolvedStyle['reason'],
  (name: string | undefined) => [loss: string, fix: string, recipeFix?: string]
> = {
  'unresolvable-value': (name) => [
    name
      ? `${name} will not reach the stylesheet because its value is not statically known`
      : 'this argument will not reach the stylesheet because it is not statically known',
    VALUE_FIX,
    'Write the value out, or declare what varies as a variant the calls select.',
  ],
  'missing-property': (name) => [
    `${name ?? 'a property'} will not reach the stylesheet because its value could not be evaluated at build time`,
    VALUE_FIX,
    'Write the value out, or declare what varies as a variant the calls select.',
  ],
  'unenumerable-keys': () => [
    'an object spread or computed key leaves the build unable to tell which properties this call sets',
    'Write the properties out, or spread an object the build can read.',
  ],
  'unresolved-raw': (name = 'a recipe') => [
    `${name}.raw() composes its own props rather than its styles, so ${name}'s declarations will not reach the stylesheet`,
    `Call it instead — cx(${name}(props), css({ … })) — or move the overrides into ${name} itself.`,
  ],
}

/**
 * What the build warns about a style it could not read, in parts: what is lost, why, what to do
 * about it, and where to read more. The build's warning is all four; the editor's diagnostic —
 * `@bamboocss/eslint-plugin`'s `no-unresolved-styles` — the first and the third, the same words.
 *
 * The two degrade apart. A `css()` or pattern call is replaced by its class string, so one whose
 * styles the build cannot read does not compile, and the compiler fails the build at it. A recipe's
 * calls are compiled from its config, which the build reads on its own: they compile to the classes
 * of what it read and without what it could not, so the element keeps the rest of the recipe's
 * styles and loses that one.
 */
export function explainUnresolvedStyle(entry: Pick<UnresolvedStyle, 'kind' | 'prop' | 'reason'>) {
  if (entry.kind === 'keyframes') {
    return {
      what: 'these stops will not reach the stylesheet because they are not statically known',
      why: 'The name `keyframes()` returns is a hash of its stops, so the build names a block, and writes it, only from stops it can read whole.',
      fix: "Write the stops out. What has to vary can be a custom property a stop reads, `opacity: 'var(--to)'`, or a property of the animation itself.",
      see: 'https://bamboocss.com/docs/concepts/keyframes',
    }
  }
  const name = entry.prop ? `\`${entry.prop}\`` : undefined
  const [loss, fix, recipeFix = fix] = unresolvedReasons[entry.reason](name)
  // The path is what makes several losses in one config distinguishable — without it they read
  // as identical lines at the same position. A loss naming it says where already.
  const what = name && !loss.includes(name) ? `${loss} at ${name}` : loss
  return entry.kind === 'recipe'
    ? {
        what,
        why: "A recipe's calls compile to the classes of the declarations the build can read in its config, so they compile without this one: the element gets the rest of the recipe's styles, and not this.",
        fix: recipeFix,
        see: 'https://bamboocss.com/docs/concepts/recipes',
      }
    : {
        what,
        why: 'A style call compiles to its class string at build time, with no runtime styling to fall back to, so this one does not compile: the compiler rejects it as `dynamic`, and the build fails.',
        fix,
        see: 'https://bamboocss.com/docs/guides/dynamic-styling',
      }
}

export class BambooContext extends Generator {
  runtime: Runtime
  project: SourceProject
  output: OutputEngine
  diff: DiffEngine
  explicitDeps: string[] = []

  /**
   * Files whose extraction threw, keyed by path, holding what it threw.
   *
   * A parse failure is not an opinion about a build that still works. The file's styles never
   * reach the encoder, so every rule it would have contributed is absent from the stylesheet
   * and the classes its components ask for have nothing behind them — the same shape as a
   * naming disagreement, and the reverse of `reportUnresolvedStyles`, where what the build
   * *did* see still applies. Logging it and carrying on is how a build printed error-level
   * lines, dropped rules, and exited 0.
   *
   * Retained rather than rethrown from the `catch`, so one pass names every broken file
   * instead of the first. Keyed by file, so a failure survives the incremental passes that
   * skip an unchanged file: nothing re-parses it, and its styles stay missing until it does.
   *
   * The error rather than its message, so `assertExtracted` can hand the originals on as a
   * `cause`. The aggregate carries a code of its own — `ERR_BAMBOO_EXTRACT_FAILED` — and the
   * codes underneath it are what a caller has to read to tell a retired token spelling from a
   * syntax error.
   */
  parseFailures = new Map<string, unknown>()

  /**
   * Files that call a binding their entrypoint no longer exports, keyed by path.
   *
   * Keyed and scoped exactly like `parseFailures`, and for the same reasons: an incremental
   * pass that skips an unchanged file does not re-parse it, so the finding has to outlive the
   * pass that recorded it or a no-op rebuild launders a broken build into a green one — and it
   * has to be dropped once the file is fixed, deleted, or leaves `include`, or the fix can
   * never take.
   */
  deadCalls = new Map<string, DeadImport[]>()

  /** Extraction results produced without materializing TypeScript ASTs. */
  private nativeExtractions = new Map<string, NativeFileAnalysis>()
  /** Native semantic reads retained across incremental passes. */
  private nativeDependencies = new Map<string, readonly string[]>()
  private nativePendingCandidates = new Map<string, readonly string[]>()
  private nativeConfigurationFiles = new Map<string, readonly string[]>()
  private nativeAuxiliaryFiles: readonly string[] = []
  /** Parser-hook output staged by the prefilter for the following native boundary. */
  private nativePreparedSources = new Map<
    string,
    { original: string; source: string; metadata: { options: ParserResultConfigureOptions; origins: boolean } }
  >()
  /** Per-file parser-hook options and whether a transform invalidated source locations. */
  private nativeSourceMetadata = new Map<string, { options: ParserResultConfigureOptions; origins: boolean }>()
  private parserHooks: LoadConfigResult['hooks']

  constructor(conf: LoadConfigResult)
  constructor(conf: LoadConfigResult) {
    super(conf)

    const config = conf.config
    this.runtime = nodeRuntime
    this.parserHooks = conf.hooks

    // Absolute, always. Every path the native engine reports and every overlay is keyed off it,
    // and a relative one made `parseFile` look for a result under a key nothing was stored at —
    // returning `undefined` with no failure recorded.
    config.cwd = this.runtime.path.resolve(this.runtime.cwd(), config.cwd || '.')

    if (config.logLevel) {
      logger.level = config.logLevel
    }

    // Disk, with caller-supplied bytes layered over it — what every native analysis reads.
    this.project = new SourceProject({
      cwd: config.cwd,
      readFile: (filePath) => this.runtime.fs.readFileSync(filePath),
      fileExists: (filePath) => this.runtime.fs.existsSync(filePath),
      compilerOptions: conf.tsconfig?.compilerOptions as SourceProject['resolutionOptions'] | undefined,
      parserOptions: this.parserOptions,
    })

    this.output = new OutputEngine(this)
    this.diff = new DiffEngine(this)
    this.explicitDeps = this.getExplicitDependencies()

    // Once per build, against the config actually being built. A class name is derived
    // both here and in the browser, and the two only meet in the DOM — where a mismatch
    // is silent and total. Failing now costs a build; not failing ships a blank app.
    const disagreement = checkNamingAgreement(this)
    if (disagreement) {
      throw new BambooError('NAMING_DISAGREEMENT', formatNamingDisagreement(disagreement))
    }
  }

  /**
   * Report style calls and recipe configs whose styles the build could not fully see.
   *
   * A warning rather than an error, since the error is the compiler's to give: a `css()` or pattern
   * call it cannot read fails the build where the compiler meets it, with the reason. A recipe's
   * calls compile without what its config does not let the build read, and this is the one report
   * that they do.
   */
  reportUnresolvedStyles = (result: { unresolved?: ParserResult['unresolved'] }) => {
    const unresolved = result.unresolved
    if (!unresolved?.length) return

    for (const entry of unresolved) {
      // Nothing under `outdir` is the author's to rewrite. `cssLeaf` calls `css({ [prop]:
      // value })` — a computed key, and so unenumerable by construction — which warned on
      // every build of every project whose `include` reaches its own output, with no edit
      // that would silence it and (until keyframe reachability stopped depending on that
      // overlap) no way to exclude the directory either. A permanent line in the same
      // channel as the losses that matter is how the ones that matter get ignored.
      if (this.isGenerated(entry.filePath)) continue

      const where = `${entry.filePath}:${entry.line}:${entry.column}`
      const { fix, see, what, why } = explainUnresolvedStyle(entry)
      logger.warn(entry.kind === 'recipe' ? 'recipe' : 'css', `${where} — ${what}. ${why} ${fix} See ${see}`)
    }
  }

  private getExplicitDependencies = () => {
    const { cwd, dependencies } = this.config
    if (!dependencies) return []
    return this.runtime.fs.glob({ include: dependencies, cwd })
  }

  /** What to do next, after `bamboo init`: `guide` names the installation guide for the project's framework. */
  initMessage = (guide?: string) => {
    return createBox({
      content: this.messages.codegenComplete(guide),
      title: this.messages.exclamation(),
    })
  }

  /**
   * The sources `include` names. `linked`, where given, is filled with where the glob began and
   * the folders and files it reached through a link: where a source may really be somewhere else.
   */
  getFiles = (linked?: string[]) => {
    const { include, exclude, cwd } = this.config
    return this.runtime.fs.glob({ include, exclude, cwd, linked })
  }

  /**
   * Fail the build if any file's extraction threw.
   *
   * Called at the end of an extraction pass rather than from the `catch`, so the message names
   * every broken file at once — a config with one retired token spelling in six components is
   * fixed once, not six builds in a row.
   *
   * This is what makes the integrations agree. `cssgen` already exited non-zero on a file it
   * could not extract, by letting the throw through; every bundler goes through `parseFile`,
   * which caught it. CI running a build passed what CI running `cssgen` rejected, over the same
   * source.
   *
   * `files` is the set still in scope, which the caller has usually just globbed. Deleting the
   * offending file, or taking it out of `include`, is a *fix* — and nothing re-parses a file
   * that is gone, so the entry that outlived it would fail every later build, naming a path
   * that no longer exists. A context outlives rebuilds (it is replaced only when the config
   * changes) and both long-lived integrations hold one, so that wedged a dev server until the
   * process was restarted.
   */
  assertExtracted = (files?: Iterable<string>) => {
    // Before the glob, so the common case costs nothing: no failures, no question to ask.
    if (!this.parseFailures.size) return

    const inScope = new Set(
      Array.from(files ?? this.getFiles(), (file) => this.runtime.path.abs(this.config.cwd, file)),
    )

    for (const file of this.parseFailures.keys()) {
      if (!inScope.has(file)) this.parseFailures.delete(file)
    }

    if (!this.parseFailures.size) return

    // Relative to `cwd`, like `formatDeclined` beside it — an absolute path per entry buries
    // the part that differs. Non-empty lines only, so a message with a blank line between
    // paragraphs does not gain a line of trailing whitespace per paragraph.
    // Not grouped, unlike the dead-call list: each of these carries a distinct parser message,
    // so there is nothing to collapse. Capped for the same reason — a broken codemod can fail
    // every file at once, and the paragraph below has to survive that.
    const detail = truncateList(
      Array.from(
        this.parseFailures.entries(),
        ([file, error]) => `${this.relative(file)}\n${messageOf(error).replace(/^(?=.)/gm, '  ')}`,
      ),
      { unit: 'file' },
    )

    throw new BambooError(
      'EXTRACT_FAILED',
      `${this.parseFailures.size} file(s) could not be extracted:\n\n${detail}\n\n` +
        `Nothing emits a rule for a file the build could not read, so every style in these is ` +
        `absent from the stylesheet and the classes their components ask for have nothing behind ` +
        `them.`,
      {
        // Always an `AggregateError`, including for one file, so a caller reads `cause.errors`
        // without first testing how many there were. This aggregates by construction — six
        // broken files can throw six different errors — and flattening that to whichever came
        // first would hand back an arbitrary one of them.
        cause: new AggregateError(
          Array.from(this.parseFailures.values()),
          `${this.parseFailures.size} file(s) could not be extracted`,
        ),
      },
    )
  }

  /**
   * Fail on a call to a binding the pattern or recipe entrypoint no longer exports.
   *
   * The same test `assertExtracted` applies, against the other way of arriving at the same
   * output. There the build could not read the file; here it read it and the call named
   * nothing, so the extractor recorded no styles and the class the component asks for has no
   * rule behind it. Both leave a green build and a stylesheet missing rules, which is the one
   * failure a diff of the output is the only way to notice.
   *
   * Not graded by a severity option, unlike an unresolved token path: that one is inferred
   * from a value's shape and can be wrong about a literal, while this is read off the
   * entrypoint's own export list. There is no configuration under which calling a binding
   * that does not exist is what someone meant.
   *
   * Scoped like `assertExtracted`, for the reasons given there — a file taken out of
   * `include` or deleted is a fix, and an entry naming a path that no longer exists would
   * fail every later build and wedge a dev server.
   */
  assertNoDeadCalls = (files?: Iterable<string>) => {
    if (!this.deadCalls.size) return

    const inScope = new Set(
      Array.from(files ?? this.getFiles(), (file) => this.runtime.path.abs(this.config.cwd, file)),
    )

    for (const file of this.deadCalls.keys()) {
      if (!inScope.has(file)) this.deadCalls.delete(file)
    }

    if (!this.deadCalls.size) return

    const entrypoint = { pattern: 'pattern', recipe: 'recipe' } as const

    // By the binding rather than by the file, because a dead binding is one mistake however
    // many call sites reach it. A pattern dropped from a preset and called across an app is
    // the case this exists for, and listing it per file said the same sentence 400 times —
    // 1,221 lines of stderr for one thing to fix, with the paragraph explaining it scrolled
    // off the top. Grouped, the same failure is four lines and reads as one cause.
    const occurrences = Array.from(this.deadCalls.entries()).flatMap(([file, calls]) =>
      calls.map((call) => ({ file, call })),
    )

    const detail = truncateList(
      Array.from(
        // Joined on NUL because no entrypoint, specifier, export or alias can contain one, so
        // the composite key cannot be ambiguous the way a space or a comma would be.
        //
        // It has to stay the escape sequence. Written as a literal control byte — which is how
        // it stood until now — ripgrep and grep classify the file as binary and drop every
        // match in it, so all 545 lines here were invisible to search.
        groupBy(occurrences, ({ call }) => `${call.entrypoint}\0${call.mod}\0${call.name}\0${call.alias}`),
        ([, group]) => {
          const { call } = group[0]!
          // The imported name when it was renamed, since that is the one the entrypoint would
          // have to export and the one to search a changelog for.
          const named = call.alias === call.name ? `\`${call.name}\`` : `\`${call.name}\` (called as \`${call.alias}\`)`
          // Distinct files: one module can call the same dead binding more than once, and
          // naming it twice in the list reads as two different places to look.
          const files = uniq(group.map(({ file }) => this.relative(file)))
          const shown = files.slice(0, 5).join(', ')
          const rest = files.length > 5 ? `, … and ${files.length - 5} more` : ''
          return (
            `${named} is not a ${entrypoint[call.entrypoint]} — \`${call.mod}\` does not export it.\n` +
            `  ${files.length} file(s): ${shown}${rest}`
          )
        },
      ),
      { unit: 'binding' },
    )

    const count = occurrences.length

    throw new BambooError(
      'DEAD_IMPORT',
      `${count} call(s) name a binding that does not exist:\n\n${detail}\n\n` +
        `Both entrypoints are generated from your config, so what they export moves when it ` +
        `does — a pattern dropped from a preset, a recipe renamed. The call survives that as a ` +
        `binding to nothing: nothing extracts it, so every rule it would have contributed is ` +
        `absent from the stylesheet and the classes their components ask for have nothing ` +
        `behind them.`,
    )
  }

  /**
   * A path as the user typed it when it is under `cwd`, spelled with `/` on every platform. On
   * Windows the glob hands over `C:/app/src/a.tsx` against a `cwd` of `C:\app`, so comparing the
   * two as spelled never matched, and every entry printed absolute.
   */
  private relative = (file: string) => {
    const { path } = this.runtime
    const inside = path.relative(this.config.cwd, file)
    return (inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? inside : file).replaceAll('\\', '/')
  }

  /**
   * Whether a file is one bamboo wrote.
   *
   * `include` conventionally covers a source tree that `outdir` sits inside — `./src/**` and
   * `src/styled-system` — so the build routinely parses its own output. That is load-bearing
   * rather than accidental, which is why the answer here is "do not report it" rather than
   * "do not read it": the token and keyframe scans read whatever `include` covers, and a
   * project that excludes its `outdir` should not lose them.
   */
  isGenerated = (file: string) => {
    const outdir = this.runtime.path.join(...this.paths.root)
    return file === outdir || file.startsWith(outdir + this.runtime.path.sep)
  }

  /**
   * The text extraction reads for a file: its `parser:before` output, or its bytes when no hook
   * rewrites it. `undefined` when the file cannot be read at all.
   *
   * The same preparation `analyzeMany` is handed, so every scan that compares "what the parser
   * holds" against "what is on disk" compares against what extraction actually saw.
   */
  parsedSourceText = (filePath: string, onDisk?: string): string | undefined => {
    const original = this.project.getSourceText(filePath) ?? onDisk
    if (original === undefined) return undefined
    return this.prepareNativeSource(filePath, original).source
  }

  /**
   * Token accounting for one file's text, in Rust — see `token-accounting.ts` for the rules.
   *
   * This used to walk the TypeScript tree, which meant reading `project.getSourceFile` for
   * every file mentioning a token, and that started the Go compiler over the whole inventory
   * on every stylesheet build, since `prune.tokens` defaults on.
   */
  accountTokens = (filePath: string, source: string): NativeTokenAccounting => {
    const { paths = {} } = this.project.resolutionOptions
    return this.loadNativeExtractor().accountTokens(
      filePath,
      source,
      this.imports.value.tokens,
      Object.entries(paths).map(([pattern, values]) => ({ pattern, paths: values })),
    )
  }

  /**
   * What the Vite compiler needs to know about modules, in one native call. See
   * `native-extractor/src/fold/model.rs`.
   *
   * `sources` are the modules to analyze, as the bundler hands them over. Every other module a
   * value is resolved through is read the way extraction reads it: its `parser:before` output
   * when a hook rewrites it, disk otherwise, and an overlay the project holds wins over both.
   */
  compileModules = (sources: NativeSource[], options: { references: boolean }): FoldAnalysis[] => {
    const { baseUrl, paths = {} } = this.project.resolutionOptions
    const own = new Set(sources.map((source) => source.filename.replaceAll('\\', '/')))
    const auxiliary: NativeSource[] = []
    const candidates =
      this.runtime === nodeRuntime
        ? [...this.hookedAuxiliaryFiles(), ...this.project.getOverriddenSources()]
        : [...this.nativeAuxiliaryFiles, ...this.project.getOverriddenSources()]
    for (const filePath of new Set(candidates)) {
      const filename = this.runtime.path.abs(this.config.cwd, filePath)
      if (own.has(filename.replaceAll('\\', '/'))) continue
      const prepared = this.auxiliarySource(filename, this.project.sourceIsOverridden(filename))
      if (prepared) auxiliary.push(prepared)
    }
    return this.loadNativeExtractor().compileModules(
      sources,
      auxiliary,
      {
        cwd: this.config.cwd,
        baseUrl,
        paths: Object.entries(paths).map(([pattern, values]) => ({ pattern, paths: values })),
        cssModules: this.imports.value.css,
        tokenModules: this.imports.value.tokens,
        recipeModules: this.imports.value.recipe,
        patternModules: this.imports.value.pattern,
        recipeNames: this.recipes.keys,
        patternNames: this.patterns.keys,
        references: options.references,
        classPrefix: this.utility.prefix || undefined,
      },
      this.nativeTokens,
    )
  }

  /**
   * The token table as the native evaluator reads it, converted into the native engine once per
   * context and handed to each call from then on.
   *
   * `compileModules` runs once per transformed module, and the table is every token in the
   * project. Rebuilding it priced the whole dictionary into every file, most of which never call
   * `token()`, and so did handing it over built: each call converted it into Rust again, about
   * 0.44 µs a token — 0.9 ms a module under `preset-atlaskit`'s 1,655 tokens, several times what
   * analyzing most modules takes.
   */
  private get nativeTokens(): NativeTokenTable {
    this.nativeTokenTable ??= this.loadNativeExtractor().tokenTable(
      this.tokens.allTokens.map((token) => ({
        path: token.name,
        value: this.tokens.view.get(token.name),
        variable: this.tokens.view.getVar(token.name),
      })),
    )
    return this.nativeTokenTable
  }
  private nativeTokenTable: NativeTokenTable | undefined

  /**
   * One auxiliary module as the native engine has to be handed it, or `undefined` when the
   * Rust resolver can read it off disk itself.
   *
   * Remembered across calls. `compileModules` runs once per transformed module, and a project
   * with any `parser:before` hook — every project, since the framework converters are built in
   * — used to read and hook every auxiliary file on each call: 3,615 files per transform on one
   * app, which made its production build spend 99% of 25 minutes in `readFileSync`. An entry is
   * reused while the file's size and modification time stand still and no overlay has moved.
   */
  private auxiliarySource = (filename: string, overridden: boolean): NativeSource | undefined => {
    const key = filename.replaceAll('\\', '/')
    let stamp: string
    if (overridden) stamp = `overlay:${this.project.overlayRevision}`
    else {
      try {
        const stat = statSync(filename)
        stamp = `${stat.mtimeMs}:${stat.size}`
      } catch {
        stamp = 'missing'
      }
    }
    const cached = this.auxiliarySources.get(key)
    if (cached && cached.stamp === stamp) return cached.source

    const original = this.project.getSourceText(filename)
    let source: NativeSource | undefined
    if (original !== undefined) {
      const prepared = this.prepareNativeSource(filename, original)
      if (prepared.source !== original || overridden || this.runtime !== nodeRuntime) {
        source = { filename, source: prepared.source }
      }
    }
    this.auxiliarySources.set(key, { stamp, source })
    return source
  }
  private auxiliarySources = new Map<string, { stamp: string; source: NativeSource | undefined }>()

  /**
   * The auxiliary files a `parser:before` hook rewrites — the only ones the native resolver
   * cannot read off disk itself. Decided once per inventory rather than per call: asking every
   * auxiliary file on each transform cost a `stat` of all 3,615 of them per module on one app.
   * A file event clears the entry for that path through `forgetNativeFile`, and a new
   * inventory recomputes the list.
   */
  private hookedAuxiliaryFiles = (): readonly string[] => {
    if (this.hookedAuxiliary) return this.hookedAuxiliary
    if (!this.parserHooks['parser:before']) return (this.hookedAuxiliary = [])
    this.hookedAuxiliary = this.nativeAuxiliaryFiles.filter((filePath) => {
      const filename = this.runtime.path.abs(this.config.cwd, filePath)
      return this.auxiliarySource(filename, false) !== undefined
    })
    return this.hookedAuxiliary
  }
  private hookedAuxiliary: readonly string[] | undefined

  private loadNativeExtractor = loadNativeExtractor

  private prepareNativeSource = (filePath: string, original: string) => {
    let parserOptions: ParserResultConfigureOptions = {}
    const source =
      this.parserHooks['parser:before']?.({
        filePath,
        content: original,
        configure: (options) => {
          parserOptions = { ...parserOptions, ...options }
        },
      }) ?? original
    return { original, source, metadata: { options: parserOptions, origins: source === original } }
  }

  /** Prepare a whole extraction pass in one coarse native invocation. */
  prepareNativeExtraction = (filePaths: readonly string[]) => {
    this.nativeExtractions.clear()
    this.nativeSourceMetadata.clear()
    const owners = new Set(
      filePaths.map((filePath) => this.runtime.path.abs(this.config.cwd, filePath).replaceAll('\\', '/')),
    )
    for (const owner of owners) {
      this.nativeDependencies.delete(owner)
      this.nativePendingCandidates.delete(owner)
      this.nativeConfigurationFiles.delete(owner)
    }
    const sources: NativeSource[] = []
    const auxiliary = [
      ...(this.parserHooks['parser:before'] || this.runtime !== nodeRuntime
        ? this.nativeAuxiliaryFiles
        : this.nativeAuxiliaryFiles.filter(this.project.sourceIsOverridden)),
      // Bytes a caller supplied, which the Rust resolver cannot find on disk.
      ...this.project.getOverriddenSources(),
    ]
    const inventory = uniq([...filePaths, ...auxiliary])
    for (const filePath of inventory) {
      if (filePath.endsWith('.json')) continue
      const filename = this.runtime.path.abs(this.config.cwd, filePath)
      const sourceKey = filename.replaceAll('\\', '/')
      let prepared = this.nativePreparedSources.get(sourceKey)
      if (!prepared) {
        let original = this.project.getSourceText(filename)
        if (original === undefined) {
          try {
            original = this.runtime.fs.readFileSync(filename)
          } catch (error) {
            // A source can disappear between the inventory glob and this batched read. It no
            // longer contributes styles, so the watcher handles the deletion on its own event.
            if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
            throw error
          }
        }
        prepared = this.prepareNativeSource(filename, original)
      }
      if (owners.has(sourceKey)) {
        this.nativeSourceMetadata.set(sourceKey, prepared.metadata)
        sources.push({ filename, source: prepared.source })
      } else if (
        prepared.source !== prepared.original ||
        this.runtime !== nodeRuntime ||
        this.project.sourceIsOverridden(filename)
      ) {
        // The Rust resolver can read an ordinary dependency itself. Only bytes it cannot see
        // on disk need to enlarge the cross-language source map.
        sources.push({ filename, source: prepared.source })
      }
    }
    if (!sources.length) {
      this.nativePreparedSources.clear()
      return
    }

    const entrypoints: NativeEntrypoint[] = [
      {
        kind: 'css',
        modules: this.imports.value.css,
        names: ['css', 'cva', 'sva', 'cx', 'fallback', 'viewTransition', 'keyframes'],
      },
      { kind: 'token', modules: this.imports.value.tokens, names: ['token'] },
      { kind: 'recipe', modules: this.imports.value.recipe, names: this.recipes.keys },
      { kind: 'pattern', modules: this.imports.value.pattern, names: this.patterns.keys },
    ]
    const { baseUrl, paths = {} } = this.project.resolutionOptions
    const options: NativeProjectOptions = {
      cwd: this.config.cwd,
      baseUrl,
      paths: Object.entries(paths).map(([pattern, values]) => ({ pattern, paths: values })),
      jsx: this.jsx.isEnabled,
      classPrefix: this.utility.prefix || undefined,
    }
    let analyses: NativeFileAnalysis[]
    try {
      analyses = this.loadNativeExtractor().analyzeMany(sources, entrypoints, options, this.nativeTokens)
    } finally {
      this.nativePreparedSources.clear()
    }
    for (const analysis of analyses) {
      const owner = analysis.filename.replaceAll('\\', '/')
      if (!owners.has(owner)) continue
      this.nativeExtractions.set(owner, analysis)
      this.nativeDependencies.set(owner, analysis.dependencies)
      this.nativePendingCandidates.set(owner, analysis.pendingCandidates)
      this.nativeConfigurationFiles.set(owner, analysis.configurationFiles)
    }
  }

  /** Included extraction owners whose native value graph reaches `filePath`, transitively. */
  getNativeDependents = (filePath: string): string[] => {
    const changed = filePath.replaceAll('\\', '/')
    const selected = new Set<string>()
    let frontier = [changed]
    while (frontier.length) {
      const next: string[] = []
      for (const dependency of frontier) {
        for (const [owner, dependencies] of this.nativeDependencies) {
          const pending = this.nativePendingCandidates.get(owner) ?? []
          if (
            selected.has(owner) ||
            ![...dependencies, ...pending].some((item) => item.replaceAll('\\', '/') === dependency)
          )
            continue
          selected.add(owner)
          next.push(owner)
        }
      }
      frontier = next
    }
    return [...selected]
  }

  /** @internal Native dependency edges, from dependency to extraction owner. */
  getNativeDependencyLedger = (): Array<readonly [string, string]> =>
    [...this.nativeDependencies].flatMap(([owner, dependencies]) =>
      dependencies.map((dependency) => [dependency.replaceAll('\\', '/'), owner] as const),
    )

  /** An edited file's hooked source, which the next compile has to prepare again. */
  forgetAuxiliarySource = (filePath: string) => {
    this.auxiliarySources.delete(this.runtime.path.abs(this.config.cwd, filePath).replaceAll('\\', '/'))
    this.hookedAuxiliary = undefined
  }

  forgetNativeFile = (filePath: string) => {
    const file = this.runtime.path.abs(this.config.cwd, filePath).replaceAll('\\', '/')
    this.auxiliarySources.delete(file)
    // Whether the hook rewrites this file may have changed with its content.
    this.hookedAuxiliary = undefined
    this.nativeDependencies.delete(file)
    this.nativePendingCandidates.delete(file)
    this.nativeConfigurationFiles.delete(file)
    this.nativeExtractions.delete(file)
    this.nativeSourceMetadata.delete(file)
    // Every caller is a deletion, and nothing parses a deleted file again to replace these. Keyed
    // as `parseFile` keys them, with the platform's separators.
    this.unresolvedTokenCalls.delete(this.runtime.path.abs(this.config.cwd, filePath))
  }

  private parseNativeFile = (filePath: string, native: NativeFileAnalysis, encoder: StyleEncoder) => {
    if (native.errors.length) {
      throw new BambooError(
        'NATIVE_EXTRACTION',
        `Native extraction failed for ${filePath}:\n${native.errors.join('\n')}`,
      )
    }
    const result = new ParserResult(this.parserOptions, encoder).setFilePath(filePath)
    result.native = true
    result.nativePendingCandidates = native.pendingCandidates
    result.nativeConfigurationFiles = native.configurationFiles
    for (const dependency of native.dependencies) result.addDependency(dependency)
    const metadata = this.nativeSourceMetadata.get(filePath.replaceAll('\\', '/'))
    result.origins = metadata?.origins ?? true
    let tokenTable: ReadonlyMap<string, unknown> | undefined
    for (const call of native.calls) {
      const atomOrigin =
        encoder.recordOrigins && result.origins ? { filePath, line: call.line, column: call.column } : undefined
      if (call.kind === 'jsx') {
        const tags = [call.name, call.importedName]
        const recipeTag = tags.find((tag) => this.jsx.isJsxTagRecipe(tag))
        const isBambooComponent = Boolean(recipeTag)
        const matches = metadata?.options.matchTag
          ? metadata.options.matchTagMode === 'override'
            ? metadata.options.matchTag(call.name, isBambooComponent)
            : isBambooComponent || metadata.options.matchTag(call.name, isBambooComponent)
          : isBambooComponent
        if (!matches || !recipeTag) continue

        const data = (call.arguments as Record<string, unknown>[]).map((properties) =>
          Object.fromEntries(
            Object.entries(properties).filter(([property]) => {
              const isRecipeProperty = this.jsx.isRecipeProp(recipeTag, property)
              return metadata?.options.matchTagProp
                ? isRecipeProperty && metadata.options.matchTagProp(call.name, property)
                : isRecipeProperty
            }),
          ),
        )
        for (const recipe of this.recipes.filter(recipeTag)) {
          result.setRecipe(
            recipe.baseName,
            { type: 'jsx-recipe', name: call.name, data, atomOrigin },
            new Set(call.unresolvedKeys),
          )
        }
        continue
      }
      const item = {
        name: call.importedName,
        data: call.arguments as Record<string, unknown>[],
        atomOrigin,
        tokenCalleeRange:
          call.kind === 'token' || call.kind === 'tokenValue'
            ? { start: call.calleeStart, end: call.calleeEnd }
            : undefined,
      }
      const recipeConfig = call.kind === 'css' && (call.importedName === 'cva' || call.importedName === 'sva')
      const explicitlyNamed =
        recipeConfig && item.data.every((data) => typeof data.className === 'string' && data.className !== '')
      const keyframes = call.kind === 'css' && call.importedName === 'keyframes'
      if (!explicitlyNamed && !keyframes) {
        for (const loss of call.losses) {
          result.unresolved.push({
            kind: recipeConfig ? 'recipe' : 'atomic',
            prop: loss.prop,
            filePath,
            line: call.line,
            column: call.column,
            reason: loss.reason,
          })
        }
      }
      if (call.kind === 'css' && ['css', 'cva', 'sva'].includes(call.importedName)) {
        result.set(call.importedName as 'css' | 'cva' | 'sva', item)
      } else if (call.kind === 'css' && call.importedName === 'viewTransition') {
        result.setViewTransition(item)
      } else if (keyframes) {
        // No name when the stops were not read whole, and so no block: the build cannot say what
        // the call returns. One loss for the call, as a missing declaration loses the block whole.
        if (call.value !== undefined) result.setKeyframes(item, call.value)
        else {
          result.unresolved.push({
            kind: 'keyframes',
            filePath,
            line: call.line,
            column: call.column,
            reason: 'unresolvable-value',
          })
        }
      } else if (call.kind === 'pattern') result.setPattern(call.importedName, item)
      else if (call.kind === 'recipe') result.setRecipe(call.importedName, item, new Set(call.unresolvedKeys))
      else if (call.kind === 'token' || call.kind === 'tokenValue') {
        result.setToken(item, call.kind)
        // Only paths the build is sure of, used as they are. One it guessed is not the path the
        // runtime looks up, an argument it could not read whole may hold others it did not see,
        // and `token(path) ?? '#fff'` is written for a path that may name nothing.
        if (call.complete && !call.guarded) {
          // Every call extraction reads passes through here, and almost every path names a token,
          // so that much is one lookup; only a miss asks `unresolvedTokenCall` why.
          tokenTable ??= this.tokens.view.values
          for (let index = 0; index < call.arguments.length; index++) {
            const path = call.arguments[index]
            if (typeof path !== 'string' || tokenTable.has(path)) continue
            // Branches of a ternary can repeat a path, which is one mistake.
            if (call.arguments.indexOf(path) !== index) continue
            const unresolved = this.utility.unresolvedTokenCall(call.kind === 'token' ? 'token' : 'token.value', path)
            if (unresolved) {
              result.unresolvedTokenCalls.push({ call: unresolved, filePath, line: call.line, column: call.column })
            }
          }
        }
      } else if (call.kind === 'dead') {
        result.deadCalls.push({
          name: call.importedName,
          alias: call.name,
          mod: call.module,
          entrypoint: this.imports.value.pattern.some((module) => call.module.includes(module)) ? 'pattern' : 'recipe',
        })
      }
    }
    this.parserHooks['parser:after']?.({ filePath, result })
    return result
  }

  parseFile = (filePath: string, styleEncoder?: StyleEncoder) => {
    const file = this.runtime.path.abs(this.config.cwd, filePath)
    const nativeFile = file.replaceAll('\\', '/')
    logger.debug('file:extract', file)

    const measure = logger.time.debug(`Parsed ${file}`)

    let result: ParserResult | undefined

    try {
      const encoder = styleEncoder || this.parserOptions.encoder
      // The extraction pass's reading of this file, which replaces whatever its last reading
      // encoded. A bundler that also parses the module during `transform` records that
      // separately -- see `StyleEncoder.withOwner` for why the two are not one owner.
      if (file.endsWith('.json')) {
        result = encoder.withOwner('extract', file, () => this.project.parseJson(file, encoder))
      } else {
        if (!this.nativeExtractions.has(nativeFile)) this.prepareNativeExtraction([file])
        const native = this.nativeExtractions.get(nativeFile)
        if (!native && !this.runtime.fs.existsSync(file)) {
          encoder.releaseFile(file)
          this.parseFailures.delete(file)
          this.deadCalls.delete(file)
          this.unresolvedTokenCalls.delete(file)
          measure()
          return undefined
        }
        if (!native) throw new BambooError('NATIVE_EXTRACTION', `Native extraction produced no result for ${file}.`)
        result = encoder.withOwner('extract', file, () => this.parseNativeFile(file, native, encoder))
      }
      this.nativeExtractions.delete(nativeFile)
      this.nativeSourceMetadata.delete(nativeFile)
      this.parseFailures.delete(file)
    } catch (error) {
      // A failed result cannot be retried after an edit. Successful parses consume their
      // prepared result above; failures must do the same or the stale native analysis wedges
      // every later incremental pass on the original error.
      this.nativeExtractions.delete(nativeFile)
      this.nativeSourceMetadata.delete(nativeFile)
      logger.caughtError('file:extract', `Failed to parse ${file}`, error)
      this.parseFailures.set(file, error)
    }

    if (result) {
      this.reportUnresolvedStyles(result)

      // Set-or-delete on every parse, like `parseFailures` above: a file that no longer calls
      // a dead binding has fixed it, and an entry that outlived the fix would fail every
      // later build. Recorded rather than thrown here so one pass names every file.
      if (result.deadCalls.length) this.deadCalls.set(file, result.deadCalls)
      else this.deadCalls.delete(file)

      this.recordUnresolvedTokenCalls(file, result)
    }

    measure()
    return result
  }

  /**
   * Keep a file's `token()` calls naming no token for the sheet's check, and warn about them when
   * the token half of `unresolvedToken` is `warn`.
   *
   * Set or deleted on every parse, like `deadCalls` and for the same reason: a file read again
   * without them has fixed them, and an entry outliving the fix would fail every later build. A
   * file under `outdir` is left out, as `reportUnresolvedStyles` leaves it: nothing there is the
   * author's to rewrite.
   */
  private recordUnresolvedTokenCalls = (file: string, result: ParserResult) => {
    const found = this.isGenerated(file) ? [] : result.unresolvedTokenCalls
    if (!found.length) {
      this.unresolvedTokenCalls.delete(file)
      return
    }

    const sites = found.map(({ call, line, column }) => ({ call, where: `${this.relative(file)}:${line}:${column}` }))
    this.unresolvedTokenCalls.set(file, sites)

    // `error` reports them with the sheet instead, every missing token in one list.
    if (this.utility.unresolvedToken.token !== 'warn') return
    for (const { call, where } of sites) {
      logger.warn('token', `${where} — ${this.utility.explainUnresolvedTokenCall(call)}`)
    }
  }

  /**
   * Drop the `token()` call findings of every file outside `files`, as `assertNoDeadCalls` drops
   * its own: one deleted or taken out of `include` is not parsed again, so its entry would fail
   * every later sheet, naming a file that is no longer part of the build.
   */
  forgetUnresolvedTokenCallsOutside = (files: Iterable<string>) => {
    if (!this.unresolvedTokenCalls.size) return

    const inScope = new Set(Array.from(files, (file) => this.runtime.path.abs(this.config.cwd, file)))
    for (const file of this.unresolvedTokenCalls.keys()) {
      if (!inScope.has(file)) this.unresolvedTokenCalls.delete(file)
    }
  }

  /**
   * Extract every file in one pass, and fail on the ones that could not be read.
   *
   * Routed through `parseFile` rather than parsing directly, so the two entry points cannot
   * disagree about what a failure means. This one used to let the first throw out, which is
   * why `cssgen` and a bundler build reported different things about the same source.
   */
  /**
   * The entrypoint specifiers, as `ImportMap` matches them.
   *
   * Every `mods` list at once rather than the `css` one alone: a file whose only bamboo import
   * is a recipe, a pattern or `token` originates calls just as surely, and leaving those out
   * would skip it.
   */
  private get entrypointSpecifiers(): string[] {
    return uniq(Object.values(this.imports.matchers).flatMap((matcher) => matcher.mods))
  }

  /**
   * The files this pass has to read, out of everything `include` matched: each real file once, and
   * of those the ones that can reach an entrypoint.
   *
   * See `firstSpellingOfEachFile`, given `linked` — what the glob reported reaching through a link —
   * and `selectExtractable`. Kept behind a method so the reasons live in one place and a caller
   * that wants the whole inventory — the watcher, the token scan — is unaffected: this narrows
   * what is *parsed*, not what the project holds.
   */
  extractableFiles = (files: readonly string[], linked: readonly string[] = []): string[] => {
    files = firstSpellingOfEachFile(files, linked)
    this.nativePreparedSources.clear()
    const { baseUrl, paths } = this.project.resolutionOptions
    const measure = logger.time.debug('Selected extractable files')
    const { auxiliary, extractable } = selectExtractable(files, {
      baseUrl,
      cwd: this.config.cwd,
      entrypoints: this.entrypointSpecifiers,
      paths,
      fileExists: this.project.sourceExists,
      readFile: (filePath) => {
        try {
          const original = this.project.getSourceText(filePath) ?? this.runtime.fs.readFileSync(filePath)
          const filename = this.runtime.path.abs(this.config.cwd, filePath)
          const prepared = this.prepareNativeSource(filename, original)
          this.nativePreparedSources.set(filename.replaceAll('\\', '/'), prepared)
          return prepared.source
        } catch {
          // Unreadable is not "contributes nothing"; `selectExtractable` keeps it.
          return undefined
        }
      },
    })

    this.nativeAuxiliaryFiles = auxiliary
    this.hookedAuxiliary = undefined

    // Auxiliary modules remain outside the TypeScript project. The native resolver reads
    // ordinary files lazily; virtual, overridden, and parser-transformed sources cross in the
    // same coarse source map as their extraction owners.

    // The first question to ask of a rule that went missing is whether its file was read at
    // all, so the count is reachable without a debugger — `BAMBOO_DEBUG=file:extract`.
    logger.debug(
      'file:extract',
      `${extractable.length} of ${files.length} file(s) can reach a bamboo entrypoint; ` +
        `${files.length - extractable.length} cannot and are not parsed; ` +
        `${auxiliary.length} local import target(s) sit outside the inventory`,
    )
    measure()
    return extractable
  }

  parseFiles = (styleEncoder?: StyleEncoder) => {
    const encoder = styleEncoder || this.parserOptions.encoder

    const linked: string[] = []
    const files = this.extractableFiles(this.getFiles(linked), linked)
    this.prepareNativeExtraction(files)
    const filesWithCss = [] as string[]
    const results = [] as ParserResult[]

    files.forEach((file) => {
      // `parseFile` reports unresolved styles itself, before the empty checks below: a file
      // whose only `css()` call was unresolvable produces no styles at all, which is exactly
      // the case worth warning about.
      const result = this.parseFile(file, encoder)

      if (!result || result.isEmpty()) return

      // Token calls are parser output even though they encode no CSS. Keep their lightweight
      // source facts available to stylesheet assembly; otherwise a token-only file disappears
      // from `results` and an extractor-resolved constant falls back to the whole token layer.
      results.push(result)

      if (encoder.isEmpty()) return

      filesWithCss.push(file)
    })

    this.forgetUnresolvedTokenCallsOutside(files)
    this.assertExtracted(files)
    this.assertNoDeadCalls(files)

    return {
      filesWithCss,
      files,
      results,
    }
  }

  writeCss = (sheet?: Stylesheet) => {
    logger.info('css', this.runtime.path.join(...this.paths.root, 'styles.css'))
    return this.output.write({
      id: 'styles.css',
      dir: this.paths.root,
      files: [{ file: 'styles.css', code: this.getCss(sheet) }],
    })
  }

  writeSplitCss = async (sheet: Stylesheet) => {
    const { path: pathUtil, fs } = this.runtime
    const rootDir = this.paths.root
    const stylesDir = [...rootDir, 'styles']

    const artifacts = this.getSplitCssArtifacts(sheet)

    // Derive and create directories from artifacts
    const subDirs = new Set(artifacts.themes.map((a) => a.dir).filter(Boolean))
    fs.ensureDirSync(pathUtil.join(...stylesDir))
    subDirs.forEach((dir) => fs.ensureDirSync(pathUtil.join(...stylesDir, dir!)))

    // Collect all files for batched write
    const styleFiles: Array<{ file: string; code: string }> = []

    // Layer files
    for (const layer of artifacts.layers) {
      styleFiles.push({ file: layer.file, code: layer.code })
      logger.info('css', pathUtil.join(...stylesDir, layer.file))
    }

    // Theme files
    for (const theme of artifacts.themes) {
      styleFiles.push({ file: `${theme.dir}/${theme.file}`, code: theme.code })
      logger.info('css', pathUtil.join(...stylesDir, theme.dir!, theme.file))
    }

    // Write all split files to styles/ directory
    await this.output.write({
      id: 'styles',
      dir: stylesDir,
      files: styleFiles,
    })

    // Write main styles.css
    logger.info('css', pathUtil.join(...rootDir, 'styles.css'))
    await this.output.write({
      id: 'styles.css',
      dir: rootDir,
      files: [{ file: 'styles.css', code: artifacts.index }],
    })

    // Compiled emission no longer owns per-recipe files. A previous `--splitting` run left
    // `styles/recipes/` on disk, and nothing else deletes it — codegen's prune skips `styles/`
    // on purpose. Drop the leftovers here so a rebuild cannot keep serving named recipe rules
    // beside the atom sheet.
    const recipesIndex = pathUtil.join(...stylesDir, 'recipes.css')
    const recipesDir = pathUtil.join(...stylesDir, 'recipes')
    if (fs.existsSync(recipesIndex)) fs.rmFileSync(recipesIndex)
    if (fs.existsSync(recipesDir)) fs.rmFileSync(recipesDir)
  }

  /**
   * Call `cb` when a file the config is built from changes.
   *
   * `cb` reloads the config, and hands the context it built to `reloaded` as soon as it has one, so
   * the watch can follow what that config is built from. Armed once with this context's files, an
   * edit that swapped in a preset, or imported one more module, left the new file unwatched:
   * editing it did nothing until the process restarted. Handed over before `cb` builds, because a
   * build can fail where the reload did not — a recipe in the new preset naming no token — and the
   * file to fix is that preset.
   */
  watchConfig = (
    cb: (file: string, reloaded: (ctx: BambooContext) => void) => BambooContext | void | Promise<BambooContext | void>,
    opts?: Omit<WatchOptions, 'include'>,
  ) => {
    const { cwd, poll, exclude } = opts ?? {}
    logger.info('ctx:watch', this.messages.configWatch())

    const arm = (include: string[]) => {
      const watcher = this.runtime.fs.watch({ include, exclude, cwd, poll })
      // A dependency appearing is a change too: the config's tsconfigs include a referenced project
      // that does not exist yet. One going is not — a checkout removes and restores files, and the
      // config would fail to load in between.
      watcher.on('all', (event, file) => {
        if (event === 'add' || event === 'change') void rebuild(file)
      })
      return watcher
    }

    let files = this.configFiles()
    let watcher = arm(files)

    const rearm = async (nextFiles: string[]) => {
      if (nextFiles.join('\n') === files.join('\n')) return
      // The new one first, so an edit landing in between still has a watcher to reach.
      const previous = watcher
      files = nextFiles
      watcher = arm(files)
      await previous.close()
    }

    const rebuild = debounce(async (file: string) => {
      logger.info('ctx:change', 'config changed, rebuilding...')
      const reload: { ctx?: BambooContext } = {}
      try {
        const next = await cb(file, (ctx) => {
          reload.ctx = ctx
        })
        if (next) reload.ctx = next
      } catch (error) {
        logger.error('ctx:rebuild', error instanceof Error ? error.message : String(error))
        // Reloaded and then failed to build: the reloaded context names its files. Failed to load:
        // nothing was built to say what the config is built from now, and the file that broke it is
        // the one about to be fixed, so what the load read is followed instead, with what the
        // config imports beside what was watched already.
        const reloaded = reload.ctx
        const nextFiles = reloaded
          ? reloaded.configFiles()
          : uniq([...files, ...this.importedFiles(), ...filesReadBy(error)]).sort()
        await reportRebuildFailure(() => rearm(nextFiles))
        return
      }
      const reloaded = reload.ctx
      if (reloaded) await reportRebuildFailure(() => rearm(reloaded.configFiles()))
    })
  }

  /**
   * The files the config is built from: the config, what it imports, the presets it names by path,
   * and its `dependencies` — as patterns too, so a file that starts to match one is seen.
   */
  private configFiles = () =>
    uniq([...this.explicitDeps, ...this.conf.dependencies, ...(this.config.dependencies ?? [])]).sort()

  /** What the config file imports, read off its source without running it, for a config that failed to load. */
  private importedFiles = (): string[] => {
    try {
      return [...getConfigDependencies(this.conf.path, this.conf.tsOptions, this.conf.tsconfig?.compilerOptions).deps]
    } catch {
      return []
    }
  }

  watchFiles = (
    cb: (event: WatcherEventType, file: string) => void | Promise<void>,
    opts?: Omit<WatchOptions, 'include' | 'exclude' | 'poll' | 'cwd' | 'logger'>,
  ) => {
    const { include, exclude, poll, cwd } = this.config
    logger.info('ctx:watch', this.messages.watch())

    const watcher = this.runtime.fs.watch({
      ...opts,
      include,
      exclude,
      poll,
      cwd,
    })

    const onFile = debounce(async (event: WatcherEventType, file: string) => {
      logger.info(`file:${event}`, file)
      await reportRebuildFailure(() => cb(event, file))
    })
    // Not waited on, like `rebuild` above: `reportRebuildFailure` catches what a rebuild throws,
    // so this never rejects.
    watcher.on('all', (event, file) => void onFile(event, file))
  }
}

/**
 * Report a failed rebuild as a failed rebuild.
 *
 * Chokidar is an `EventEmitter`, so it discards whatever a listener returns, and the debounce
 * wrapper attaches no rejection handler — a throw from inside a rebuild became a dangling
 * promise. `node-runtime.ts` then catches it as `Unhandled rejection`, which labels a config
 * error as an internal crash, leaves the exit code at 0, and is suppressed entirely at
 * `logLevel: 'silent'`. The initial build is caught by the CLI and prints properly; only
 * rebuilds of the identical source were silent, which is the worse half of the asymmetry.
 *
 * Caught rather than rethrown: a watcher's job is to survive a bad intermediate state and
 * rebuild when the next edit fixes it. What it must not do is claim success.
 */
async function reportRebuildFailure(run: () => void | Promise<void>) {
  try {
    await run()
  } catch (error) {
    logger.error('ctx:rebuild', error instanceof Error ? error.message : String(error))
  }
}
