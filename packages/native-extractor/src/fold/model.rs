//! What the Vite compiler needs to know about one module, as plain data.
//!
//! The compiler used to walk a TypeScript tree for this. Everything it read off that tree is a
//! fact about the source — a span, whether a name is shadowed, whether an argument is a literal,
//! which import a binding came from — and every such fact is answered here from Oxc's AST and
//! semantic model, then handed across as records. JavaScript keeps class allocation, decision
//! tables and the text edits, none of which needs a tree.
//!
//! Offsets are UTF-16 code units, the unit JavaScript strings index by.

use napi_derive::napi;

/// A source range, UTF-16.
#[napi(object)]
#[derive(Clone, Copy, Default)]
pub struct FoldSpan {
    pub start: u32,
    pub end: u32,
}

/// One call of a Bamboo style API, with everything the fold decides it by.
#[napi(object)]
pub struct FoldCall {
    /// `css`, `cva`, `sva`, `cx`, `token`, `tokenValue`, `viewTransition`, a pattern name, a
    /// config recipe name, or — for `kind == "recipe-call"` — the local recipe binding.
    pub name: String,
    /// `css`, `pattern`, `recipe` (config), `token`, `tokenValue`, `viewTransition`,
    /// `cva-call` (an inline recipe invocation), `cva`/`sva` (a definition), or `cx`.
    pub kind: String,
    /// The call expression.
    pub span: FoldSpan,
    /// A property read directly off the call — `recipe(props).root` — and where that read ends.
    /// Whether it names a slot is the caller's to decide, against the recipe's config.
    pub slot: Option<String>,
    pub slot_end: Option<u32>,
    /// Helper names (`cvaMap`, `cvaJoin`, `splitProps`, or a local alias of one) that a nested scope
    /// enclosing this call rebinds, so a rewrite calling one would reach the wrong binding.
    pub shadowed_helpers: Vec<String>,
    /// The callee is `x.raw` (or `x.raw?.`, or `x['raw']`).
    pub raw: bool,
    /// The callee's root binding is not a Bamboo import at the call site: a local of the same
    /// name, a parameter, or somebody else's module.
    pub not_imported: bool,
    /// For a token call: the callee's property, `value` for `token.value`, otherwise absent.
    pub callee_property: Option<String>,
    /// Evaluated arguments, as extraction reads them: one fragment per argument, plus one per
    /// statically enumerable conditional branch.
    pub data: Vec<serde_json::Value>,
    /// Every argument evaluated to exactly one value the program will produce: no unknown
    /// leaf, no branch collapsed to one arm, no destructuring default standing in for a value,
    /// no spread or computed key the value cannot account for.
    pub exact: bool,
    /// For `css()`, the exact style objects its choices give, decided by their tests at the call site.
    pub style_choice: Option<FoldStyleChoice>,
    /// For a call that is not exact because the evaluator refused code it does not run: what,
    /// and where. Absent when it is not exact for any other reason.
    pub refusal: Option<FoldRefusal>,
    /// For a `css()`, pattern, `token()` or `viewTransition()` call that is neither exact nor
    /// compiled as a choice, where the evaluator refused nothing: what in it the build cannot know.
    pub unknown: Option<FoldUnknown>,
    /// Number of arguments written at the call site.
    pub argument_count: u32,
    /// Every argument after the first is a literal whose evaluation cannot run anything.
    pub trailing_arguments_inert: bool,
    /// For a recipe invocation: the selection as written. Absent when the argument is neither
    /// an object literal nor an identifier.
    pub selection: Option<FoldSelection>,
    /// For a recipe invocation of a binding imported from another module: where it was declared.
    pub origin: Option<FoldOrigin>,
    /// For a recipe definition bound at module scope: the binding's name.
    pub binding: Option<String>,
    /// For a `cx()` call: its arguments, classified.
    pub cx_arguments: Vec<FoldCxArgument>,
    /// For a `cx()` call holding conditions: what each asks, which `FoldCxArgument::condition`
    /// indexes. JSON, an array of `FoldCondition`s. Absent where no answer to one can decide another
    /// — no two read one value, and the call composes no choice — and so then is every index.
    pub conditions: Option<String>,
    /// For an exact `keyframes()` call: the name it returns, which the fold writes in its place.
    pub value: Option<String>,
    /// A `token()` call whose result is tested or defaulted rather than used as it is,
    /// `token('colors.brand') ?? '#fff'`: a path naming no token is a case its author handled,
    /// and the call is compiled to the `undefined` it returns. See `result_guarded`.
    pub guarded: bool,
    /// A `token.value()`, `cx()` or conditional `css()` call written first in an expression statement,
    /// `token.value('zIndex.hide').toFixed()` standing as one. What replaces it there cannot open
    /// with `(` or `-`, which would continue the line before it where that line has no semicolon.
    pub statement_start: bool,
}

