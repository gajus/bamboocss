import { dirname, resolve } from 'node:path'
import { logger } from '@bamboocss/logger'
import { esc, truncateList } from '@bamboocss/shared'
import { bare } from './class-name'
import type { Plugin, ViteDevServer } from 'vite'
import { createCompilationHost, type CompilationBuilder, type CompilationHost } from './compilation-host'
import { createRetryableLazy, loadConfigModule, loadCssOutputModule } from './lazy-modules'
import { remainingEnvironments, type StaticCompilationSession } from './static-session'

/**
 * What a project imports to get the stylesheet.
 *
 * Spelled with a `.css` extension because that is how vite decides what a module is: the
 * id is all it has for a module with no file behind it, so `virtual:bamboo` would be
 * bundled as javascript and injected as a script.
 */
export const VIRTUAL_CSS_ID = 'virtual:bamboo.css'

/**
 * Rollup's convention for a module with no file: a leading NUL tells every other plugin
 * not to try reading it off disk.
 */
const RESOLVED_ID = `\0${VIRTUAL_CSS_ID}`

/**
 * The queries Vite appends to a CSS module — `?url`, `?raw`, `?inline`, and the
 * `?transform-only` that its own `?url` handling rewrites to.
 *
 * None of them resolved here, so asking the stylesheet for its URL failed as an unresolvable
 * path. Rather than answering each one, the query is carried onto the resolved id and the CSS
 * is served for whatever it is: Vite's CSS pipeline already knows what each means, and
 * answering them here would be a second, worse copy of it.
 *
 * `?url` in particular makes the sheet an asset of its own rather than part of whatever
 * stylesheet the importer belongs to. That is what `?url` means rather than a shortcoming, but
 * it is not what a project concatenating Bamboo's CSS into one global stylesheet wants.
 */
const queryOf = (id: string) => {
  const at = id.indexOf('?')
  return at === -1 ? '' : id.slice(at)
}

/**
 * A thrown value Vite can actually report.
 *
 * `catch` binds `unknown`, and anything under compilation — a dependency, a config hook, a
 * bare `throw 'string'` — may throw a primitive. Vite's dev error middleware puts what it is
 * handed into a `WeakSet` to deduplicate it, which throws `TypeError: Invalid value used in
 * weak set` for anything that is not an object, and the real failure is lost behind that.
 *
 * Shared by every hook that can throw while the dev server is serving, so the two cannot
 * drift: a request for the stylesheet reaches `load`, and a request for a module reaches
 * `transform`, and both are answered by the same middleware.
 */
export const asError = (error: unknown, context: string): Error =>
  error instanceof Error ? error : new Error(`bamboocss: ${context}: ${String(error)}`, { cause: error })

interface CssOutputValidator {
  pruneStaticCss(css: string, session: StaticCompilationSession, options?: { prune?: boolean }): string
}

interface BambooCssPluginOptions {
  configPath?: string
  cwd?: string
  /** Injectable retryable dev-validation boundary for focused lifecycle tests. */
  loadCssOutput?: () => PromiseLike<CssOutputValidator>
  /** Internal state supplied by `bamboocss()`; the CSS emitter is not a standalone mode. */
  session: StaticCompilationSession
  /**
   * The Builder, context and shared AST this run compiles against, supplied by `bamboocss()`.
   *
   * Defaulted so this plugin remains drivable on its own in focused tests. In a real run it
   * is the compiler's host as well, which is the point: the two used to hold separate
   * contexts and separate ts-morph projects over the same files.
   */
  host?: CompilationHost
  /** See `BambooVitePluginOptions.pruneCss`. @default true */
  pruneCss?: boolean
}

/** The plugin-context shape the output hooks read. */
type OutputContext = {
  environment?: {
    name?: string
    config?: {
      build?: {
        sourcemap?: StaticCompilationSession['sourcemap']
        ssr?: boolean | string
        ssrEmitAssets?: boolean
        cssCodeSplit?: boolean
      }
    }
  }
  emitFile?: (file: { type: 'asset'; name?: string; source: string }) => string
  getFileName?: (referenceId: string) => string
}

/** The chunk shape the split reads: which modules it holds, and what it imports. */
interface OutputChunkShape {
  type: 'chunk'
  fileName: string
  name: string
  isEntry: boolean
  imports: string[]
  modules: Record<string, unknown>
  viteMetadata?: { importedCss?: Set<string> }
}

/**
 * Which lazily loaded chunk each atom exclusive to one belongs to.
 *
 * An atom belongs to a chunk when every module that emits it is in that chunk, and the chunk
 * is not loaded with an entry anyway — an entry, or anything an entry statically imports,
 * would put the atom in the entry sheet's own company either way. An atom two chunks share,
 * or one no compiled module emits — `staticCss` — has no owner and stays where every route
 * finds it. Loading with an entry is the static import closure of every entry, which is what
 * the browser fetches before the first render.
 */
