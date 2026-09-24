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
    /// Helper names (`cvaMap`, `splitProps`, or a local alias of either) that a nested scope
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
    /// `string` (a literal class), `ignored` (`false`/`null`/`undefined`/…), `array`, or
    /// `expression` (anything else — matched against a folded call by span).
    pub kind: String,
    pub value: Option<String>,
    /// For `array`: its elements, classified the same way. Absent when an element is a spread.
    pub elements: Option<Vec<FoldCxArgument>>,
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
    /// End of the specifier, where a sibling can be appended.
    pub end: u32,
    /// The local binding is shadowed somewhere in the module (a nested scope binds its name).
    pub shadowed_anywhere: bool,
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
    /// Every name bound at module scope, including hoisted `var`s and imports.
    pub module_scope_names: Vec<String>,
    /// Value reads of each import binding and each module-scope recipe binding, in source
    /// order. Type positions, declarations, property names and lowercase JSX tags are excluded.
    pub references: Vec<FoldReference>,
    pub runtime_shapes: Vec<FoldRuntimeShape>,
    pub local_exports: Vec<FoldLocalExport>,
    /// Imports of this module that resolve to an inline recipe declared elsewhere.
    pub imported_recipes: Vec<FoldImportedRecipe>,
    /// Other modules whose values reached a call's data.
    pub dependencies: Vec<String>,
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
    /// Every module specifier the declaring module imports, in source order.
    pub declaring_imports: Vec<String>,
    /// The modules a call lowered against this recipe depends on: the import's target, every
    /// module a re-export route crossed, the declaring module and whatever its config read.
    pub dependencies: Vec<String>,
}