#[napi(object)]
pub struct FoldStyleChoice {
    /// Each test, as written: anything but one reading a Bamboo binding or a recipe, since the
    /// fold copies it into what it writes, to choose between the styles where the call was.
    pub tests: Vec<FoldSpan>,
    /// For a call a `cx()` composes: what each of `tests` asks, by index, so that the `cx()` decides
    /// one an answer on its path has decided, as `tree` already does within the call. JSON, an array
    /// of `FoldCondition`s. Absent for any other call, whose `tree` is all the fold reads, and where
    /// the text cannot be written, which leaves every test asked.
    pub conditions: Option<String>,
    /// The decision, as the call asks it, as JSON: a node is `{ test, then, otherwise }`, `test`
    /// indexing `tests`, and a leaf is `{ styles }`, the call's arguments on that path, each a style
    /// object. Text, since a tree of objects crossed into JavaScript one object at a time cost more
    /// than building it.
    pub tree: String,
}

/// What a condition the fold copies asks, so that one answer on a path can decide a later one.
///
/// A condition asks about one value where it reads that value alone, `size` or `props.size`, and
/// either tests it, `size` or `!size`, or compares it strictly with a literal, `size === 'sm'` or
/// `size !== 'sm'`. Two such conditions reading one value answer together: where `size === 'sm'`
/// answered yes, `size === 'lg'` can only answer no, so the decision does not ask it there, and the
/// combination of both answering yes, which no value reaches, is not written out.
///
/// Crossed into JavaScript as JSON, a call's at a time (`FoldCall::conditions`,
/// `FoldStyleChoice::conditions`): one object per condition, set field by field across the
/// boundary, cost more than the analysis that classified it.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoldCondition {
    /// The condition can run nothing but the reads it makes — reads, literals, and `!`, `typeof`,
    /// `void`, `===`, `!==`, `&&`, `||`, `??` and `?:` over them — so asking it changes no value a
    /// later one reads. After one that could run something, what earlier answers said may no
    /// longer hold, and nothing asked before it decides anything asked after it.
    pub inert: bool,
    /// The value it asks about, as it is read: `size`, `props.size`. Absent where it asks
    /// anything else, which decides nothing and is decided by nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// The literal `subject` is compared with, `===` or `!==`, as JavaScript writes it — `"sm"`,
    /// `0`, `true`, `null`, `undefined` — so two are strictly equal where they are the same text.
    /// Absent where the condition asks whether `subject` is truthy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub literal: Option<String>,
    /// Whether `literal` is truthy, where there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub literal_truthy: Option<bool>,
    /// The condition answers the opposite of what it asks: `!size`, `size !== 'sm'`.
    pub negated: bool,
}

/// Code the evaluator does not run, which is why a call's arguments are not known.
///
/// The call site says nothing about it: the statement is in a helper's body, possibly in another
/// module, and a binding's write may be anywhere in its module.
#[napi(object)]
pub struct FoldRefusal {
    /// `statement`: a helper's body uses a statement the evaluator does not run.
    /// `write`: a binding is reassigned or written into after its declaration.
    /// `recursion`: a helper call the evaluator does not follow.
    /// `compiled`: a call the compiler replaces, `css()` or a recipe, whose value only it knows.
    pub kind: String,
    /// For `statement`, its keyword — `switch`, `for…of`, `throw` — or `expression` for one run
    /// for its effect. For `write`, the binding's name. For `recursion`, why: `loop`, the helper
    /// is already running with arguments the evaluator cannot tell apart; `depth`, calls nest
    /// deeper than it follows; `calls`, one call makes more of them than it follows; `module`,
    /// the helper is called again, through another module, while it runs. For `compiled`, the
    /// name the call imports.
    pub subject: String,
    /// For `statement`, the helper whose body it is in, when it has a name. For `recursion`, the
    /// recursive helper, which is also where the refusal points.
    pub helper: Option<String>,
    /// The statement, the one making the write, or the call, as written: its first line,
    /// shortened.
    pub excerpt: String,
    pub file_path: String,
    /// 1-based, the column in UTF-16 code units.
    pub line: u32,
    pub column: u32,
}

