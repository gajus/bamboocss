import { esc } from '@bamboocss/shared'

/** Store one semantic class token in the selector spelling used by reachability sets. */
export const selectorClassName = (token: string) => (token.includes('\\') ? token : esc(token))

export interface StaticOutputProjection {
  /** Whether this environment's current graph imports the virtual stylesheet. */
  cssLoaded: boolean
  /** Compiler-owned atoms every JavaScript output represented by this projection can name. */
  requiredClasses: ReadonlySet<string>
  /** Restore the committed whole-build projection after the candidate CSS has been staged. */
  restore(): void
}

/**
 * A generated stylesheet written while other environments still had to compile.
 *
 * Reachability is complete only once every environment has contributed, and the sheet is
 * emitted by whichever environment imports it — usually the client, which builds first. So the
 * sheet goes to disk pruned against what the run knows so far, under a name hashed from those
 * bytes, and is pruned again from its unpruned source once the last environment has written.
 * When that restores a rule, the final bytes go under a new name and every written reference
 * moves with them; when it does not, nothing on disk changes.
 */
export interface DeferredSheet {
  /** The environment whose bundle carried the sheet. */
  environment: string
  /** The output directory it was written under, absolute. */
  dir: string
  /** The name Vite gave the sheet, before any rename. */
  originalFileName: string
  /** The name it was written under, relative to `dir`. */
  fileName: string
  /** The sheet as extracted, before any pruning. */
  source: string
  /** The bytes on disk under `fileName`. */
  provisional: string
  sourcemap: StaticCompilationSession['sourcemap']
  /**
   * The asset as the bundler holds it, and the bundle it sits in, so a finalization can move
   * them too. A framework that keeps a finished build's bundle and copies its stylesheet into a
   * later one — `@vitejs/plugin-rsc` does — then copies the final bytes under the final name.
   */
  asset?: { fileName: string; source: string | Uint8Array }
  bundle?: Record<string, unknown>
  /**
   * Escape-free classes the sheet's emission moved into chunk sheets of their own. A
   * finalization prunes from the unpruned source, so it has to move them out again.
   */
  moved?: ReadonlySet<string>
}

/** One output an environment wrote, for rewriting the references a finalized sheet's rename moves. */
export interface WrittenOutput {
  environment: string
  /** The output directory, absolute. */
  dir: string
  /** File names relative to `dir`, as the bundler reported them. */
  files: string[]
}

/** Shared state between the build-time fold and the virtual CSS module. */
export interface StaticCompilationSession {
  /** Resolved CSS layer name that carries generated atomic utilities. */
  utilityLayer: string
  /** Vite output sourcemap mode, needed if a late asset reference changes chunk text. */
  sourcemap: boolean | 'inline' | 'hidden'
  /** Whether the virtual stylesheet was actually imported by this build. */
  cssLoaded: boolean
  /** Source modules whose Bamboo styles were compiled into emitted class values. */
  transformedFiles: Set<string>
  /** Source modules covered by Bamboo's configured extraction graph. */
  extractedFiles: Set<string>
  /** Escaped selectors emitted from the source graph and therefore safe to tree-shake. */
  prunableClasses: Set<string>
  /** Raw semantic classes used by `view-transition-class` declarations as well as selectors. */
  viewTransitionClasses: Set<string>
  /** Escaped selectors the transformed Rollup graph can actually emit. */
  usedClasses: Set<string>
  /**
   * Project one prepared environment while Bamboo finalizes that environment's output.
   *
   * The default implementation owns the simple prune-history reset used by isolated CSS-hook
   * callers. The compiler replaces it with the production transaction: the returned callback
   * restores the committed projection after the CSS hook has staged the candidate bundle, and a
   * later output-success hook publishes its reachability and prune history together.
   */
  beginOutputProjection: (
    environment: string,
    outputOptions: object,
    bundle: object,
    replacesGeneratedStylesheet: boolean,
  ) => StaticOutputProjection
  /**
   * Every environment this run intends to build, when the run says so before building any.
   *
   * `undefined` means nothing announced one, which is the single-environment shape: `vite
   * build` without `builder`, and the `build()` API, each set up exactly one environment.
   * Reachability is complete the moment that one finishes, so pruning goes ahead.
   */
  expectedEnvironments: Set<string> | undefined
  /** Environments that have entered this shared plugin instance at least once. */
  participatingEnvironments: Set<string>
  /** Environments whose latest generation reached its observable output commit point. */
  completedEnvironments: Set<string>
  /**
   * Escape-free class names a completed prune removed from an emitted stylesheet.
   *
   * Kept so a later environment can notice that a class it just compiled is already gone from
   * a sheet that has been finalized. Escape-free because that is the spelling the prune pass
   * decides on; see `bare` there.
   */
  prunedClasses: Set<string>
  /** Stylesheets written whole while environments remained, for the last one to finalize. */
  deferredSheets: DeferredSheet[]
  /** Every output this run has written, in the order the bundler wrote them. */
  writtenOutputs: WrittenOutput[]
  /** Sheet assets already pruned in this generation, so the late pass leaves them alone. */
  prunedAssets: WeakSet<object>
  /**
   * The same, by file name, per output. Rolldown hands each hook fresh wrappers around the
   * bundle's entries, so identity alone would let the late pass prune a sheet the early one
   * already split — and report the moved rules missing. Keyed on the output options, which
   * do keep their identity from one hook to the next, and reset per build at `renderStart`.
   */
  prunedSheetNames: WeakMap<object, Set<string>>
  /**
   * Whether utilities exclusive to a lazily loaded chunk go into a sheet of that chunk's own.
   *
   * The plugin option; Vite's own `build.cssCodeSplit` has to agree, per environment, since
   * a sheet Vite emits whole in its own `generateBundle` is not there to split when the early
   * hook runs.
   */
  splitCss: boolean
  /** `build.cssCodeSplit` of the run's own config, for a bundler with no per-environment one. */
  cssCodeSplit?: boolean
  /**
   * The class strings a module's compiled calls emit, as the compiler recorded them.
   *
   * Installed by the compiler, which owns the transform artifacts. The output hook uses it to
   * work out which chunk each atom belongs to from the chunks' module lists.
   */
  classNamesOf?: (environment: string, moduleId: string) => readonly string[] | undefined
  /**
   * Finalize the deferred sheets if `environment` completes the run, rewriting `bundle` too.
   *
   * Installed by the compiler, which owns the reachability projection. Reached from the early
   * output hook of the environment that completes the run, before any other plugin reads a
   * name — a name a framework records in its own hook has to already be the final one.
   */
  finalizeDeferred?: (options: {
    environment: string
    bundle: object
    sourcemap?: StaticCompilationSession['sourcemap']
  }) => Promise<void>
  markClassUsed(className: string): void
}