const chunkOwnership = (bundle: object, environment: string, session: StaticCompilationSession) => {
  const classNamesOf = session.classNamesOf
  const ownership = new Map<string, string>()
  if (!classNamesOf) return ownership

  const chunks = Object.values(bundle as Record<string, { type: string }>).filter(
    (output): output is OutputChunkShape => output.type === 'chunk',
  )
  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
  const eager = new Set<string>()
  const visit = (fileName: string) => {
    if (eager.has(fileName)) return
    eager.add(fileName)
    for (const imported of byFileName.get(fileName)?.imports ?? []) visit(imported)
  }
  for (const chunk of chunks) if (chunk.isEntry) visit(chunk.fileName)

  // `null` marks an atom seen from more than one chunk, or from an eager one.
  const owners = new Map<string, string | null>()
  for (const chunk of chunks) {
    const owner = eager.has(chunk.fileName) ? null : chunk.fileName
    for (const moduleId of Object.keys(chunk.modules)) {
      for (const classNames of classNamesOf(environment, moduleId) ?? []) {
        for (const token of classNames.split(' ')) {
          if (!token) continue
          const className = bare(token)
          const previous = owners.get(className)
          if (previous === undefined) owners.set(className, owner)
          else if (previous !== owner) owners.set(className, null)
        }
      }
    }
  }
  for (const [className, owner] of owners) if (owner !== null) ownership.set(className, owner)
  logger.debug(
    'vite',
    `Split: ${chunks.length} chunk(s), ${eager.size} loaded with an entry, ${owners.size} atom(s) seen, ` +
      `${ownership.size} owned by a lazy chunk.`,
  )
  return ownership
}

/**
 * Prune every generated sheet in `bundle` this generation has not pruned yet.
 *
 * Reached twice per output. The early hook, ordered `pre`, reaches a sheet Vite emitted while
 * rendering chunks — every `cssCodeSplit: true` build — before any other plugin's
 * `generateBundle` reads its name, so a framework recording asset names records the final one.
 * That was not a courtesy: `@vitejs/plugin-rsc` snapshots the server build's stylesheet name in
 * a normal-order hook and writes it into a manifest at the end of the run, so a rename in a
 * `post` hook left every server-rendered page linking a stylesheet that no longer existed. The
 * late hook, ordered `post`, reaches what Vite emits from its own `generateBundle` — the single
 * `style.css` of a `cssCodeSplit: false` build. Exactly one of the two opens a projection for a
 * given sheet.
 *
 * Pruning waits for no one; finalizing does. The stylesheet is emitted by the environment that
 * *imports* it, which in an SSR app is the client — and the client builds first, before the
 * server environment has transformed a single module. Two answers were tried before this one.
 * Holding the sheet back until every environment had contributed meant never pruning in any SSR
 * framework, since the client's output is on disk before the server starts. Pruning against the
 * client alone, with a guard that failed the build when a later environment reached a rule it had
 * removed, made a styled component that renders only on the server a build failure — and under
 * React Server Components most components never reach the client graph at all.
 *
 * So while environments remain, the sheet is pruned against what the run knows so far and
 * written under a name hashed from those bytes, and it is recorded as deferred with its unpruned
 * source. When the last environment writes its output, `bamboocss:output-write-observer` prunes
 * that source again against the union of every environment's reachability. Usually the result is
 * the bytes already on disk, and nothing moves. When a later environment restored a rule, the
 * final bytes go under a new name, every written reference moves with them, and so does any copy
 * of the provisional sheet another output carries. A single-environment build, a run whose
 * sheet-carrying environment builds last, and an in-memory build take the direct path, where the
 * guard in `buildEnd` still fails a later environment that reaches a rule the sheet lost.
 */