/// What keeps a call's arguments from being known at build time where the evaluator refused no
/// code: the first value in them the audit cannot account for, or what keeps the call's choices
/// from compiling. The kinds are `exact::Unknown`'s.
#[napi(object)]
pub struct FoldUnknown {
    pub kind: String,
    /// The value, as written: its first line, shortened.
    pub excerpt: String,
    /// For `choices`: how many the call holds.
    pub count: u32,
    pub file_path: String,
    /// 1-based, the column in UTF-16 code units.
    pub line: u32,
    pub column: u32,
}

/// A recipe invocation's single argument, as the call site writes it.
#[napi(object)]
pub struct FoldSelection {
    /// `recipe(props)`: every variant reads `props.<variant>` at runtime.
    pub identifier: Option<String>,
    /// `recipe({ ... })`, in source order. Absent for an identifier argument.
    pub properties: Option<Vec<FoldSelectionProperty>>,
    /// The object literal has a spread, a computed key, a method or an accessor.
    pub unenumerable: bool,
}

#[napi(object)]
pub struct FoldSelectionProperty {
    pub key: String,
    /// `{ tone }`.
    pub shorthand: bool,
    /// The value is a literal: its value, as JSON.
    pub literal: Option<serde_json::Value>,
    /// Source text of the value expression, to re-emit as a runtime selector.
    pub text: String,
    /// The value cannot run anything when evaluated.
    pub inert: bool,
    /// The value evaluated to exactly one scalar the program will produce.
    pub resolved: Option<serde_json::Value>,
    /// The value is an object or an array, written as one or evaluated exactly to one. No
    /// variant is named by one: `{ base: 'sm', md: 'lg' }` is a responsive selection, which a
    /// recipe call does not take.
    pub structured: bool,
}

#[napi(object)]
pub struct FoldOrigin {
    pub file_path: String,
    pub name: String,
}

/// One argument of `cx(...)`.
#[napi(object)]
pub struct FoldCxArgument {
    pub span: FoldSpan,
    /// `string` (a literal class), `ignored` (`false`/`null`/`undefined`/…), `array`, `binding`
    /// (a module-scope `const` initialised with a `css()` or pattern call, here or in a module
    /// this one imports it from), `when` (`test && value`), `choose` (`test ? a : b`), or
    /// `expression` (anything else — matched against a folded call by span).
    pub kind: String,
    pub value: Option<String>,
    /// For `array`: its elements, classified the same way. Absent when an element is a spread.
    /// For `when`: the value. For `choose`: the consequent, then the alternate.
    pub elements: Option<Vec<FoldCxArgument>>,
    /// For `when` and `choose`: the condition, as written. Never one reading a Bamboo binding or
    /// a recipe: the fold copies it into what it writes, and a copy would keep that read alive.
    pub test: Option<FoldSpan>,
    /// For `when` and `choose`: what the condition asks, as its index in the call's `conditions`,
    /// where the call has them.
    pub condition: Option<u32>,
    /// For a `binding` declared in this module: the style call it is initialised with, which is
    /// where the fold finds its declarations.
    pub definition: Option<FoldSpan>,
    /// For a `binding` imported from another module: the local name, which `imported_styles`
    /// is keyed by.
    pub binding: Option<String>,
    /// For an argument of the call itself: its whole span, wrappers and parentheses included.
    /// `span` is what the argument holds, which is where a folded call is matched; this is what
    /// the fold copies when it leaves the argument to the runtime join, and copying `span` would
    /// make two arguments of `(a, b)`.
    pub written: Option<FoldSpan>,
    /// For an argument of the call itself: it reads a Bamboo binding or a recipe, so a copy of it
    /// would keep that read alive.
    pub reads_bamboo: bool,
}

/// A named import of a module-scope `const` that another module initialises with an exact
/// `css()` or pattern call: `export const base = css({ … })`.
#[napi(object)]
pub struct FoldImportedStyle {
    pub local: String,
    pub file_path: String,
    pub name: String,
    /// `css` or `pattern`.
    pub kind: String,
    /// The function called: `css`, or the pattern's name.
    pub callee: String,
    /// The call's evaluated arguments, which are exact.
    pub data: Vec<serde_json::Value>,
    /// The modules a `cx()` composed against this style depends on: the import's target, every
    /// module a re-export route crossed, the declaring module and whatever its arguments read.
    pub dependencies: Vec<String>,
}

/// `x.splitVariantProps(arg)` on a binding the module can name.
#[napi(object)]
pub struct FoldSplitCall {
    pub span: FoldSpan,
    pub binding: String,
    pub shadowed_helpers: Vec<String>,
    /// The binding is a Bamboo import (a config recipe) rather than a local.
    pub imported: bool,
    pub argument_text: String,
}

