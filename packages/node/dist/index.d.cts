import { n as markStaticCompilerActive, t as isStaticCompilerActive } from "./static-compiler-C1QNL5nu.cjs";
import { ReportFormat } from "@bamboocss/reporter";
import { AnalysisOptions, Artifact, ArtifactId, BambooHooks, Config, CssArtifactType, LoadConfigResult, ParserResultInterface, ResultItem, Runtime, SpecFile, WatchOptions, WatcherEventType } from "@bamboocss/types";
import { DeadImport, ParserOptions, StyleEncoder, Stylesheet } from "@bamboocss/core";
import { Generator, generatePackageExports } from "@bamboocss/generator";

//#region ../native-extractor/index.d.ts
interface NativeSource {
  filename: string;
  source: string;
}
interface NativeTokenDecline {
  reason: 're-exported' | 'import-equals' | 'require' | 'dynamic-import' | 'unclassified-import' | 'unsupported-import' | 'unresolved-reference';
  line: number;
  /** UTF-16 source range of the declined syntax. */
  start: number;
  end: number;
}
interface NativeTokenAccounting {
  paths: string[];
  prefixes: string[];
  declined: NativeTokenDecline[];
  /** The file did not parse, so nothing in it can be trusted. */
  unparsed: boolean;
}
/** A UTF-16 source range. */
interface FoldSpan {
  start: number;
  end: number;
}
interface FoldSelectionProperty {
  key: string;
  shorthand: boolean;
  literal?: unknown;
  text: string;
  inert: boolean;
  resolved?: unknown;
}
interface FoldSelection {
  identifier?: string;
  properties?: FoldSelectionProperty[];
  unenumerable: boolean;
}
interface FoldCxArgument {
  span: FoldSpan;
  kind: 'string' | 'ignored' | 'array' | 'expression' | 'spread';
  value?: string;
  elements?: FoldCxArgument[];
}
interface FoldCall {
  name: string;
  kind: 'css' | 'pattern' | 'recipe' | 'token' | 'tokenValue' | 'viewTransition' | 'cva-call' | 'cva' | 'sva' | 'cx';
  span: FoldSpan;
  slot?: string;
  slotEnd?: number;
  shadowedHelpers: string[];
  raw: boolean;
  notImported: boolean;
  calleeProperty?: string;
  data: unknown[];
  exact: boolean;
  argumentCount: number;
  trailingArgumentsInert: boolean;
  selection?: FoldSelection;
  origin?: {
    filePath: string;
    name: string;
  };
  binding?: string;
  cxArguments: FoldCxArgument[];
}
interface FoldSplitCall {
  span: FoldSpan;
  binding: string;
  shadowedHelpers: string[];
  imported: boolean;
  argumentText: string;
}
interface FoldImport {
  span: FoldSpan;
  module: string;
  typeOnly: boolean;
  specifiers: Array<{
    imported: string;
    local: string;
    typeOnly: boolean;
    end: number;
    shadowedAnywhere: boolean;
  }>;
  defaultLocal?: string;
  namespaceLocal?: string;
}
interface FoldAnalysis {
  calls: FoldCall[];
  splitCalls: FoldSplitCall[];
  imports: FoldImport[];
  moduleScopeNames: string[];
  references: Array<{
    name: string;
    span: FoldSpan;
  }>;
  runtimeShapes: Array<{
    kind: 'import' | 'require' | 'import-equals' | 'export-star' | 'export-from';
    name: string;
    module: string;
    span: FoldSpan;
  }>;
  localExports: Array<{
    local: string;
    span: FoldSpan;
  }>;
  importedRecipes: Array<{
    local: string;
    filePath: string;
    name: string;
    config?: unknown;
    declaringImports: string[];
    dependencies: string[];
  }>;
  dependencies: string[];
  errors: string[];
}
//#endregion
//#region src/diff-engine.d.ts
declare class DiffEngine {
  private ctx;
  private prevConfig;
  constructor(ctx: Generator);
  /**
   * Reload config from disk and refresh the context
   */
  reloadConfigAndRefreshContext(fn?: (conf: LoadConfigResult) => void): Promise<import("@bamboocss/types").DiffConfigResult>;
  /** @internal Exact tsconfig files behind the currently attached resolution options. */
  getResolutionConfigFiles: () => readonly string[];
  /**
   * Update the context from the refreshed config
   * then persist the changes on each affected engines
   * Returns the list of affected artifacts/engines
   */
  refresh(conf: LoadConfigResult, fn?: (conf: LoadConfigResult) => void): import("@bamboocss/types").DiffConfigResult;
}
//#endregion
//#region src/parser-result.d.ts
interface UnresolvedStyle {
  /**
   * What the loss costs, which decides how it is explained.
   *
   * - `atomic` — a `css()` call. The declarations the build saw still apply; the ones it
   *   did not have no rule behind them, so they are simply absent.
   * - `recipe` — a `cva`/`sva` config. A declaration the build cannot see has no rule behind
   *   any selection that includes it.
   */
  kind: 'atomic' | 'recipe';
  /** The property the build could not resolve, or `undefined` when only the count differs. */
  prop?: string;
  filePath: string;
  line: number;
  column: number;
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
  reason: 'unresolvable-value' | 'missing-property' | 'unenumerable-keys' | 'unresolved-raw';
}
/**
 * What extraction found in one file, and the encoder calls that turn it into rules.
 *
 * Filled from the native analysis by `BambooContext.parseFile`; nothing here reads source.
 */