const pruneEmittedSheets = async (
  context: OutputContext,
  session: StaticCompilationSession,
  outputOptions: { dir?: string; file?: string },
  bundle: object,
  isWrite: boolean,
  pruneCss: boolean,
  /**
   * Whether this pass may split the sheet per chunk. Only the early one: a chunk sheet has to
   * be attached to its chunk before Vite's own hooks read which stylesheets a chunk imports,
   * for the HTML, the manifest and the preload list to carry it.
   */
  splitCss: boolean,
) => {
  // Load the complete parser/remapping closure before opening the output projection. A
  // rejected chunk load therefore publishes no partial reachability or prune state, and the
  // process-wide retryable loader lets a later rebuild recover.
  const { containsGeneratedCssAsset, optimizeStaticCssAssets } = await loadCssOutputModule()
  let handledNames = session.prunedSheetNames.get(outputOptions)
  if (!handledNames) {
    handledNames = new Set()
    session.prunedSheetNames.set(outputOptions, handledNames)
  }
  const carriesSheet = containsGeneratedCssAsset(bundle as never, session.prunedAssets, handledNames)

  const environmentName = context.environment?.name ?? 'default'
  // This environment is the candidate completing the run, not one still to compile: it has
  // finished transforming, and what it emits here is what it contributes.
  const pending = remainingEnvironments(session, environmentName)
  const completesRun = !pending.length && session.deferredSheets.length > 0
  if (!carriesSheet && !completesRun) return

  // This bundle now replaces the previously emitted stylesheet, so its prune result also
  // replaces that sheet's loss history. `optimizeStaticCssAssets` repopulates the set from
  // this generation. Opened even for a bundle carrying no sheet when the run completes here:
  // the projection is what makes the reachability below the whole run's.
  const outputProjection = session.beginOutputProjection(environmentName, outputOptions, bundle, carriesSheet)
  try {
    const outputDir = outputOptions.dir ?? (outputOptions.file ? dirname(outputOptions.file) : undefined)
    const deferred = pruneCss && isWrite === true && outputDir !== undefined && pending.length > 0
    const remaining = truncateList(pending, { unit: 'environment', separator: ', ' })
    const sourcemap = context.environment?.config?.build?.sourcemap ?? session.sourcemap

    // This environment completes the run, so the sheets earlier ones deferred can be finalized
    // now — inside this projection, where reachability is the whole run's, and before any
    // other plugin's hook reads a name out of this bundle or copies a sheet into it.
    if (completesRun) await session.finalizeDeferred?.({ environment: environmentName, bundle, sourcemap })
    if (!carriesSheet) return

    // Splitting needs the chunks to still be open to a new stylesheet each, which is only so
    // when Vite emitted the sheet while rendering chunks — `cssCodeSplit` on, the default.
    const cssCodeSplit = context.environment?.config?.build?.cssCodeSplit ?? session.cssCodeSplit ?? true
    const split =
      splitCss && session.splitCss && pruneCss && cssCodeSplit && context.emitFile && context.getFileName
        ? {
            ownership: chunkOwnership(bundle, environmentName, session),
            emit: (chunkFileName: string, css: string) => {
              const chunk = (bundle as Record<string, OutputChunkShape | undefined>)[chunkFileName]
              const referenceId = context.emitFile!({
                type: 'asset',
                name: `${chunk?.name ?? 'chunk'}.css`,
                source: css,
              })
              const fileName = context.getFileName!(referenceId)
              // Attached where Vite's own plumbing reads it: the HTML plugin links an entry's
              // sheets, the manifest lists a chunk's, and the preload helper fetches a lazy
              // chunk's before running it.
              chunk?.viteMetadata?.importedCss?.add(fileName)
              const emitted = (bundle as Record<string, object | undefined>)[fileName]
              if (emitted) session.prunedAssets.add(emitted)
            },
          }
        : undefined

    const { sheets, results } = optimizeStaticCssAssets(bundle as never, session, {
      environment: environmentName,
      prune: pruneCss,
      requiredClasses: outputProjection.requiredClasses,
      // Per environment rather than from the session, which one `configResolved` per
      // environment leaves holding whichever resolved last.
      sourcemap: context.environment?.config?.build?.sourcemap,
      handled: session.prunedAssets,
      handledNames,
      split,
    })

    // Said out loud, both ways. Pruning is the difference between the sheet a project
    // measures and the one it extracted, and it used to go missing in silence — a build
    // that quietly stopped pruning looked exactly like one that had nothing to prune.
    if (sheets && !pruneCss) {
      logger.info('vite', 'Reachability pruning is off (`pruneCss: false`). The full extracted stylesheet ships.')
    }

    if (!sheets || !pruneCss || !pending.length) return

    if (deferred) {
      for (const result of results) {
        session.deferredSheets.push({
          environment: environmentName,
          dir: resolve(outputDir!),
          originalFileName: result.original,
          fileName: result.fileName,
          source: result.source,
          provisional: result.optimized,
          sourcemap,
          asset: result.asset,
          bundle: bundle as Record<string, unknown>,
          moved: result.moved,
        })
      }
      logger.debug(
        'vite',
        `Pruned the stylesheet against what the run knows, with ${remaining} still to compile. It is pruned ` +
          `again from source once the last environment has written its output, and renamed only if that ` +
          `restores a rule.`,
      )
    } else {
      logger.debug(
        'vite',
        `Pruning against the ${JSON.stringify(environmentName)} environment with ${remaining} still to ` +
          `compile. An in-memory build has no file to finalize, so a class only those reach fails the build ` +
          `rather than shipping without its rule.`,
      )
    }
  } finally {
    outputProjection.restore()
  }
}