export const createStaticCompilationSession = (): StaticCompilationSession => {
  const session: StaticCompilationSession = {
    utilityLayer: 'utilities',
    sourcemap: false,
    cssLoaded: false,
    transformedFiles: new Set(),
    extractedFiles: new Set(),
    prunableClasses: new Set(),
    viewTransitionClasses: new Set(),
    usedClasses: new Set(),
    expectedEnvironments: undefined,
    participatingEnvironments: new Set(),
    completedEnvironments: new Set(),
    prunedClasses: new Set(),
    deferredSheets: [],
    writtenOutputs: [],
    prunedAssets: new WeakSet(),
    prunedSheetNames: new WeakMap(),
    splitCss: true,
    beginOutputProjection(_environment, _outputOptions, _bundle, replacesGeneratedStylesheet) {
      if (replacesGeneratedStylesheet) session.prunedClasses.clear()
      const prunable = new Set([...session.prunableClasses].map((className) => className.replaceAll('\\', '')))
      const requiredClasses = new Set(
        [...session.usedClasses].filter((className) => prunable.has(className.replaceAll('\\', ''))),
      )
      return { cssLoaded: session.cssLoaded, requiredClasses, restore() {} }
    },
    markClassUsed(className) {
      // Split on whitespace. A folded call reports one entry per call
      // site, and a call producing several atoms reports them space-joined — every property
      // under one condition, which is why `_before: { content, width }` arrives as a single
      // string. Escaping that whole string yielded one key containing a space, matching no
      // class, so both atoms were left unmarked and reachability pruning deleted them.
      //
      // It read as "conditional styles are compiled into class names whose rules are never
      // emitted", and it fell hardest on pseudo-elements: `content` almost always travels
      // with another property, so `::before` and `::after` disappeared outright, while
      // single-declaration hovers and breakpoints survived and multi-declaration ones did
      // not. An atom that merged into a multi-class selector escaped the prune by accident,
      // which is why some of the rules were still there.
      for (const token of className.split(' ')) {
        if (!token) continue
        // Stored in selector form because the CSS reachability pass reads escaped selectors.
        //
        // Escaped at most once. `esc` is idempotent for a name that needs no escaping —
        // `d_flex` survives any number of passes — but not otherwise: `--scrollbar-width_10px`
        // becomes `\--scrollbar-width_10px` and then `\\--scrollbar-width_10px`. A second
        // pass therefore produces a key matching no rule, and it does so *only* for names that
        // need escaping: custom properties, vendor-prefixed properties, anything with a
        // leading dash. Those are exactly the classes one project reported as having no rule
        // in the sheet while the rule was plainly there.
        //
        // A semantic atom name never contains a literal backslash, so one is an unambiguous
        // signal that this name is already in selector form and must be left alone.
        session.usedClasses.add(selectorClassName(token))
      }
    },
  }
  return session
}

/**
 * Expected or observed environments whose current generation has not completed yet.
 *
 * Empty means everything the run will contribute has been contributed, which is the condition
 * every whole-run judgement here waits for: pruning the stylesheet against reachability, and
 * the two guards that ask whether the compiled modules and the extraction graph agree. Each of
 * those is false about a build in progress and true only about a finished one.
 *
 * The environment currently at `buildEnd` may be supplied as the candidate completing this
 * call. That keeps publication transactional: whole-run checks can include its finished graph
 * without marking it complete before those checks themselves succeed.
 *
 * Empty is also the answer for a single-environment build, where the only participant is the
 * completing candidate — so that path is unchanged.
 *
 * An environment a run declares and then never builds leaves this permanently non-empty, and
 * those judgements are skipped for the run. Every one of them errs towards shipping more CSS
 * or asserting less, so that is the safe direction to be wrong in.
 */
export const remainingEnvironments = (
  session: StaticCompilationSession,
  /** A generation currently proving it can complete this `buildEnd`. */
  completingEnvironment?: string,
): string[] => {
  const participating = new Set(session.expectedEnvironments ?? [])
  for (const environment of session.participatingEnvironments) participating.add(environment)
  return [...participating].filter((name) => name !== completingEnvironment && !session.completedEnvironments.has(name))
}
