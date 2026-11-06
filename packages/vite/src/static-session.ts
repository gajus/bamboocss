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
 * bytes, and is pruned again from its unpruned source once the last environment reaches its output.
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

/**
 * A stylesheet an environment writing its assets wrote: what a copy another environment discards is
 * named after, and, in a watch, what is pruned again as the environments it awaits settle.
 */
export interface EmittedSheet {
  environment: string
  /** Whether that environment's output runs in a browser, whose sheet is the one a page links. */
  browser: boolean
  /** The name Vite gave it, which a copy of the same sheet another environment discards carries too. */
  original: string
  /** The name it took, relative to its output directory. */
  fileName: string
  /** The bytes under that name. */
  source: string
  /** The output directory it was written under, absolute; none for an output held in memory. */
  dir?: string
  /** The sheet as extracted, before any pruning, to prune again from. */
  extracted?: string
  /** Escape-free classes its emission moved into chunk sheets of their own. */
  moved?: ReadonlySet<string>
  /** Escape-free classes the prune it was written with removed, where its output recorded them. */
  lost?: ReadonlySet<string>
  /**
   * When its file was last written, by Bamboo or the bundler: a file of the same name written since
   * is a newer output's, about to be recorded, and not this one to prune again.
   */
  writtenAt?: number
  sourcemap?: StaticCompilationSession['sourcemap']
  /**
   * Environments whose output, written, it has to be pruned again against, in a watch: those
   * replacing their output while it was pruned, whose old output it was pruned against, and those
   * whose guard stood aside for it. It is pruned again from source as each settles — its output
   * written, or its replacement failed — so it is never final against an output on its way out.
   */
  awaiting?: Set<string>
}

/**
 * A sheet an environment's output pass named, until that output is written: one it writes is an
 * `EmittedSheet` then, and a copy it discards that the written output links is a `SheetAlias`.
 * Neither is anything before: an output another plugin rejects writes nothing, and names nothing.
 */
export interface PendingSheet extends EmittedSheet {
  /** Whether the environment discards it, rather than writing it. */
  discarded: boolean
}

/**
 * Where an output an environment wrote links a copy of the stylesheet that environment discards,
 * and by which name, so the link moves with the sheet written under the same original name: to it
 * once one is written, after it as it is renamed.
 */
export interface SheetAlias {
  environment: string
  /** The written output linking it. @see `writtenOutputKey` */
  output: string
  /** The name Vite gave the sheet, which the one written carries too. */
  original: string
  /** The name the output's written files link now. */
  current: string
}

/** One output an environment wrote, for rewriting the references a finalized sheet's rename moves. */
export interface WrittenOutput {
  environment: string
  /** The output directory, absolute. */
  dir: string
  /** File names relative to `dir`, as the bundler reported them. */
  files: string[]
  /** Which of the environment's configured outputs wrote them, where that is known. */
  slot?: number
}

/** One key per output an environment writes: its directory, and its slot where that is known. */
export const writtenOutputKey = (output: { environment: string; dir: string; slot?: number }) =>
  `${output.environment}\0${output.dir}\0${output.slot ?? ''}`

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
   * Environments replacing an output that is still live, in a watch: rebuilding, their old output
   * written and their new one not yet, or not yet given up on.
   *
   * Counted complete all the same (`completedEnvironments`), as the old output describes what is on
   * disk until the new one replaces it. But a sheet another environment writes meanwhile is pruned
   * against that old output, and is pruned again once the replacement settles (`EmittedSheet`'s
   * `awaiting`): written, it may reach a class the sheet would otherwise ship without.
   */
  replacingEnvironments: Set<string>
  /**
   * Environments whose sheet survives Vite deleting the assets they do not emit, as it is emitted
   * after: an SSR build's with `cssCodeSplit` off, before Vite 7.1.10. Seen in the late pass, they
   * write it again on a rebuild, so the guard reads past what their own last sheet pruned — and
   * no other environment's, which a page may link.
   */
  lateSheetEnvironments: Set<string>
  /**
   * Escape-free class names the prune running now removed from an emitted stylesheet.
   *
   * Recorded so a later environment can notice that a class it just compiled is already gone
   * from a sheet that has been finalized: the pass that opened the prune keeps them on the output
   * the sheet went out with, and the guard reads every live output's. Never the history itself,
   * which only those outputs hold. Escape-free because that is the spelling the prune pass
   * decides on; see `bare` there.
   */
  prunedClasses: Set<string>
  /** Stylesheets written while environments remained, pruned against what the run knew, for the last to finalize. */
  deferredSheets: DeferredSheet[]
  /** Every output this run has written, in the order the bundler wrote them. */
  writtenOutputs: WrittenOutput[]
  /**
   * The sheets each written output carries, by `writtenOutputKey`: replaced as the output is
   * written again, and recorded only once it is.
   *
   * A server environment's copy of the sheet is one Vite discards, and its markup links it by name
   * — through `virtual:bamboo.css?url` — so the copy takes the name and bytes of the sheet written
   * under the same original name (`emittedSheetFor`). Named after its own bytes, it linked a sheet
   * nothing wrote wherever the two prunes differed.
   */
  emittedSheets: Map<string, EmittedSheet[]>
  /** What each environment's output pass named this generation, until its output is written. */
  pendingSheets: Map<string, PendingSheet[]>
  /** The copies each written output links, by `writtenOutputKey`. @see `SheetAlias` */
  sheetAliases: Map<string, SheetAlias[]>
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
  /** Whether the run's own config builds for SSR, and emits its assets, for the same. */
  ssrBuild?: { ssr?: boolean | string; ssrEmitAssets?: boolean; emitAssets?: boolean }
  /**
   * Whether the bundler driving this run refuses new keys on the output bundle.
   *
   * Rolldown does, and says so: assigning `bundle[name]` logs "This plugin assigns to bundle
   * variable… This will be ignored" once per build. The assignment is optional — it exists so
   * a plugin that looks the renamed stylesheet up by its new key finds it, and Rollup allows
   * it — but the warning is printed by the bundler rather than thrown, so a `try/catch` around
   * the assignment cannot suppress it. Knowing the bundler up front is the only way not to
   * make the call, and skipping it there costs nothing: Rolldown was ignoring it anyway.
   */
  refusesBundleKeys?: boolean
  /**
   * The class strings a module's compiled calls emit, as the compiler recorded them.
   *
   * Installed by the compiler, which owns the transform artifacts. The output hook uses it to
   * work out which chunk each atom belongs to from the chunks' module lists.
   */
  classNamesOf?: (environment: string, moduleId: string) => readonly string[] | undefined
  /**
   * The atoms a module's `cx()` calls join with a class the build cannot see, which the split
   * keeps in the entry sheet. @see FoldResult.joinedClassNames
   *
   * Installed by the compiler, which owns the transform artifacts.
   */
  joinedClassNamesOf?: (environment: string, moduleId: string) => readonly string[] | undefined
  /**
   * The files whose compiled calls named `className`, for a report of a class with no rule.
   *
   * Installed by the compiler, which owns the transform artifacts.
   */
  compiledIn?: (className: string) => readonly string[]
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
  /**
   * Give up on an output one of Bamboo's own output hooks failed, which nothing else reports: a
   * failure in `generateBundle` reaches no hook, and the environment would go on replacing an
   * output it never writes. Installed by the compiler.
   */
  abandonOutput?: (environment: string) => void
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
    replacingEnvironments: new Set(),
    lateSheetEnvironments: new Set(),
    prunedClasses: new Set(),
    deferredSheets: [],
    writtenOutputs: [],
    emittedSheets: new Map(),
    pendingSheets: new Map(),
    sheetAliases: new Map(),
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
 * every whole-run judgement here waits for: pruning again a stylesheet written before then, and
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
 * those judgements are skipped for the run: the guards assert less, and a sheet written before
 * then stays pruned against what the run knew when it was written, without a rule reached only
 * by an environment that compiled after it, which the process says as it exits.
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

