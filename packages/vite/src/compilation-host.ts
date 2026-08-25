import { createLazyBuilder } from './lazy-modules'

/** The one `Builder` a Vite run owns, whichever plugin is holding it. */
export type CompilationBuilder = Awaited<ReturnType<ReturnType<typeof createLazyBuilder>>>

type Builder = CompilationBuilder
type BambooContext = NonNullable<Builder['context']>

/**
 * One resolved context, and the identity every derived value has to be keyed on.
 *
 * `Builder.setup` replaces its context whenever the config reloads, and everything the
 * compiler derives — the in-process `css` runtime, the style-set compiler, the token table,
 * the parse sink below — is a function of that object. Holding them past a replacement is how
 * a build ends up naming classes from one config against a stylesheet emitted from another,
 * which is silent: both halves are internally consistent and only disagree in the DOM.
 */
export interface CompilationGeneration {
  /** Monotonic, and bumped only when `Builder.context` is a different object. */
  readonly id: number
  readonly context: BambooContext
  /**
   * Where the compiler's parses go.
   *
   * The compiler and the stylesheet now share one context, so a transform parsing a module
   * would otherwise add that reading to the encoder the sheet is emitted from — a second,
   * unowned contribution for every module in the graph, on top of the extraction pass's own.
   * A clone is the same encoder against the same context with nothing in it, so the parse
   * behaves identically and reaches nothing the sheet is built from.
   */
  readonly encoder: BambooContext['encoder']
}

export interface CompilationHostOptions {
  configPath?: string
  cwd?: string
  /** Injectable Builder construction, so lifecycle tests need no `@bamboocss/node` load. */
  loadBuilder?: () => Promise<Builder>
}

export type CompilationSourceChangeEvent = 'create' | 'update' | 'delete'

export interface CompilationSourceChangeOptions {
  /** A `config.dependencies` glob gained or lost this path. */
  needsConfigReload?: boolean
}

/**
 * The single owner of Bamboo's build state inside one Vite run.
 *
 * There used to be two. The CSS plugin held a `Builder`, and the compiler separately called
 * `loadConfigAndCreateContext` — so a project got two resolved configs, two `BambooContext`
 * objects and two complete ts-morph projects holding the same files, and neither could see
 * what the other established. That is what made a config edit a server *restart* rather than
 * a rebuild: only one of the two reloaded, and half-updated is worse than stale.
 *
 * Sharing them makes the two halves agree, and makes ordering matter. The compiler runs
 * `enforce: 'pre'`, so its `buildStart` reaches this before the CSS plugin's does, and both
 * may be entered once per environment concurrently — so setup is single-flighted rather than
 * repeated, and a CSS pass joins whatever the pre-hook already started rather than reloading
 * the config a second time. What must not move is `emit`: the generated `styled-system` has
 * to be on disk before Rollup resolves the first import of it, and that is still the CSS
 * plugin's `buildStart`, ahead of all resolution either way.
 */
export interface CompilationHost {
  /** Set once per run from `configResolved`; only a dev server knows it is one. */
  setCommand(command: 'build' | 'serve'): void
  /** The current generation, without loading anything. `undefined` before the first setup. */
  current(): CompilationGeneration | undefined
  /**
   * A context to compile against, setting one up only if no pass has produced one yet.
   *
   * Deliberately not a setup per caller. `Builder.setup` is also the pass that decides which
   * files a rebuild re-extracts, and running it from a transform would consume that verdict
   * where nothing extracts — the following stylesheet pass would then find nothing changed.
   */
  ensureGeneration(): Promise<CompilationGeneration>
  /**
   * Run one stylesheet pass: setup, emit, extract and `toCss`, with no compiler AST mutation
   * interleaved into it.
   */
  runCssPass<T>(run: (builder: Builder, generation: CompilationGeneration) => Promise<T>): Promise<T>
  /** Whether a stylesheet pass currently holds the shared AST. */
  isCssPassActive(): boolean
  /**
   * Run synchronous compiler work once the shared AST is free.
   *
   * `run` must be synchronous: that is what makes the wait sufficient. Nothing can start a
   * stylesheet pass between the last check and the call, because nothing else runs.
   */
  runCompilerWork<T>(run: () => T): Promise<T>
  /** Record a filesystem event even when the changed file is not a compiler-transformable module. */
  noteSourceChange(
    filePath: string,
    event: CompilationSourceChangeEvent,
    options?: CompilationSourceChangeOptions,
  ): void
  /** Refresh one edited source in the shared Project. @see `Builder.reloadSource` */
  reloadSource(filePath: string): void
  /** Drop one deleted source from the shared Project. @see `Builder.removeSource` */
  removeSource(filePath: string): void
}