declare class ParserResult implements ParserResultInterface {
  private context;
  /** Ordered list of all ResultItem */
  all: ResultItem[];
  css: Set<ResultItem>;
  cva: Set<ResultItem>;
  sva: Set<ResultItem>;
  token: Set<ResultItem>;
  viewTransition: Set<ResultItem>;
  recipe: Map<string, Set<ResultItem>>;
  pattern: Map<string, Set<ResultItem>>;
  filePath: string | undefined;
  encoder: ParserOptions['encoder'];
  /** Resolver targets crossed while extracting values which contributed CSS. */
  private dependencies;
  /** Styles the build could not fully see. @see `UnresolvedStyle` */
  unresolved: UnresolvedStyle[];
  /**
   * Calls to a name the pattern or recipe entrypoint no longer exports.
   *
   * Separate from `unresolved`, which grades a call the build *did* see and could only
   * partly resolve. These it saw and could not resolve at all: the binding is dead, so every
   * rule the call would have contributed is absent rather than incomplete. Reported by
   * `assertNoDeadCalls` rather than warned about, for that reason.
   */
  deadCalls: DeadImport[];
  /**
   * Whether each result item is attributed to its call site, for a source map.
   *
   * Off for a source a `parser:before` hook rewrote: its positions are the hook's output's,
   * not the file's, and a wrong line is worse than none.
   */
  origins: boolean;
  /** Set on a result the native engine produced, with the reads it reported. @internal */
  native: boolean;
  nativePendingCandidates: readonly string[];
  nativeConfigurationFiles: readonly string[];
  constructor(context: ParserOptions, encoder?: ParserOptions['encoder']);
  append(result: ResultItem): ResultItem;
  set(name: 'cva' | 'css' | 'sva' | 'token', result: ResultItem): void;
  setCss(result: ResultItem): void;
  /** The call site of `result`, when the encoder is recording them. */
  private originOf;
  setCva(result: ResultItem): void;
  setSva(result: ResultItem): void;
  /**
   * `kind` separates the variable reference — `token()` — from `token.value()`, the resolved
   * literal. They share this set deliberately: everything that reads a result for the token
   * *path* wants both, and only the fold cares which half was asked for.
   */
  setToken(result: ResultItem, kind?: 'token' | 'tokenValue'): void;
  setViewTransition(result: ResultItem): void;
  setPattern(name: string, result: ResultItem): void;
  /**
   * @param unresolved The variant axes the call site passed and the build could not read.
   * `button({ size })` with a dynamic `size` and `button()` both arrive as `{}`, and the
   * difference decides whether a class the encoder is about to emit has a rule behind it.
   */
  setRecipe(recipeName: string, result: ResultItem, unresolved?: ReadonlySet<string>): void;
  isEmpty(): boolean;
  setFilePath(filePath: string): this;
  /** @internal Called with each resolver target the native evaluation crossed. */
  addDependency(filePath: string): void;
  /** Local source paths crossed while resolving values this extraction encoded. */
  getDependencies(): string[];
  toArray(): ResultItem[];
  toJSON(): {
    css: ResultItem[];
    cva: ResultItem[];
    sva: ResultItem[];
    token: ResultItem[];
    viewTransition: ResultItem[];
    recipe: {
      [k: string]: ResultItem[];
    };
    pattern: {
      [k: string]: ResultItem[];
    };
  };
}
//#endregion
//#region src/source-project.d.ts
interface SourceProjectOptions {
  /** Where source bytes come from when no overlay supplies them. */
  readFile: (filePath: string) => string;
  fileExists: (filePath: string) => boolean;
  /** What a relative path is relative to. */
  cwd?: string;
  /** The tsconfig `compilerOptions` whose `baseUrl` and `paths` resolution reads. */
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
  parserOptions: ParserOptions;
}
/**
 * The source view every engine reads: disk, with caller-supplied bytes layered over it.
 *
 * Extraction and the Vite compiler run in Rust, and the Rust resolver reads ordinary files
 * itself. What it cannot see is bytes that exist nowhere on disk — a single-file component's
 * compiled script, a test's in-memory module — so those are held here, as overlays, and handed
 * across the native boundary with every analysis. Nothing here parses anything.
 */
