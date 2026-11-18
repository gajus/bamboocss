export interface NativeEntrypoint {
  kind: 'css' | 'pattern' | 'recipe' | 'token'
  modules: string[]
  /** Configured callable exports for this entrypoint. */
  names: string[]
}

export interface NativeLoss {
  prop?: string
  reason: 'unresolvable-value' | 'missing-property' | 'unenumerable-keys' | 'unresolved-raw'
}

export interface NativeCall {
  /** Binding spelling at the call site, including supported namespace/member access. */
  name: string
  importedName: string
  kind: NativeEntrypoint['kind'] | 'tokenValue' | 'dead' | 'jsx'
  module: string
  start: number
  end: number
  /** UTF-16 source range of the root imported binding, used by token accounting. */
  calleeStart: number
  calleeEnd: number
  /** One-based source location of the call. */
  line: number
  column: number
  /** Encoder-ready static fragments, including both enumerable conditional branches. */
  arguments: unknown[]
  /** False when dynamic input was intentionally omitted from the static fragments. */
  complete: boolean
  losses: NativeLoss[]
  /** Top-level keys (or JSX attributes) of a recipe call whose value the build could not read. */
  unresolvedKeys: string[]
  /** The name a `keyframes()` call whose stops the build read whole returns. */
  value?: string
  /**
   * A `token()` call whose result is tested or defaulted rather than used as it is — the left of
   * `??`, `||` or `&&`, a test, `!`, `typeof` or an equality — so a path naming nothing is a case
   * its author handled.
   */
  guarded: boolean
}

export interface NativeAnalysis {
  calls: NativeCall[]
  errors: string[]
  /** Local source modules whose values contributed to this file's extraction. */
  dependencies: string[]
  /** Missing local candidates whose appearance can redirect extraction. */
  pendingCandidates: string[]
  /** package.json/tsconfig files which selected semantic imports. */
  configurationFiles: string[]
}

export interface NativeSource {
  filename: string
  source: string
}

export interface NativePathMapping {
  pattern: string
  paths: string[]
}

export interface NativeToken {
  path: string
  value?: unknown
  variable?: string
}

export interface NativeProjectOptions {
  cwd?: string
  baseUrl?: string
  paths: NativePathMapping[]
  tokens: NativeToken[]
  jsx: boolean
  /** The class prefix a `keyframes()` name is written after. */
  classPrefix?: string
}

export interface NativeFileAnalysis extends NativeAnalysis {
  filename: string
}

export function analyze(filename: string, source: string, entrypoints: NativeEntrypoint[]): NativeAnalysis
export function analyzeMany(
  sources: NativeSource[],
  entrypoints: NativeEntrypoint[],
  options?: NativeProjectOptions,
): NativeFileAnalysis[]

export interface NativeTokenDecline {
  reason:
    | 're-exported'
    | 'import-equals'
    | 'require'
    | 'dynamic-import'
    | 'unclassified-import'
    | 'unsupported-import'
    | 'unresolved-reference'
  line: number
  /** UTF-16 source range of the declined syntax. */
  start: number
  end: number
}

export interface NativeTokenAccounting {
  paths: string[]
  prefixes: string[]
  declined: NativeTokenDecline[]
  /** The file did not parse, so nothing in it can be trusted. */
  unparsed: boolean
}

export function accountTokens(
  filename: string,
  source: string,
  tokenModules: string[],
  pathMappings?: NativePathMapping[],
): NativeTokenAccounting

/** A UTF-16 source range. */
export interface FoldSpan {
  start: number
  end: number
}

export interface FoldSelectionProperty {
  key: string
  shorthand: boolean
  literal?: unknown
  text: string
  inert: boolean
  resolved?: unknown
  /** An object or an array, written as one or known to be one: a value no variant is named. */
  structured: boolean
}

export interface FoldSelection {
  identifier?: string
  properties?: FoldSelectionProperty[]
  unenumerable: boolean
}

export interface FoldCxArgument {
  span: FoldSpan
  /**
   * `binding` is a module-scope `const` initialised with a `css()` or pattern call, here or in a
   * module this one imports it from. `when` is `test && value`, `choose` is `test ? a : b`.
   */
  kind: 'string' | 'ignored' | 'array' | 'binding' | 'when' | 'choose' | 'expression' | 'spread'
  value?: string
  /** For `array`, its elements; for `when`, the value; for `choose`, the consequent then the alternate. */
  elements?: FoldCxArgument[]
  /**
   * For `when` and `choose`: the condition, as written. Never one reading a Bamboo binding or a
   * recipe, since the fold copies it into what it writes.
   */
  test?: FoldSpan
  /** For a `binding` declared in this module: the style call it is initialised with. */
  definition?: FoldSpan
  /** For a `binding` imported from another module: the local name `importedStyles` is keyed by. */
  binding?: string
  /**
   * For an argument of the call itself: its whole span, wrappers and parentheses included — what the
   * fold copies when it leaves the argument to the runtime join. `span` is what the argument holds.
   */
  written?: FoldSpan
  /** For an argument of the call itself: it reads a Bamboo binding or a recipe, so it cannot be copied. */
  readsBamboo: boolean
}