/**
 * The early half of the stylesheet's output lifecycle. @see `pruneEmittedSheets`
 *
 * A plugin of its own because one plugin carries one `generateBundle`, and this one has to be
 * ordered `pre` while the checks in `bamboocssCss` have to see the finished bundle.
 */
export const bamboocssCssEarly = (options: { session: StaticCompilationSession; pruneCss?: boolean }): Plugin => ({
  name: 'bamboocss:css-early',
  sharedDuringBuild: true,
  /**
   * A watch rebuild renders into the same output options object, so the names pruned by the
   * previous build would otherwise still read as handled, and the sheet a rebuild re-emits
   * under an unchanged name would ship unpruned.
   */
  renderStart(outputOptions) {
    options.session.prunedSheetNames.delete(outputOptions)
  },
  generateBundle: {
    order: 'pre',
    async handler(outputOptions, bundle, isWrite) {
      await pruneEmittedSheets(
        this as OutputContext,
        options.session,
        outputOptions,
        bundle,
        isWrite,
        options.pruneCss ?? true,
        true,
      )
    },
  },
})

/**
 * Serve bamboo's stylesheet as a virtual module, in dev and in build.
 *
 * This is the integration itself, not an optimisation: without it nothing emits css and
 * the generated `styled-system` runtime names classes no rule exists for.
 *
 * A virtual module rather than a file written to disk, because vite already owns the two
 * things a file would have to reimplement. In dev it injects css over the websocket and
 * replaces it in place, so an edit repaints without reloading; in build it hashes the
 * content into the asset graph and lets the bundler decide where it lands. Writing
 * `styles.css` and asking the project to import it means the build reads a file the same
 * process just wrote, which is a race on any watch rebuild.
 */