declare class SourceProject {
  private readonly options;
  /** Bytes explicitly supplied by a caller rather than read from disk, by normalized path. */
  private overlays;
  private compilerOptions;
  constructor(options: SourceProjectOptions);
  private normalizePath;
  /** The `baseUrl` and `paths` module resolution reads. */
  get resolutionOptions(): {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
  /** A tsconfig reload replaced the options resolution reads. */
  refreshResolutionConfiguration: (compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  }) => void;
  /** Source bytes from an overlay, else from disk; `undefined` when neither can be read. */
  getSourceText: (filePath: string) => string | undefined;
  /** Whether that same source view can read a path. */
  sourceExists: (filePath: string) => boolean;
  /** Whether a caller supplied bytes that can differ from the path on disk. */
  sourceIsOverridden: (filePath: string) => boolean;
  /** Every path a caller supplied bytes for. */
  getOverriddenSources: () => string[];
  /** Supply the bytes for a path. */
  overlaySource: (filePath: string, content: string) => void;
  /**
   * Supply the bytes for a module, under the path extraction will ask for.
   *
   * A relative path resolves against the project's working directory, as `parseFile` resolves
   * it — so a module added as `src/a.tsx` is the one `parseFile('src/a.tsx')` reads.
   */
  addSourceFile: (filePath: string, content: string) => void;
  private absolute;
  /** Forget bytes supplied through `overlaySource`. Returns whether there were any. */
  removeOverlay: (filePath: string) => boolean;
  /**
   * A watched file changed on disk. Disk is now the truth for it, so an overlay that
   * stood in for it goes.
   */
  reloadSourceFile: (filePath: string) => void;
  /**
   * A watched file was deleted. Its styles go with it — nothing re-parses a file that is gone,
   * so they would otherwise outlive it for as long as the context does.
   */
  removeSourceFile: (filePath: string, encoder?: StyleEncoder) => void;
  /**
   * Restore an encoder dump from a `.json` file in `include` — the output of `bamboo ship`,
   * or a library's shipped extraction — and report it as an empty result for that file.
   */
  parseJson: (filePath: string, encoder?: StyleEncoder) => ParserResult;
}
//#endregion
//#region src/output-engine.d.ts
interface OutputEngineOptions extends Generator {
  runtime: Runtime;
  hooks: Partial<BambooHooks>;
}
declare class OutputEngine {
  private paths;
  private fs;
  private path;
  constructor(options: OutputEngineOptions);
  empty: () => void;
  ensure: (file: string, cwd: string) => string;
  /**
   * Delete files in the generated directories that this codegen no longer produces.
   *
   * Codegen was write-only, so an artifact that stopped being generated stayed on disk
   * forever. Dropping a pattern from the config rewrote `patterns/index.js` without it and
   * left `patterns/stack.js` sitting beside it — importing through the barrel then failed
   * loudly, which is fine, but a deep import resolved, ran, returned a class name and
   * emitted no css. A stale artifact is worse than a missing one: it answers.
   *
   * Scoped to the directories this call actually wrote to, so a directory bamboo does not
   * generate into is never read, let alone emptied. It is bounded twice over, because the
   * cost of being wrong here is a deleted file rather than a stale one:
   *
   * - only a *complete* codegen may be swept, since a filtered artifact list cannot say what
   *   a directory should contain. That is the caller's to enforce;
   * - within a directory, only files carrying an extension this codegen actually wrote
   *   *there* are eligible. `patterns/` got `.mjs` and `.d.ts` files, so a leftover
   *   `stack.mjs` is stale; a `.gitignore`, a `README.md` or a `styles.css` is not the kind
   *   of thing we put there and is none of our business.
   *
   * The second bound replaces a list of known exceptions, which was the wrong shape: a
   * denylist has to name every file anyone might legitimately keep in an output directory,
   * and the failure mode when it misses one is silent deletion. It missed the `.gitignore`
   * that ships inside a generated directory, which is committed in this repo's own fixtures.
   * Reasoning from what we wrote needs no such list.
   *
   * Subdirectories are left alone; they are swept as themselves when their own artifacts
   * are written.
   */
  prune: (artifacts: Array<Artifact | undefined>) => {
    removed: number;
  };
  write: (output: Artifact | undefined) => Promise<PromiseSettledResult<void>[]> | undefined;
  /**
   * Whether the file on disk already holds exactly what codegen would write.
   *
   * Not for the write itself, which is cheap — 54 artifacts and 1.4 MB measure ~6ms, against
   * ~1.3ms to read them back and compare. It is for the mtime. Codegen rewrote every artifact
   * on every build whether or not a byte moved, and most builds move nothing: `csstype.d.ts` is
   * copied verbatim from a constant and accounts for 895 kB on its own. Everything downstream
   * watches those files — the dev server's module graph, `tsc --incremental`, any bundler with
   * the output directory in scope — and each of them re-does work for a file that is identical
   * to the one it already read.
   *
   * A read that throws is an answer, not a failure: the file is unreadable or absent, so it has
   * to be written.
   */
  private isUnchanged;
  /**
   * Unlike the rest of the output, `package.json` is not exclusively ours: `emit-pkg`
   * writes entrypoints to the same path, and consumers hand-edit it. Overwriting would
   * drop that, so only keys that are absent get filled in — anything already declared,
   * including a deliberate `sideEffects`, is left as it stands.
   */
  private writePackageJson;
}
//#endregion
//#region src/create-context.d.ts
declare class BambooContext extends Generator {
  runtime: Runtime;
  project: SourceProject;
  output: OutputEngine;
  diff: DiffEngine;
  explicitDeps: string[];
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
  parseFailures: Map<string, unknown>;
  /**
   * Files that call a binding their entrypoint no longer exports, keyed by path.
   *
   * Keyed and scoped exactly like `parseFailures`, and for the same reasons: an incremental
   * pass that skips an unchanged file does not re-parse it, so the finding has to outlive the
   * pass that recorded it or a no-op rebuild launders a broken build into a green one — and it
   * has to be dropped once the file is fixed, deleted, or leaves `include`, or the fix can
   * never take.
   */
  deadCalls: Map<string, DeadImport[]>;
  /** Extraction results produced without materializing TypeScript ASTs. */
  private nativeExtractions;
  /** Native semantic reads retained across incremental passes. */
  private nativeDependencies;
  private nativePendingCandidates;
  private nativeConfigurationFiles;
  private nativeAuxiliaryFiles;
  /** Parser-hook output staged by the prefilter for the following native boundary. */
  private nativePreparedSources;
  /** Per-file parser-hook options and whether a transform invalidated source locations. */
  private nativeSourceMetadata;
  private parserHooks;
  constructor(conf: LoadConfigResult);
  /**
   * Report `css()` calls whose styles the build could not fully see.
   *
   * A warning rather than an error: the build is not wrong, the call site is unresolvable,
   * and the declarations it did resolve still apply. But the ones it could not have no rule
   * behind them and are simply absent, so it must not be silent.
   */
  reportUnresolvedStyles: (result: {
    unresolved?: ParserResult["unresolved"];
  }) => void;
  private getExplicitDependencies;
  initMessage: () => string;
  getFiles: () => string[];
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
  assertExtracted: (files?: Iterable<string>) => void;
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
  assertNoDeadCalls: (files?: Iterable<string>) => void;
  /** A path as the user typed it, when it is under `cwd`. */
  private relative;
  /**
   * Whether a file is one bamboo wrote.
   *
   * `include` conventionally covers a source tree that `outdir` sits inside — `./src/**` and
   * `src/styled-system` — so the build routinely parses its own output. That is load-bearing
   * rather than accidental, which is why the answer here is "do not report it" rather than
   * "do not read it": the token and keyframe scans read whatever `include` covers, and a
   * project that excludes its `outdir` should not lose them.
   */
  private isGenerated;
  /**
   * The text extraction reads for a file: its `parser:before` output, or its bytes when no hook
   * rewrites it. `undefined` when the file cannot be read at all.
   *
   * The same preparation `analyzeMany` is handed, so every scan that compares "what the parser
   * holds" against "what is on disk" compares against what extraction actually saw.
   */
  parsedSourceText: (filePath: string, onDisk?: string) => string | undefined;
  /**
   * Token accounting for one file's text, in Rust — see `token-accounting.ts` for the rules.
   *
   * This used to walk the TypeScript tree, which meant reading `project.getSourceFile` for
   * every file mentioning a token, and that started the Go compiler over the whole inventory
   * on every stylesheet build, since `prune.tokens` defaults on.
   */
  accountTokens: (filePath: string, source: string) => NativeTokenAccounting;
  /**
   * What the Vite compiler needs to know about modules, in one native call. See
   * `native-extractor/src/fold/model.rs`.
   *
   * `sources` are the modules to analyze, as the bundler hands them over. Every other module a
   * value is resolved through is read the way extraction reads it: its `parser:before` output
   * when a hook rewrites it, disk otherwise, and an overlay the project holds wins over both.
   */
  compileModules: (sources: NativeSource[], options: {
    references: boolean;
  }) => FoldAnalysis[];
  /**
   * The token table as the native evaluator reads it.
   *
   * Built once per context rather than per call: `compileModules` runs once per transformed
   * module, and the table is every token in the project — rebuilding it priced the whole
   * dictionary into every file, most of which never call `token()`.
   */
  private get nativeTokens();
  private nativeTokenTable;
  /** Load the required Rust extractor from the workspace or the published prebuild directory. */
  private loadNativeExtractor;
  private prepareNativeSource;
  /** Prepare a whole extraction pass in one coarse native invocation. */
  prepareNativeExtraction: (filePaths: readonly string[]) => void;
  /** Included extraction owners whose native value graph reaches `filePath`, transitively. */
  getNativeDependents: (filePath: string) => string[];
  /** @internal Native dependency edges, from dependency to extraction owner. */
  getNativeDependencyLedger: () => Array<readonly [string, string]>;
  forgetNativeFile: (filePath: string) => void;
  private parseNativeFile;
  parseFile: (filePath: string, styleEncoder?: StyleEncoder) => ParserResult | undefined;
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
  private get entrypointSpecifiers();
  /**
   * The files this pass has to read, out of everything `include` matched.
   *
   * See `selectExtractable`. Kept behind a method so the reasons live in one place and a caller
   * that wants the whole inventory — the watcher, the token scan — is unaffected: this narrows
   * what is *parsed*, not what the project holds.
   */
  extractableFiles: (files: readonly string[]) => string[];
  parseFiles: (styleEncoder?: StyleEncoder) => {
    filesWithCss: string[];
    files: string[];
    results: ParserResult[];
  };
  writeCss: (sheet?: Stylesheet) => Promise<PromiseSettledResult<void>[]> | undefined;
  writeSplitCss: (sheet: Stylesheet) => Promise<void>;
  watchConfig: (cb: (file: string) => void | Promise<void>, opts?: Omit<WatchOptions, "include">) => void;
  watchFiles: (cb: (event: WatcherEventType, file: string) => void | Promise<void>, opts?: Omit<WatchOptions, "include" | "exclude" | "poll" | "cwd" | "logger">) => void;
}
//#endregion
//#region src/analyze.d.ts
/**
 * `analyze` is one CLI command, but this module is reachable from `@bamboocss/node`'s index,
 * so a static import made every consumer of that index — the CLI on any command, and the Vite
 * plugin on every build — load the reporter and its table formatters to run neither. Loading
 * it here keeps that off the path of everything that is not the `analyze` command.
 */