export const createCompilationHost = (options: CompilationHostOptions = {}): CompilationHost => {
  const { configPath, cwd } = options
  const loadBuilder = options.loadBuilder ?? createLazyBuilder()

  let command: 'build' | 'serve' = 'build'
  let builder: Builder | undefined
  let generation: CompilationGeneration | undefined
  let nextGenerationId = 0

  /**
   * The setup covering the pass currently open.
   *
   * A cold start reaches this twice — the compiler's `pre` `buildStart`, then the CSS
   * plugin's — for one instant in which nothing can have changed on disk. Sharing one attempt
   * across both is what keeps a project from loading and evaluating its config twice per
   * build. Cleared once a stylesheet pass consumes it, and on any source mutation, so no
   * later pass can be answered by a setup taken before an edit.
   */
  let openSetup: Promise<CompilationGeneration> | undefined
  let openSetupStale = false
  let cssPass: Promise<void> | undefined
  let changedSourceFiles = new Set<string>()
  let needsInventoryScan = false
  let needsConfigReload = false

  const recordSourceChange = (
    filePath: string,
    event: CompilationSourceChangeEvent,
    options?: CompilationSourceChangeOptions,
  ) => {
    changedSourceFiles.add(filePath)
    if (event !== 'update') needsInventoryScan = true
    needsConfigReload ||= options?.needsConfigReload === true
    openSetupStale = true
  }

  const takeSourceChanges = () => {
    const changes = {
      files: [...changedSourceFiles].sort(),
      needsInventoryScan,
      ...(needsConfigReload ? { needsConfigReload: true } : {}),
    }
    changedSourceFiles = new Set()
    needsInventoryScan = false
    needsConfigReload = false
    return changes
  }

  const restoreSourceChanges = (changes: {
    files: readonly string[]
    needsInventoryScan?: boolean
    needsConfigReload?: boolean
  }) => {
    for (const file of changes.files) changedSourceFiles.add(file)
    needsInventoryScan ||= changes.needsInventoryScan === true
    needsConfigReload ||= changes.needsConfigReload === true
  }

  const settled = async (attempt: Promise<unknown>) => {
    try {
      await attempt
    } catch {
      // Whoever started it owns the rejection. Callers waiting here only need it to be over.
    }
  }

  const publish = (): CompilationGeneration => {
    const context = builder!.getContextOrThrow()
    if (generation?.context !== context) {
      generation = { id: ++nextGenerationId, context, encoder: context.encoder.clone() }
    }
    return generation
  }

  const runSetup = async () => {
    builder ??= await loadBuilder()
    const sourceChanges = takeSourceChanges()
    // `hash: 'auto'` reads `dev`, and nothing else does — a class name may differ between dev
    // and production, the CSS may not.
    try {
      await builder.setup({
        configPath,
        cwd,
        dev: command === 'serve',
        ...(command === 'serve' ? { sourceChanges } : {}),
      })
      return publish()
    } catch (error) {
      if (command === 'serve') restoreSourceChanges(sourceChanges)
      throw error
    }
  }

  /**
   * The setup covering the pass currently open, started at most once.
   *
   * Started through a resolved promise, so a synchronous throw becomes the same
   * rejected-attempt contract a failed module load has and a later hook can retry it. A
   * source mutation observed while one is in flight does not cancel it — two overlapping
   * `Builder.setup` calls would interleave their change detection — it queues a fresh one
   * behind it.
   */
  const setupOnce = (): Promise<CompilationGeneration> => {
    const previous = openSetup
    if (previous && !openSetupStale) return previous
    openSetupStale = false
    const attempt = previous ? settled(previous).then(runSetup) : Promise.resolve().then(runSetup)
    openSetup = attempt
    void attempt.catch(() => {
      if (openSetup === attempt) openSetup = undefined
    })
    return attempt
  }

  return {
    setCommand(next) {
      command = next
    },

    current: () => generation,

    async ensureGeneration() {
      // A stylesheet pass may be replacing `generation` through `Builder.setup`. Returning
      // the last published one while that pass is open lets a transform derive against N,
      // wait for the AST lock, then fold after the sheet was emitted from N+1.
      if (cssPass) {
        await settled(cssPass)
      }
      if (generation) return Promise.resolve(generation)
      return setupOnce()
    },

    isCssPassActive: () => cssPass !== undefined,

    async runCssPass(run) {
      while (cssPass) await settled(cssPass)

      let release!: () => void
      const pass = new Promise<void>((resolve) => {
        release = resolve
      })
      cssPass = pass

      try {
        const passGeneration = await setupOnce()
        return await run(builder!, passGeneration)
      } finally {
        // Consumed. The next pass runs setup again, which is what notices the edits made
        // since this one — `Builder.setup` is where changed files are detected and selected.
        openSetup = undefined
        openSetupStale = false
        cssPass = undefined
        release()
      }
    },

    async runCompilerWork(run) {
      while (cssPass) await settled(cssPass)
      return run()
    },

    noteSourceChange(filePath, event, options) {
      // Production watch retains Builder's filesystem discovery. The journal is authoritative
      // only where configureServer installs the complementary add/delete watcher.
      if (command === 'serve') recordSourceChange(filePath, event, options)
    },

    reloadSource(filePath) {
      recordSourceChange(filePath, 'update')
      builder?.reloadSource(filePath)
    },

    removeSource(filePath) {
      // configureServer owns the membership verdict for add/delete events. Treat the compiler's
      // Project mutation as an exact-path edit so an unrelated transformable deletion cannot
      // force a full inventory scan; a relevant deletion is separately journaled as `delete`.
      recordSourceChange(filePath, 'update')
      builder?.removeSource(filePath)
    },
  }
}