/**
 * The sheet written under `original` that a discarded copy is named after: the last a browser
 * environment wrote, whose sheet is the one a page links, or else the last any environment wrote.
 */
export const emittedSheetFor = (session: StaticCompilationSession, original: string): EmittedSheet | undefined => {
  let found: EmittedSheet | undefined
  for (const sheets of session.emittedSheets.values()) {
    for (const sheet of sheets) {
      if (sheet.original === original && (!found || sheet.browser || !found.browser)) found = sheet
    }
  }
  return found
}

/** Text a written output's references to a stylesheet live in: chunk code, and HTML. */
const LINKING_EXTENSIONS = /\.(?:[cm]?js|html?)$/i

/**
 * What an output's write makes of the sheets its environment's output pass named (`PendingSheet`):
 * a sheet it writes is the one a copy of the same name is named after from now, and a copy it
 * discards that its code or HTML links is a link to move with that sheet. Both replace what the
 * same output recorded the last time it was written; an output held in memory, `dir` unset, records
 * its sheets and links nothing that could be moved.
 *
 * Code and HTML only: a manifest lists the copy whether or not anything links it, and read as a link
 * it said a server bundle importing the sheet for its effect linked a sheet nothing serves.
 */
export const commitWrittenSheets = (
  session: StaticCompilationSession,
  written: { environment: string; dir?: string; files: readonly string[]; slot?: number },
  bundle: Record<string, { type: string; fileName: string; code?: string; source?: unknown }>,
  /** What the output's prune removed from the sheets it carries. */
  lost?: ReadonlySet<string>,
) => {
  const key = writtenOutputKey({ environment: written.environment, dir: written.dir ?? '', slot: written.slot })
  const files = new Set(written.files)
  const named = session.pendingSheets.get(written.environment) ?? []
  const committed = named.filter((sheet) => !sheet.discarded && files.has(sheet.fileName))
  const emitted = committed.map(({ discarded: _discarded, ...sheet }) => ({ ...sheet, dir: written.dir, lost }))
  // No longer pending: a sheet of the environment pending under the same name is a newer output's.
  if (committed.length)
    session.pendingSheets.set(
      written.environment,
      named.filter((sheet) => !committed.includes(sheet)),
    )
  // Moved to the end, so the sheet an output wrote last is the last one `emittedSheetFor` meets.
  session.emittedSheets.delete(key)
  if (emitted.length) session.emittedSheets.set(key, emitted)

  session.sheetAliases.delete(key)
  const copies = written.dir === undefined ? [] : named.filter((sheet) => sheet.discarded)
  if (!copies.length) return
  const texts = Object.values(bundle).flatMap((output) => {
    if (!LINKING_EXTENSIONS.test(output.fileName)) return []
    const text = output.type === 'chunk' ? output.code : output.source
    return typeof text === 'string' ? [text] : []
  })
  const aliases = copies
    .filter((copy) => texts.some((text) => text.includes(copy.fileName)))
    .map((copy) => ({ environment: written.environment, output: key, original: copy.original, current: copy.fileName }))
  if (aliases.length) session.sheetAliases.set(key, aliases)
}