declare function analyze(ctx: BambooContext, options?: AnalysisOptions): Promise<{
  getRecipeReport(format?: ReportFormat): {
    report: import("@bamboocss/reporter").RecipeReportEntry[];
    formatted: string;
  };
  getTokenReport(format?: ReportFormat): {
    report: import("@bamboocss/reporter").TokenAnalysisReport;
    formatted: string;
  };
  writeReport(filePath: string): Promise<void>;
}>;
//#endregion
//#region src/build-info.d.ts
declare function buildInfo(ctx: BambooContext, outfile: string): Promise<void>;
//#endregion
//#region src/builder.d.ts
/** Files a watcher knows moved since the previous setup. Omit this to retain filesystem discovery. */
interface BuilderSourceChanges {
  /** Absolute or cwd-relative paths. An empty list authoritatively means no source moved. */
  files: readonly string[];
  /** Additions and deletions can change glob membership, so they still reconcile the inventory. */
  needsInventoryScan?: boolean;
  /** A `dependencies` glob gained or lost a member and must be expanded before config diffing. */
  needsConfigReload?: boolean;
}
interface BuilderSetupOptions {
  configPath?: string;
  cwd?: string;
  dev?: boolean;
  /** Record each atom's first call site during extraction, for `getAtomOrigins`. */
  atomOrigins?: boolean;
  /** A watcher-owned change journal. Without one, Builder performs its standalone filesystem scan. */
  sourceChanges?: BuilderSourceChanges;
}
declare class Builder {
  /**
   * The current bamboo context
   */
  context: BambooContext | undefined;
  private hasEmitted;
  private filesMeta;
  private explicitDepsMeta;
  private affecteds;
  private configDependencies;
  /** Last complete included inventory, including members which have since been deleted. */
  private sourceInventory;
  /** Existing included owners selected by the last resolution-ledger invalidation pass. */
  private affectedFiles;
  /** Dependency-before-importer parse order for the selected owners. */
  private extractionOrder;
  /** Exact cross-file semantic reads retained per included extraction owner. */
  private resolutionReadSets;
  /** Previously semantic paths which are absent, retained only while their owner is unchanged. */
  private pendingResolutionReadSets;
  /** Missing local priority candidates which can redirect a current semantic resolution. */
  private resolutionCandidateSets;
  /** Exact resolver configuration reads retained per included semantic owner. */
  private resolutionConfigurationSets;
  /** Byte snapshots for resolver configuration files, independent of filesystem mtimes. */
  private resolutionConfigurationBytes;
  /** Previous effective tsconfig read-set, needed to classify its deletion as an option reload. */
  private tsconfigResolutionFiles;
  /** Config-graph mtimes as of the last completed setup, consulted by the dev fast path. */
  private configGraphMtimes;
  /** Per-file source-scan results for `toCss`, valid while each file's mtime stands still. */
  private sourceScanCache;
  /**
   * Dependency edges as they stood before this pass's first source mutation, and the owners
   * each changed file reached then — before re-extraction replaces the edges that found them.
   */
  private capturedLedger;
  private capturedDependents;
  /**
   * Reload one edited source, keeping the closure the next extraction pass has to select.
   *
   * An integration which shares this context has to refresh an edited module before anything
   * folds against it — a consumer is transformed before the module it imports, so the fold
   * would otherwise bake in the previous contents. Doing that through the Project directly
   * loses the graph the rebuild needs: reloading retracts the file's own forward edges, and
   * `invalidateChangedSources` reads them afterwards to find its dependents. So the mutation
   * belongs here, behind a snapshot taken before the first of them.
   *
   * Once per pass, not once per file: the first mutation is the boundary, and every later one
   * in the same event is already described by that snapshot. `refreshSourceState` consumes it.
   */
  reloadSource: (filePath: string) => void;
  /** The deletion half of `reloadSource`, with the same snapshot obligation. */
  removeSource: (filePath: string) => void;
  private captureResolutionLedger;
  /** @internal Current and missing resolver paths which can change the stylesheet. */
  getResolutionReadFiles: () => readonly string[];
  /** @internal The inventory reconciled by the most recent extraction pass. */
  getSourceFiles: () => readonly string[];
  /** The compiled `include`/`exclude` matcher of each context, since the compiler asks per module. */
  private sourceMatchers;
  /**
   * @internal Whether this path is one `include` covers and `exclude` does not.
   *
   * What decides source membership when a file appears, and what the Vite compiler asks of
   * every module it is handed: a module outside the extraction inventory yields no rule, so
   * compiling it is wasted — and with the TypeScript 7 backend, far from free.
   */
  isPotentialSourceFile: (filePath: string) => boolean;
  /** @internal Whether creating or deleting this path can change a `dependencies` glob. */
  isPotentialConfigDependency: (filePath: string) => boolean;
  /** @internal Exact local package/tsconfig files which can change semantic resolution. */
  getResolutionConfigurationFiles: () => readonly string[];
  private readResolutionConfiguration;
  private changedResolutionConfigurations;
  private snapshotResolutionConfigurations;
  private recordConfigDependencies;
  setup: (options?: BuilderSetupOptions) => Promise<BambooContext | undefined>;
  /** Every file whose content participates in the resolved config, for the dev fast path. */
  private configGraphFiles;
  private configGraphUnchanged;
  private snapshotConfigGraphMtimes;
  /** The per-pass source bookkeeping every setup ends with, config reload or not. */
  private refreshSourceState;
  /** Normalize the path identity shared by the Project ledger and file-owner keys. */
  private sourcePath;
  /**
   * Refresh changed sources, then select them and their transitive included consumers.
   *
   * Consumers come from the native evaluator's read graph, which includes paths a consumer
   * probed and did not find — so a file appearing reaches the importers that were waiting for
   * it. The graph is read before anything is re-extracted: re-extraction replaces an owner's
   * edges, and waiting would lose the very closure the rebuild needs. An integration that
   * mutated sources earlier in the pass captured it then (`reloadSource`, `removeSource`).
   */
  private invalidateChangedSources;
  /** Deterministic topological order, with current inventory order as the stable tie-break. */
  private orderAffectedFiles;
  /**
   * Write the generated `styled-system`, so an integration can be a project's only codegen.
   *
   * The first call writes everything. That looks like the redundant half — a project that ran
   * `bamboo codegen` already has the files — but it is the only call that ever mattered, and it
   * used to do nothing: the guard below read `hasEmitted` before it was ever set, so the first
   * call fell straight through to setting the flag and the artifacts were written only after a
   * *subsequent* config change. A clone with no `styled-system/` on disk therefore got none from
   * `vite dev` or `vite build` either, which is what the callers exist to guarantee — the dev
   * server answered with an error overlay, and the build failed to resolve `styled-system/css`
   * from the first module that imports it. Every project has had to run the CLI first and pass
   * for a build step, which on one react-router app is 585 ms of a 2,242 ms build, ~97% of it
   * spent loading modules to do 21 ms of work.
   *
   * Later calls stay narrow, which is what the guard was reaching for. A watch rebuild re-emits
   * only the artifacts a config change affected, and a rebuild that changed no config writes
   * nothing at all.
   */
  emit(): Promise<void>;
  setupContext: (options: SetupContextOptions) => Promise<BambooContext>;
  getContextOrThrow: () => BambooContext;
  /** One canonical spelling for verification keys: absolute, forward slashes. */
  private absOwner;
  getFileMeta: (file: string) => {
    mtime: number;
    isUnchanged: boolean;
  };
  checkFilesChanged(files: readonly string[], knownChanges?: ReadonlySet<string>): {
    changes: Map<string, FileMeta>;
    hasFilesChanged: boolean;
  };
  extractFile: (ctx: BambooContext, file: string) => ParserResult | undefined;
  extract: () => void;
  /**
   * The finished stylesheet, as a string.
   *
   * `layerParams` controls the `@layer a, b, c;` statement that fixes layer order. CSS layers
   * are ordered by first appearance otherwise.
   *
   * `extract` has to have run first: this reads the encoder rather than filling it.
   */
  toCss: ({
    layerParams
  }?: {
    layerParams?: boolean;
  }) => string;
  /**
   * Each atom's first call site, by class name, as recorded by the last `extract`.
   *
   * Empty unless `setup` was asked for `atomOrigins`.
   */
  getAtomOrigins: () => Map<string, import("@bamboocss/core").AtomOrigin>;
}
interface FileMeta {
  mtime: number;
  isUnchanged: boolean;
}
interface SetupContextOptions {
  configPath: string;
  cwd?: string;
  /** @see `BuilderSetupOptions.atomOrigins` */
  atomOrigins?: boolean;
  /** Set by the integration; only a dev server knows it is one. @see `hash: 'auto'` */
  dev?: boolean;
}
//#endregion
//#region src/codegen.d.ts
declare function codegen(ctx: BambooContext, ids?: ArtifactId[]): Promise<{
  box: string;
  msg: string;
}>;
//#endregion
//#region src/config.d.ts
interface NodeConfigOptions {
  cwd?: string;
  config?: Config;
  configPath?: string;
  dev?: boolean;
}
/**
 * Load config and create context with auto-injected plugins.
 * Used by the CLI and PostCSS plugin.
 */