export interface FoldCall {
  name: string
  kind:
    | 'css'
    | 'pattern'
    | 'recipe'
    | 'token'
    | 'tokenValue'
    | 'viewTransition'
    | 'keyframes'
    | 'cva-call'
    | 'cva'
    | 'sva'
    | 'cx'
  span: FoldSpan
  slot?: string
  slotEnd?: number
  shadowedHelpers: string[]
  raw: boolean
  notImported: boolean
  calleeProperty?: string
  data: unknown[]
  exact: boolean
  /** Why the call is not exact, when the evaluator refused code it does not run. */
  refusal?: FoldRefusal
  argumentCount: number
  trailingArgumentsInert: boolean
  selection?: FoldSelection
  origin?: { filePath: string; name: string }
  binding?: string
  cxArguments: FoldCxArgument[]
  /** For an exact `keyframes()` call: the name it returns, which the fold writes in its place. */
  value?: string
  /**
   * A `token()` call whose result is tested or defaulted rather than used as it is,
   * `token('colors.brand') ?? '#fff'`: a path naming no token is a case its author handled, and
   * the call is compiled to the `undefined` it returns.
   */
  guarded: boolean
  /**
   * A `token.value()` or `cx()` call written first in an expression statement. What replaces it there
   * cannot open with `(` or `-`, which would continue the line before it where that line has no
   * semicolon.
   */
  statementStart: boolean
}

/**
 * Code the evaluator does not run. `statement`: a helper's body uses one — `subject` is its
 * keyword, or `expression` for a statement run for its effect. `write`: the binding `subject` is
 * reassigned or written into after its declaration. `recursion`: a helper call the evaluator does not
 * follow — `subject` is `loop` when the helper is already running with arguments it cannot tell
 * apart, `depth` when calls nest deeper than it follows, `calls` when one call makes more of them
 * than it follows, `module` when the helper is called again through another module while it runs;
 * `helper` and the location are the recursive helper: for `loop` the first to run of those its
 * cycle goes through, for `calls` the same of the cycle the innermost recurring call closes, for
 * `depth` the one most of the calls running are of. `compiled`: a call the compiler replaces,
 * `css()` or a recipe, whose value only it knows — `subject` is the name it imports, `excerpt` and
 * the location the call. `line` is 1-based; `column` too, in UTF-16.
 */
export interface FoldRefusal {
  kind: 'statement' | 'write' | 'recursion' | 'compiled'
  subject: string
  helper?: string
  excerpt: string
  filePath: string
  line: number
  column: number
}

export interface FoldSplitCall {
  span: FoldSpan
  binding: string
  shadowedHelpers: string[]
  imported: boolean
  argumentText: string
}

export interface FoldImport {
  span: FoldSpan
  module: string
  typeOnly: boolean
  specifiers: Array<{ imported: string; local: string; typeOnly: boolean; end: number; shadowedAnywhere: boolean }>
  defaultLocal?: string
  namespaceLocal?: string
}

export interface FoldAnalysis {
  calls: FoldCall[]
  splitCalls: FoldSplitCall[]
  imports: FoldImport[]
  moduleScopeNames: string[]
  references: Array<{ name: string; span: FoldSpan }>
  runtimeShapes: Array<{
    kind: 'import' | 'require' | 'import-equals' | 'export-star' | 'export-from'
    name: string
    module: string
    span: FoldSpan
  }>
  localExports: Array<{ local: string; span: FoldSpan }>
  importedRecipes: Array<{
    local: string
    filePath: string
    name: string
    config?: unknown
    declaringImports: string[]
    dependencies: string[]
  }>
  /**
   * Imports a `cx()` argument names that resolve to an exact `css()` or pattern call bound at module
   * scope in another module: `kind` is `css` or `pattern`, `callee` the function called, `data` its
   * evaluated arguments, `dependencies` every module a composition against it depends on.
   */
  importedStyles: Array<{
    local: string
    filePath: string
    name: string
    kind: 'css' | 'pattern'
    callee: string
    data: unknown[]
    dependencies: string[]
  }>
  dependencies: string[]
  /**
   * Bamboo bindings a `<script setup>` compiled for a separate render function exposes to its
   * template, as `__returned__` getters: where the getter reads the binding, what that becomes
   * once nothing reads it, and every `$setup.<name>` the module reads.
   */
  vueExposures: Array<{ name: string; span: FoldSpan; replacement: string; reads: FoldSpan[] }>
  errors: string[]
}

export interface NativeFoldOptions {
  cwd?: string
  baseUrl?: string
  paths: NativePathMapping[]
  tokens: NativeToken[]
  cssModules: string[]
  tokenModules: string[]
  recipeModules: string[]
  patternModules: string[]
  recipeNames: string[]
  patternNames: string[]
  references: boolean
  /** The class prefix a `keyframes()` name is written after. */
  classPrefix?: string
}

export function compileModules(
  sources: NativeSource[],
  auxiliary: NativeSource[],
  options: NativeFoldOptions,
): FoldAnalysis[]