/// An import declaration, for helper insertion and entrypoint matching.
#[napi(object)]
pub struct FoldImport {
    pub span: FoldSpan,
    pub module: String,
    /// The Bamboo entrypoint the module is, as calls through its bindings are classified —
    /// `css`, `token`, `recipe` or `pattern` — or none for any other module.
    pub bamboo: Option<String>,
    pub type_only: bool,
    pub specifiers: Vec<FoldImportSpecifier>,
    pub default_local: Option<String>,
    pub namespace_local: Option<String>,
}

#[napi(object)]
pub struct FoldImportSpecifier {
    pub imported: String,
    pub local: String,
    pub type_only: bool,
    /// Start of the specifier, `cx` or `cx as merge`, so it can be rewritten whole.
    pub start: u32,
    /// End of the specifier, where a sibling can be appended.
    pub end: u32,
    /// The local binding is shadowed somewhere in the module (a nested scope binds its name).
    pub shadowed_anywhere: bool,
}

/// `export { … } from` a Bamboo entrypoint, which hands its names on without binding them here.
#[napi(object)]
pub struct FoldReexport {
    pub module: String,
    /// As `FoldImport::bamboo`, which is never none here.
    pub bamboo: String,
    /// The module specifier's string literal, quotes included.
    pub source: FoldSpan,
    pub specifiers: Vec<FoldReexportSpecifier>,
}

#[napi(object)]
pub struct FoldReexportSpecifier {
    /// The name as the module re-exported from exports it.
    pub local: String,
    pub type_only: bool,
}

/// A value read of a binding the survivor check watches.
#[napi(object)]
pub struct FoldReference {
    pub name: String,
    pub span: FoldSpan,
}

/// A shape that keeps a Bamboo module alive without a static named binding.
#[napi(object)]
pub struct FoldRuntimeShape {
    /// `import`, `require`, `import-equals`, `export-star`, `export-from`.
    pub kind: String,
    pub name: String,
    pub module: String,
    pub span: FoldSpan,
}

/// What a `<script setup>` compiled for a separate render function exposes to its template.
///
/// The dev server compiles a template into a render function of its own, which reads setup
/// bindings off its `$setup` parameter, and `setup()` returns them as getters:
/// `__returned__ = { get css() { return css } }`. Once every `$setup.css` the template reads is
/// compiled, the getter is the one thing still holding the import.
#[napi(object)]
pub struct FoldVueExposure {
    pub name: String,
    /// The read of the binding inside the getter, or the shorthand property.
    pub span: FoldSpan,
    /// What the span becomes once nothing reads it: `undefined`, or `css: undefined`.
    pub replacement: String,
    /// Every `$setup.<name>` the module reads.
    pub reads: Vec<FoldSpan>,
}

/// `export { local as exported }` with no `from`.
#[napi(object)]
pub struct FoldLocalExport {
    pub local: String,
    pub span: FoldSpan,
}

#[napi(object)]
pub struct FoldAnalysis {
    pub calls: Vec<FoldCall>,
    pub split_calls: Vec<FoldSplitCall>,
    pub imports: Vec<FoldImport>,
    /// Value re-exports from a Bamboo entrypoint. Collected whether or not references are, since
    /// what the fold writes from them cannot depend on that.
    pub reexports: Vec<FoldReexport>,
    /// Every name bound at module scope, including hoisted `var`s and imports.
    pub module_scope_names: Vec<String>,
    /// Value reads of each import binding and each module-scope recipe binding, in source
    /// order. Type positions, declarations, property names and lowercase JSX tags are excluded.
    pub references: Vec<FoldReference>,
    pub runtime_shapes: Vec<FoldRuntimeShape>,
    pub local_exports: Vec<FoldLocalExport>,
    /// Imports of this module that resolve to an inline recipe declared elsewhere.
    pub imported_recipes: Vec<FoldImportedRecipe>,
    /// Imports of this module that a `cx()` argument names and that resolve to an exact style
    /// call bound at module scope elsewhere.
    pub imported_styles: Vec<FoldImportedStyle>,
    /// Other modules whose values reached a call's data.
    pub dependencies: Vec<String>,
    /// Bamboo bindings a `<script setup>` exposes to a separately compiled template.
    pub vue_exposures: Vec<FoldVueExposure>,
    pub errors: Vec<String>,
}

#[napi(object)]
pub struct FoldImportedRecipe {
    pub local: String,
    pub file_path: String,
    pub name: String,
    /// The declaring module's single resolved config; absent when it declares the name twice
    /// or the config resolved to more than one value.
    pub config: Option<serde_json::Value>,
    /// The modules a call lowered against this recipe depends on: the import's target, every
    /// module a re-export route crossed, the declaring module and whatever its config read.
    pub dependencies: Vec<String>,
}