declare function loadConfigAndCreateContext(options?: NodeConfigOptions): Promise<BambooContext>;
//#endregion
//#region src/cpu-profile.d.ts
declare const startProfiling: (cwd: string, prefix: string, isWatching?: boolean) => Promise<(cb?: () => void) => void>;
//#endregion
//#region src/cssgen.d.ts
interface CssGenOptions {
  cwd: string;
  outfile?: string;
  type?: CssArtifactType;
  splitting?: boolean;
}
declare const cssgen: (ctx: BambooContext, options: CssGenOptions) => Promise<void>;
//#endregion
//#region src/debug.d.ts
interface DebugOptions {
  outdir: string;
  dry: boolean;
  onlyConfig?: boolean;
}
declare function debug(ctx: BambooContext, options: DebugOptions): Promise<void>;
//#endregion
//#region src/generate.d.ts
declare function generate(config: Config, configPath?: string): Promise<void>;
//#endregion
//#region src/git-ignore.d.ts
declare function setupGitIgnore(ctx: BambooContext): void;
//#endregion
//#region src/logstream.d.ts
interface LogstreamOptions {
  cwd?: string;
  logfile?: string;
}
declare const setLogStream: (options: LogstreamOptions) => {
  end(): void;
  [Symbol.dispose]: () => void;
};
//#endregion
//#region src/setup-config.d.ts
type SetupOptions = Partial<Config> & {
  force?: boolean;
};
declare function setupConfig(cwd: string, opts?: SetupOptions): Promise<void>;
//#endregion
//#region src/spec.d.ts
interface SpecOptions {
  outdir?: string;
}
declare function spec(ctx: BambooContext, options: SpecOptions): Promise<SpecFile[]>;
//#endregion
//#region src/vite-integration.d.ts
/** The project's Vite config, if it has one. Not resolved further than existence. */
declare const findViteConfig: (cwd: string) => string | undefined;
/**
 * Does this project author styles somewhere the Vite compiler cannot reach?
 *
 * Two signals because the two callers know different things. A resolved config names the file
 * types directly, and is authoritative when it does; `bamboo init` runs before there is one,
 * so the dependency list stands in. Either one is enough — both directions of a wrong answer
 * here only decide whether advice is offered, and the advice is worth less than a Svelte
 * project being told to break itself.
 */
declare const hasUncompilableSources: (options: {
  cwd: string;
  include?: readonly string[];
}) => boolean;
//#endregion
export { BambooContext, Builder, type BuilderSetupOptions, type BuilderSourceChanges, type CssGenOptions, ParserResult, SourceProject, type UnresolvedStyle, analyze, buildInfo, codegen, cssgen, debug, findViteConfig, generate, generatePackageExports, hasUncompilableSources, isStaticCompilerActive, loadConfigAndCreateContext, markStaticCompilerActive, setLogStream, setupConfig, setupGitIgnore, spec, startProfiling };