export const bamboocssCss = (options: BambooCssPluginOptions): Plugin => {
  const {
    configPath,
    cwd,
    loadCssOutput = loadCssOutputModule,
    session,
    host = createCompilationHost({ configPath, cwd }),
    pruneCss = true,
  } = options

  let builder: CompilationBuilder | undefined
  let server: ViteDevServer | undefined
  let command: 'build' | 'serve' = 'build'
  /** The run's own `build` options, for a bundler with no per-environment config. */
  let ssrBuildOptions: { ssr?: boolean | string; ssrEmitAssets?: boolean } | undefined

  /** Every source, resolver input and expanded config dependency which can change the sheet. */
  const extractedSourceFiles = () => {
    const activeBuilder = builder
    const context = activeBuilder?.context
    if (!context) return []
    return [
      ...new Set(
        [
          ...activeBuilder.getSourceFiles(),
          ...activeBuilder.getResolutionReadFiles(),
          ...activeBuilder.getResolutionConfigurationFiles(),
          ...context.explicitDeps,
        ].map((file) => context.runtime.path.abs(context.config.cwd, file)),
      ),
    ]
  }

  /**
   * Serialised, because both `load` and the watcher can reach it and `Builder` keeps one
   * context. Two overlapping passes would extract into the same encoder and emit the
   * stylesheet twice over.
   */
  let pending: Promise<string> | undefined

  /**
   * Which change the current `pending` was generated for, and the validated sheet it produced.
   *
   * Every environment loads the virtual stylesheet — a react-router dev server loads it once
   * for the client graph and once for SSR — and each load used to run a complete extraction
   * and optimization pass to produce byte-identical CSS. The sheet is a function of the source
   * files alone, and the watcher below is the single point every event that can reach it
   * passes through — Vite's own propagation only arrives via the watch edges `load` registers,
   * over the same extracted files the watcher checks. A monotonic counter bumped there is
   * therefore enough to know whether a build already reflects the world a load is asking about.
   *
   * Dev only. A production build has no dev watcher to advance the counter, so serving the
   * memo there would hand `vite build --watch` a stale sheet; builds regenerate per load.
   */
  let changeGeneration = 0
  let pendingGeneration = -1
  let servedCss: { generation: number; css: string } | undefined

  /**
   * Held by the host for its whole length, rather than only around each mutation.
   *
   * Extraction fills the encoder this sheet is emitted from and `toCss` reads it back, with a
   * deliberate macrotask between them. The compiler shares the AST both halves run against,
   * so a transform folding a module in that window would re-prepare a source the extraction
   * pass has already read and `toCss` has not finished reporting on. The host makes compiler
   * work wait instead; a fold is a few milliseconds and this is the one place correctness
   * depends on it.
   */
  const build = () =>
    host.runCssPass(async (activeBuilder) => {
      builder = activeBuilder

      // Writes the `styled-system` artifacts, which is what lets this plugin be a project's
      // only codegen. On the first pass it writes all of them; afterwards only what a config
      // change affected. `buildStart` below is what makes the first pass early enough to count.
      await activeBuilder.emit()

      activeBuilder.extract()

      // A full macrotask yield, not just a microtask: extraction and stylesheet emission are
      // the two largest synchronous blocks this plugin runs, and a dev server is answering
      // module requests on the same loop. Splitting them caps how long any queued response
      // waits at the longer single block instead of their sum. In a build the extra tick is
      // noise.
      await new Promise<void>((settle) => setImmediate(settle))

      if (activeBuilder.context) {
        session.utilityLayer = activeBuilder.context.config.layers?.utilities ?? 'utilities'
        session.extractedFiles.clear()
        for (const file of extractedSourceFiles()) session.extractedFiles.add(file)
      }

      let graphAtomHashes: Set<string> | undefined
      if (activeBuilder.context) {
        activeBuilder.context.encoder.atomizeObservedRecipes()
        // Captured before baseline/staticCss generation. Graph atoms can be removed when no
        // transformed module emits them; explicit staticCss atoms remain outside this set and
        // continue to act as a safelist.
        graphAtomHashes = new Set(activeBuilder.context.encoder.atomic)
      }

      // The whole stylesheet, so it carries the `@layer` order statement itself.
      const css = activeBuilder.toCss({ layerParams: true })

      session.prunableClasses.clear()
      session.viewTransitionClasses.clear()
      if (graphAtomHashes && activeBuilder.context) {
        const decoder = activeBuilder.context.decoder.collect(activeBuilder.context.encoder)
        for (const atom of decoder.atomic) {
          if (graphAtomHashes.has(atom.hash)) session.prunableClasses.add(atom.className)
        }
        for (const transition of decoder.view_transitions) {
          session.viewTransitionClasses.add(transition.className)
          session.prunableClasses.add(esc(transition.className))
        }
      }

      return css
    })

  const generate = () => {
    // Two loads racing for the same generation — the client and SSR environments after one
    // edit — join one pass instead of chaining a second identical one behind it.
    if (command === 'serve' && pending && pendingGeneration === changeGeneration) return pending
    pendingGeneration = changeGeneration
    pending = Promise.resolve(pending)
      .catch(() => undefined)
      .then(build)
    return pending
  }

  /**
   * The pass that runs before Rollup resolves anything, and the sheet it produced.
   *
   * `emit` writes `styled-system/`, and reaching it through `load` is too late to be what a
   * fresh clone needs: `load` runs when the *virtual module* is requested, and a module's
   * imports are all resolved before any of them is loaded. So `app/root.tsx` importing both
   * `styled-system/css` and `virtual:bamboo.css` has the first resolved while the directory is
   * still absent — the client build carried on and externalised it, the ssr build failed with
   * "Rolldown failed to resolve import", and `vite dev` served an error overlay. `buildStart` is
   * the first hook Rollup calls, and it precedes all of that.
   *
   * Memoised, and consumed by the first `load` rather than regenerated for it. `buildStart` runs
   * once per environment against this one shared instance, and nothing can have invalidated the
   * result in between — the modules that would invalidate it have not been transformed yet.
   * Regenerating would mean a second full extraction on every cold start, to produce the same
   * bytes.
   */
  let prebuilt: Promise<string> | undefined
  let prebuildStarted = false
  const prebuild = async () => {
    // Once per shared plugin instance, not once per environment. `buildStart` fires for each of
    // them against this one instance, so every caller joins the first one's generation. Once it
    // settles the artifacts are already on disk, which is the whole point of running here. A
    // `vite build --watch` rebuild is covered for the same reason, and `emit` re-writes what a
    // config change affected either way.
    if (!prebuildStarted) {
      prebuildStarted = true
      prebuilt = generate()
    }
    // After the cold sheet is consumed, a later load owns generation through `pending`. A
    // concurrent environment's buildStart must join that work as well: resolving imports while
    // `builder.emit()` is still updating generated artifacts races the files this hook exists to
    // put on disk first.
    const attempt = prebuilt ?? pending
    if (!attempt) return
    try {
      await attempt
    } catch (error) {
      // A failed watch generation must be retryable. Guard the reset by identity: several
      // environments can observe the same rejection, and a late observer must not clear a newer
      // attempt another generation has already started.
      if (prebuilt === attempt || (prebuilt === undefined && pending === attempt)) {
        prebuildStarted = false
        prebuilt = undefined
      }
      throw error
    }
  }

  /**
   * The dev config graph is independent of Builder setup and is needed one hook earlier. Keep
   * its module load and graph walk single-flight as well: shared plugins may be resolved for
   * client and SSR concurrently, but both describe the same Vite config.
   */
  const configDependencyLoaders = new Map<string, () => Promise<Set<string>>>()
  const discoverConfigDependencies = (root: string) => {
    const projectRoot = cwd ?? root
    let discover = configDependencyLoaders.get(projectRoot)
    if (!discover) {
      const created = createRetryableLazy(async () => {
        const { findConfig, getConfigDependencies } = await loadConfigModule()
        const configFile = findConfig({ cwd: projectRoot, file: configPath })
        return getConfigDependencies(configFile).deps
      })
      configDependencyLoaders.set(projectRoot, created)
      discover = created
    }
    return discover()
  }

  return {
    name: 'bamboocss:css',

    // Both `serve` and `build`: source compilation and virtual CSS use one representation in
    // both commands.

    /**
     * One instance for every environment of a build, rather than one per environment.
     *
     * Vite re-reads the config file once per environment, so a project that lists this plugin
     * in `vite.config.ts` — every project — got a *fresh* instance per environment, each with
     * its own compilation session, context and ts-morph project. Nothing an environment
     * established could then be seen by the next one, which is the premise the reachability
     * accounting below is built on, and it also meant the whole config load and extraction
     * happened once per environment.
     */
    sharedDuringBuild: true,

    async configResolved(config) {
      command = config.command
      host.setCommand(config.command)
      session.sourcemap = config.build.sourcemap
      session.cssCodeSplit = config.build.cssCodeSplit
      ssrBuildOptions = { ssr: config.build.ssr, ssrEmitAssets: config.build.ssrEmitAssets }

      /**
       * Tell Vite that `bamboo.config.ts` is a config file, so editing one restarts the server.
       *
       * Tokens live there, and they are what a designer iterates on most — "restart the dev
       * server to see a colour change" is the wrong instruction for the file most likely to be
       * edited all afternoon. Nothing watched it: `watch` is the CLI's own watcher, and a
       * project running `vite dev` never reaches it.
       *
       * A restart rather than re-emitting the stylesheet. The two plugins share one context now,
       * and the compiler re-derives everything it holds when `Builder.setup` replaces it — so the
       * half-updated state this used to prevent, with the compiler naming classes from the old
       * config against a sheet emitted from the new one, can no longer happen. What a restart
       * still buys is the rest of the server: a changed `outdir`, a preset that adds an entry
       * point, and every module Vite has already transformed against the previous config.
       *
       * Through Vite's own list rather than a watcher of ours. Vite adds these paths to the
       * files it watches, which is what reaches a config *outside* `root` — a monorepo with one
       * config above `apps/web`, or a preset resolved into `node_modules`, neither of which the
       * project watcher covers. It also means the restart is Vite's, with its own concurrency
       * guard and its own error reporting, rather than a second implementation of both.
       *
       * The config's own import graph is resolved the way `Builder` resolves it, minus the
       * tsconfig paths it has not loaded yet at this point. `dependencies` globs are not
       * expanded here: they are declared as an escape hatch for a *config reload*, and turning
       * every file matching one into a full server restart is not what a project asking for
       * that meant.
       */
      // Scoped rather than returned early: everything below this runs in a build, and the
      // environment accounting it sets up is what keeps a two-environment build from pruning
      // a stylesheet the second one still contributes to.
      if (config.command === 'serve') {
        try {
          const deps = await discoverConfigDependencies(config.root)
          config.configFileDependencies.push(...deps)
        } catch {
          // No config to watch. `load` reports that properly, with the message the CLI uses.
        }
      }

      // `builder` is defined only when the run drives Vite's environment builder — `vite build
      // --app`, or any framework that sets it, which is how react-router, Nuxt and SvelteKit
      // produce a client and an SSR bundle. Absent, exactly one environment is set up and
      // whatever it reaches is the whole build.
      //
      // Read here rather than from the `buildApp` hook alone because a framework builds its
      // environments from inside its own `buildApp`, and hook order between plugins is not
      // ours to rely on. This is known before any of that runs.
      if (config.builder && config.environments) {
        session.expectedEnvironments = new Set(Object.keys(config.environments))
      }
    },

    /**
     * The definitive environment list, for a run that reaches `builder.buildApp()` without
     * configuring `builder` — the shape `vite build` itself takes, where exactly one
     * environment is set up and pruning is therefore safe.
     */
    buildApp: {
      order: 'pre',
      async handler(builder) {
        session.expectedEnvironments = new Set(Object.keys(builder.environments))
      },
    },

    /**
     * Put `styled-system/` on disk before anything resolves an import of it.
     *
     * Normalized rather than rethrown as caught, for the reason the compiler's `buildStart`
     * gives: this evaluates the user's config and its hooks, and in dev anything that is not an
     * object crashes Vite's error middleware instead of being reported.
     */
    async buildStart() {
      try {
        await prebuild()
      } catch (error) {
        throw asError(error, `failed to generate ${VIRTUAL_CSS_ID}`)
      }
    },

    resolveId(id) {
      const query = queryOf(id)
      const base = id.slice(0, id.length - query.length)
      // Both spellings. Vite's own `?url` handling re-imports the *resolved* id with a
      // different query, so declining that leaves it unresolvable and the build fails naming
      // an import nobody wrote.
      if (base !== VIRTUAL_CSS_ID && base !== RESOLVED_ID) return null
      return `${RESOLVED_ID}${query}`
    },

    async load(id) {
      const query = queryOf(id)
      if (id.slice(0, id.length - query.length) !== RESOLVED_ID) return null

      // Here rather than in `build`, which is no longer only reached by a load: `buildStart`
      // generates the sheet whether or not anything imports it. The flag means the virtual
      // module was asked for, and `buildEnd` fails a build that compiled classes without it.
      session.cssLoaded = true

      const generationAtStart = changeGeneration
      if (command === 'serve' && servedCss?.generation === generationAtStart) {
        // Still a load of this module: the watch edges have to be re-registered for the graph
        // Vite is asking in, or the environment that hit the memo would never be invalidated.
        // From the session's set rather than `extractedSourceFiles()`, which re-globs the
        // include patterns per call — the build that produced this memo assigned the set from
        // that same expression, so the lists are identical by construction.
        if (this.addWatchFile) {
          for (const file of session.extractedFiles) this.addWatchFile(file)
        }
        return servedCss.css
      }

      let css: string
      try {
        // Resolve the dev validator before taking a generation. Once the generation promise
        // settles, validation must remain in the same continuation with no intervening await:
        // Builder serializes its work through `pending`, but the shared session inventory is
        // replaced on every pass. Waiting for the chunk between those two steps would let a
        // concurrent environment validate old bytes against a newer rule inventory. A rejected
        // chunk attempt leaves `prebuilt` untouched for the next request to retry.
        const validateDevCss = command === 'serve' ? (await loadCssOutput()).pruneStaticCss : undefined

        // The `buildStart` pass, the first time. Cleared as it is taken, so a reload in dev —
        // which is what an invalidation ends in — regenerates rather than replaying it.
        const first = prebuilt
        prebuilt = undefined
        css = await (first ?? generate())

        // Development cannot tree-shake against a complete Rollup graph because modules arrive
        // lazily. It still performs the complete rule-inventory validation before serving the
        // sheet, uses the exact same global atom names, and omits every recipe rule. Keeping the
        // parser here means an unimported prebuild never pays for the CSS-output closure; the
        // final production reachability removal remains in `generateBundle`.
        if (validateDevCss) css = validateDevCss(css, session, { prune: false })
      } catch (error) {
        throw asError(error, `failed to generate ${VIRTUAL_CSS_ID}`)
      }

      // Recorded only when no file event raced the pass: a build that started before an edit
      // landed is still the answer to this request — exactly as before — but must not be
      // remembered as current.
      if (command === 'serve' && generationAtStart === changeGeneration) {
        servedCss = { generation: generationAtStart, css }
      }

      // Every file the extractor reads is a source for this module, so editing one has to
      // invalidate it. In build this is what makes `vite build --watch` correct; in dev the
      // watcher below does the same job earlier. The session set was assigned from
      // `extractedSourceFiles()` by the generation just awaited, so reading it back avoids
      // re-globbing the include patterns once per environment per rebuild.
      if (this.addWatchFile) {
        for (const file of session.extractedFiles) this.addWatchFile(file)
      }

      return css
    },

    configureServer(devServer) {
      server = devServer

      /**
       * The graph the stylesheet's own module lives in, which is the one that has to reach it.
       *
       * `load` registers every extracted file with `addWatchFile`, and `vite:css-analysis`
       * turns those into real importer edges — the virtual module ends up a direct importer of
       * each file the extractor read. So an edit to any of them propagates to the stylesheet on
       * Vite's own pass, in whichever environment holds that edge.
       *
       * The client one, because CSS is a client concern: an ssr environment never applies a
       * stylesheet update, and asking whether *any* environment matched would skip the forced
       * reload below for a server-only module whose styles the client still has to be told
       * about. Vite 5 has one graph and no `environments`, where the question is exact.
       */
      const clientGraph: { getModulesByFile: (file: string) => { size: number } | undefined } =
        devServer.environments?.client?.moduleGraph ?? devServer.moduleGraph

      // The extractor's exact read-set decides what matters, rather than a second glob that
      // misses resolver-loaded values outside `include`.
      const invalidate = (file: string, event: 'create' | 'update' | 'delete') => {
        const activeBuilder = builder
        const ctx = activeBuilder?.context
        if (!ctx) return
        const absoluteFile = ctx.runtime.path.abs(ctx.config.cwd, file)
        const wasExtracted = session.extractedFiles.has(absoluteFile)
        const changesConfigMembership = event !== 'update' && activeBuilder.isPotentialConfigDependency(absoluteFile)
        // An unknown update/delete cannot have contributed to the current sheet. An addition is
        // different: it may be the first member of an include glob, so only reconciliation can
        // decide. Recording it before invalidation lets the next setup perform that one glob.
        if (
          !wasExtracted &&
          (event !== 'create' || (!activeBuilder.isPotentialSourceFile(absoluteFile) && !changesConfigMembership))
        )
          return
        host.noteSourceChange(absoluteFile, event, { needsConfigReload: changesConfigMembership })

        // Whatever was built no longer reflects the world. Every path that can invalidate the
        // stylesheet module starts at this watcher and this guard, so the bump is complete.
        changeGeneration++

        // The `buildStart` pass predates this edit, so it can no longer stand in for a first
        // load. Before the early return below, which is taken when the stylesheet has never been
        // requested — exactly the state in which that pass is still waiting to be handed over.
        prebuilt = undefined

        const mod = server?.moduleGraph.getModuleById(RESOLVED_ID)
        if (!mod) return

        // Already Vite's job. Forcing it as well does not merge with that pass — it is a second
        // `updateModules`, so the browser is told twice and refetches the whole stylesheet
        // twice, 36 kB a copy on the app this was measured on. What is left for this watcher is
        // the case it exists for: a file the extractor reads that never became a module, where
        // Vite matches nothing and nothing would repaint at all.
        if (wasExtracted && clientGraph.getModulesByFile(absoluteFile)?.size) return

        server?.moduleGraph.invalidateModule(mod)
        void server?.reloadModule(mod)
        logger.debug('vite', `styles invalidated by ${absoluteFile}`)
      }

      devServer.watcher.on('change', (file) => invalidate(file, 'update'))
      devServer.watcher.on('add', (file) => invalidate(file, 'create'))
      devServer.watcher.on('unlink', (file) => invalidate(file, 'delete'))
    },

    generateBundle: {
      order: 'post',
      async handler(outputOptions, bundle, isWrite) {
        const context = this as OutputContext
        await pruneEmittedSheets(context, session, outputOptions, bundle, isWrite, pruneCss, false)

        const { containsGeneratedCssAsset } = await loadCssOutputModule()
        const environment = context.environment
        const environmentName = environment?.name ?? 'default'
        const replacesGeneratedStylesheet = containsGeneratedCssAsset(bundle)

        // Opened only to read this environment's own view; nothing here prunes, so the stage
        // an earlier projection recorded is left standing.
        const outputProjection = session.beginOutputProjection(environmentName, outputOptions, bundle, false)
        try {
          // A stylesheet that vanishes between here and disk is the worst shape a failure takes:
          // the build is green, every class in the markup is real, and nothing is styled. The
          // compiler knows it produced classes, so it can also insist something carries them —
          // in the same spirit as the unimported-`virtual:bamboo.css` check, which catches the
          // other way to end up with classes and no rules.
          // Only the environment that served the stylesheet answers for it.
          if (!outputProjection.cssLoaded) return
          if (!session.transformedFiles.size) return

          /**
           * An SSR bundle emits no CSS assets, and is not supposed to.
           *
           * `build.ssrEmitAssets` is off by default, so Vite discards them: the client build is
           * what carries the stylesheet, and a server bundle that imports `virtual:bamboo.css`
           * from shared code — a root component, a layout — still asks this plugin to load it.
           * Which means the environment *served* the sheet and then emitted nothing, and the
           * check below read that as the failure it exists to catch.
           *
           * It fails a build that is entirely correct. Qwik's `vite build --ssr` is the shape
           * that showed it: 7/7 calls compiled, the client bundle carrying the stylesheet, and
           * the server bundle refusing to finish. React Router does not hit it only because its
           * plugin turns `ssrEmitAssets` on.
           *
           * Read per environment where that exists, falling back to the run's own config, so
           * Vite 5's single-config builds are answered by the same question.
           */
          const buildOptions = environment?.config?.build ?? ssrBuildOptions
          if (buildOptions?.ssr && !buildOptions.ssrEmitAssets) return

          if (!replacesGeneratedStylesheet) {
            throw new Error(
              `bamboocss: ${session.transformedFiles.size} module(s) were compiled to Bamboo class values, but no ` +
                `emitted asset carries the generated stylesheet. The build would ship unstyled.\n\n` +
                `This happens when another plugin, or the bundler itself, drops or replaces the CSS asset after it is ` +
                `emitted. If you are on Rolldown, report this — the rename that used to cause it is already disabled ` +
                `there. Otherwise look for a plugin running in \`generateBundle\` that rewrites CSS assets.`,
            )
          }
        } finally {
          outputProjection.restore()
        }
      },
    },
  }
}
