//! Per-module facts for the Vite compiler. See `model.rs`.

pub mod exact;
pub mod model;

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Declaration, Expression, IdentifierReference,
        ImportDeclarationSpecifier, LogicalOperator, ModuleExportName, ObjectPropertyKind,
        PropertyKind, Statement, StaticMemberExpression, TSModuleReference,
    },
};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, Semantic, SemanticBuilder};
use oxc_span::{GetSpan, Span};
use oxc_syntax::symbol::SymbolId;

use crate::cache::SharedCache;
use crate::evaluator::{EvalResult, FileEvaluator, ProjectEvaluator, Refusal};
use crate::offsets::Utf16;
use exact::{Exactness, exact_result, is_inert, is_inert_literal, unwrap};
use model::*;

/// Entrypoints the fold recognises, by kind.
pub struct FoldEntrypoints<'e> {
    pub css: &'e [String],
    pub tokens: &'e [String],
    pub recipes: &'e [String],
    pub patterns: &'e [String],
    pub recipe_names: &'e HashSet<String>,
    pub pattern_names: &'e HashSet<String>,
}

impl FoldEntrypoints<'_> {
    fn kind_of(&self, specifier: &str) -> Option<&'static str> {
        let has = |modules: &[String]| {
            modules
                .iter()
                .any(|module| specifier.contains(module.as_str()))
        };
        if has(self.css) {
            Some("css")
        } else if has(self.tokens) {
            Some("token")
        } else if has(self.recipes) {
            Some("recipe")
        } else if has(self.patterns) {
            Some("pattern")
        } else {
            None
        }
    }

    fn is_bamboo(&self, specifier: &str) -> bool {
        self.kind_of(specifier).is_some()
    }
}

impl Utf16 {
    fn span(&self, span: Span) -> FoldSpan {
        FoldSpan {
            start: self.at(span.start),
            end: self.at(span.end),
        }
    }
}

/// How a local symbol relates to a Bamboo entrypoint.
#[derive(Clone)]
struct BambooBinding {
    kind: &'static str,
    imported: String,
    namespace: bool,
}

fn property_key_name(key: &oxc_ast::ast::PropertyKey<'_>) -> Option<String> {
    key.static_name().map(|name| name.into_owned())
}

fn literal_json(expression: &Expression<'_>) -> Option<serde_json::Value> {
    match unwrap(expression) {
        Expression::StringLiteral(literal) => Some(literal.value.to_string().into()),
        Expression::TemplateLiteral(template) => template
            .single_quasi()
            .map(|value| value.to_string().into()),
        Expression::NumericLiteral(literal) => {
            serde_json::Number::from_f64(literal.value).map(Into::into)
        }
        Expression::BooleanLiteral(literal) => Some(literal.value.into()),
        _ => None,
    }
}

/// Names a nested scope at `node` binds, among `names`, that differ from the module-scope
/// binding — i.e. calling `name` at `node` would reach a local, not the module's import.
fn shadowed_at(
    scoping: &Scoping,
    scope: oxc_syntax::scope::ScopeId,
    names: &[&str],
) -> Vec<String> {
    let root = scoping.root_scope_id();
    names
        .iter()
        .filter(|name| {
            let found = scoping.find_binding(scope, (**name).into());
            let module = scoping.get_binding(root, (**name).into());
            found.is_some() && found != module
        })
        .map(|name| (*name).to_string())
        .collect()
}

fn root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier),
        Expression::StaticMemberExpression(member) => root_identifier(&member.object),
        Expression::ComputedMemberExpression(member) => root_identifier(&member.object),
        Expression::ParenthesizedExpression(value) => root_identifier(&value.expression),
        Expression::ChainExpression(chain) => match &chain.expression {
            oxc_ast::ast::ChainElement::StaticMemberExpression(member) => {
                root_identifier(&member.object)
            }
            oxc_ast::ast::ChainElement::ComputedMemberExpression(member) => {
                root_identifier(&member.object)
            }
            _ => None,
        },
        _ => None,
    }
}

/// `css.raw`, `css.raw?.`, `css['raw']`.
fn is_raw_callee(callee: &Expression<'_>) -> bool {
    match callee {
        Expression::StaticMemberExpression(member) => member.property.name == "raw",
        Expression::ComputedMemberExpression(member) => {
            matches!(&member.expression, Expression::StringLiteral(literal) if literal.value == "raw")
        }
        Expression::ChainExpression(chain) => match &chain.expression {
            oxc_ast::ast::ChainElement::StaticMemberExpression(member) => {
                member.property.name == "raw"
            }
            oxc_ast::ast::ChainElement::ComputedMemberExpression(member) => {
                matches!(&member.expression, Expression::StringLiteral(literal) if literal.value == "raw")
            }
            _ => false,
        },
        Expression::ParenthesizedExpression(value) => is_raw_callee(&value.expression),
        Expression::Identifier(identifier) => identifier.name == "raw",
        _ => false,
    }
}

/// The member path under a callee's root: `ns.token.value` → `["token", "value"]`.
fn callee_members(callee: &Expression<'_>) -> Option<Vec<String>> {
    match callee {
        Expression::Identifier(_) => Some(Vec::new()),
        Expression::StaticMemberExpression(member) => {
            let mut path = callee_members(&member.object)?;
            path.push(member.property.name.to_string());
            Some(path)
        }
        Expression::ComputedMemberExpression(member) => {
            let Expression::StringLiteral(literal) = &member.expression else {
                return None;
            };
            let mut path = callee_members(&member.object)?;
            path.push(literal.value.to_string());
            Some(path)
        }
        Expression::ParenthesizedExpression(value) => callee_members(&value.expression),
        Expression::ChainExpression(chain) => match &chain.expression {
            oxc_ast::ast::ChainElement::StaticMemberExpression(member) => {
                let mut path = callee_members(&member.object)?;
                path.push(member.property.name.to_string());
                Some(path)
            }
            _ => None,
        },
        _ => None,
    }
}

pub(crate) struct ModuleFacts<'a> {
    pub source: &'a str,
    pub semantic: &'a Semantic<'a>,
    pub program: &'a oxc_ast::ast::Program<'a>,
}

/// Module-scope inline recipes: `const badge = cva(...)` bound through an import of the css
/// entrypoint's `cva`/`sva`. Binding → (definition call span, factory, config argument).
fn recipe_definitions<'a>(
    facts: &ModuleFacts<'a>,
    bindings: &HashMap<SymbolId, BambooBinding>,
) -> Vec<(String, &'a oxc_ast::ast::CallExpression<'a>, String)> {
    let scoping = facts.semantic.scoping();
    let mut output = Vec::new();
    for statement in &facts.program.body {
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => declaration,
            Statement::ExportDeclaration(export) => match &export.declaration {
                oxc_ast::ast::Declaration::VariableDeclaration(declaration) => declaration,
                _ => continue,
            },
            _ => continue,
        };
        if declaration.kind != oxc_ast::ast::VariableDeclarationKind::Const {
            continue;
        }
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(id) = &declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(call)) = declarator.init.as_ref().map(unwrap)
            else {
                continue;
            };
            let Expression::Identifier(callee) = &call.callee else {
                continue;
            };
            let Some(symbol) = callee
                .reference_id
                .get()
                .and_then(|reference| scoping.get_reference(reference).symbol_id())
            else {
                continue;
            };
            let Some(binding) = bindings.get(&symbol) else {
                continue;
            };
            if binding.kind != "css"
                || binding.namespace
                || !matches!(binding.imported.as_str(), "cva" | "sva")
            {
                continue;
            }
            output.push((id.name.to_string(), &**call, binding.imported.clone()));
        }
    }
    output
}

/// A module-scope `const` initialised with a style call, which a `cx()` argument naming the
/// binding stands for: `const base = css({ … })`, `const row = hstack({ … })`.
struct StyleDefinition<'a> {
    name: String,
    call: &'a oxc_ast::ast::CallExpression<'a>,
    /// `css` or `pattern`.
    kind: String,
    /// `css`, or the pattern's name.
    callee: String,
}

/// Module-scope style bindings, through an import of the css or patterns entrypoint. Not
/// `css.raw()`, which returns a style object rather than a class.
fn style_definitions<'a>(
    facts: &ModuleFacts<'a>,
    bindings: &HashMap<SymbolId, BambooBinding>,
    entrypoints: &FoldEntrypoints<'_>,
) -> Vec<StyleDefinition<'a>> {
    let scoping = facts.semantic.scoping();
    let mut output = Vec::new();
    for statement in &facts.program.body {
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => declaration,
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(declaration) => declaration,
                _ => continue,
            },
            _ => continue,
        };
        if declaration.kind != oxc_ast::ast::VariableDeclarationKind::Const {
            continue;
        }
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(id) = &declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(call)) = declarator.init.as_ref().map(unwrap)
            else {
                continue;
            };
            if is_raw_callee(&call.callee) {
                continue;
            }
            let Some((kind, callee, property)) =
                classify_callee(&call.callee, scoping, bindings, entrypoints)
            else {
                continue;
            };
            if property.is_some() || !((kind == "css" && callee == "css") || kind == "pattern") {
                continue;
            }
            output.push(StyleDefinition {
                name: id.name.to_string(),
                call,
                kind,
                callee,
            });
        }
    }
    output
}

fn collect_bamboo_bindings(
    program: &oxc_ast::ast::Program<'_>,
    entrypoints: &FoldEntrypoints<'_>,
) -> HashMap<SymbolId, BambooBinding> {
    let mut bindings = HashMap::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.import_kind.is_type() {
            continue;
        }
        let module = declaration.source.value.as_str();
        let Some(kind) = entrypoints.kind_of(module) else {
            continue;
        };
        for specifier in declaration.specifiers.iter().flatten() {
            match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                    if named.import_kind.is_type() {
                        continue;
                    }
                    if let Some(symbol) = named.local.symbol_id.get() {
                        bindings.insert(
                            symbol,
                            BambooBinding {
                                kind,
                                imported: named.imported.name().to_string(),
                                namespace: false,
                            },
                        );
                    }
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                    if let Some(symbol) = namespace.local.symbol_id.get() {
                        bindings.insert(
                            symbol,
                            BambooBinding {
                                kind,
                                imported: String::new(),
                                namespace: true,
                            },
                        );
                    }
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => {}
            }
        }
    }
    bindings
}

fn classify_callee(
    callee: &Expression<'_>,
    scoping: &Scoping,
    bindings: &HashMap<SymbolId, BambooBinding>,
    entrypoints: &FoldEntrypoints<'_>,
) -> Option<(String, String, Option<String>)> {
    // (kind, name, callee_property)
    let root = root_identifier(callee)?;
    let symbol = root
        .reference_id
        .get()
        .and_then(|reference| scoping.get_reference(reference).symbol_id())?;
    let members = callee_members(callee).unwrap_or_default();
    classify_binding(symbol, &members, bindings, entrypoints)
}

/// A call of `symbol`, through `members`, classified by what the binding imports.
fn classify_binding(
    symbol: SymbolId,
    members: &[String],
    bindings: &HashMap<SymbolId, BambooBinding>,
    entrypoints: &FoldEntrypoints<'_>,
) -> Option<(String, String, Option<String>)> {
    let binding = bindings.get(&symbol)?;
    let (imported, rest): (String, &[String]) = if binding.namespace {
        let first = members.first()?.clone();
        (first, &members[1..])
    } else {
        (binding.imported.clone(), members)
    };
    let property = rest.first().cloned();
    let kind = match binding.kind {
        "css" => match imported.as_str() {
            "css" | "cva" | "sva" | "cx" | "viewTransition" | "keyframes" => imported.clone(),
            _ => return None,
        },
        "token" => {
            if imported != "token" {
                return None;
            }
            if property.as_deref() == Some("value") {
                "tokenValue".to_string()
            } else {
                "token".to_string()
            }
        }
        "recipe" => {
            if !entrypoints.recipe_names.contains(&imported) {
                return None;
            }
            "recipe".to_string()
        }
        "pattern" => {
            if !entrypoints.pattern_names.contains(&imported) {
                return None;
            }
            "pattern".to_string()
        }
        _ => return None,
    };
    Some((kind, imported, property))
}

/// A callee whose root is named like a Bamboo binding but does not resolve to one here: a
/// parameter or local shadowing the import, or an unrelated module's export of the same name.
fn not_imported_call(
    callee: &Expression<'_>,
    scoping: &Scoping,
    bindings: &HashMap<SymbolId, BambooBinding>,
    module_names: &HashMap<String, BambooBinding>,
    foreign_names: &HashSet<String>,
    entrypoints: &FoldEntrypoints<'_>,
) -> Option<(String, String)> {
    let root = root_identifier(callee)?;
    let name = root.name.as_str();
    let resolved = root
        .reference_id
        .get()
        .and_then(|reference| scoping.get_reference(reference).symbol_id());
    if resolved.is_some_and(|symbol| bindings.contains_key(&symbol)) {
        return None;
    }
    if let Some(binding) = module_names.get(name) {
        let members = callee_members(callee).unwrap_or_default();
        let kind = match (binding.kind, binding.imported.as_str()) {
            ("token", _) if members.first().is_some_and(|m| m == "value") => "tokenValue",
            ("token", _) => "token",
            ("css", other) => match other {
                "css" | "viewTransition" | "keyframes" => other,
                _ => return None,
            },
            ("pattern", _) => "pattern",
            ("recipe", _) => "recipe",
            _ => return None,
        };
        return Some((kind.to_string(), binding.imported.clone()));
    }
    // Somebody else's function spelled like one of ours: an import from another module, or —
    // for the two names a project most often defines itself — a local declaration.
    let api_kind = match name {
        "token" => Some("token"),
        "css" | "viewTransition" => Some("css"),
        _ if entrypoints.recipe_names.contains(name) => Some("recipe"),
        _ if entrypoints.pattern_names.contains(name) => Some("pattern"),
        _ => None,
    }?;
    let local_definition = matches!(name, "css" | "token") && resolved.is_some();
    if foreign_names.contains(name) || local_definition {
        return Some((api_kind.to_string(), name.to_string()));
    }
    None
}

/// How Vue's compiled templates reach a `<script setup>` import, read as the binding it is.
///
/// A template calls `css` through `unref(css)(…)` when it is inlined into `setup()`, which
/// production builds do, and through `$setup.css(…)` when it is compiled into a render function
/// of its own, which the dev server does. Neither names `css` as the callee, so neither call was
/// compiled: the first failed the build as a read of the binding, the second threw when rendered.
struct VueTemplate {
    /// Local names of `unref` imported from `vue`.
    unref: HashSet<SymbolId>,
    /// What `setup()` exposes to a separately compiled template, by name.
    exposed: HashMap<String, SymbolId>,
    exposures: Vec<FoldVueExposure>,
}

impl VueTemplate {
    fn new(facts: &ModuleFacts<'_>, utf16: &Utf16, watched: &dyn Fn(SymbolId) -> bool) -> Self {
        let semantic = facts.semantic;
        let scoping = semantic.scoping();
        let resolve = |identifier: &IdentifierReference<'_>| {
            identifier
                .reference_id
                .get()
                .and_then(|reference| scoping.get_reference(reference).symbol_id())
        };

        let mut unref = HashSet::new();
        let mut compiled_by_vue = false;
        for statement in &facts.program.body {
            let Statement::ImportDeclaration(declaration) = statement else {
                continue;
            };
            if declaration.source.value != "vue" {
                continue;
            }
            compiled_by_vue = true;
            for specifier in declaration.specifiers.iter().flatten() {
                if let ImportDeclarationSpecifier::ImportSpecifier(named) = specifier
                    && named.imported.name() == "unref"
                    && let Some(symbol) = named.local.symbol_id.get()
                {
                    unref.insert(symbol);
                }
            }
        }

        // A module Vue compiled imports its runtime from `vue`; every other module stops here,
        // before walking its nodes for what only Vue writes.
        let mut exposed = HashMap::new();
        let mut exposures = Vec::new();
        if !compiled_by_vue {
            return Self {
                unref,
                exposed,
                exposures,
            };
        }
        // `const __returned__ = { get css() { return css } }`, or `{ css }` from an older Vue.
        for node in semantic.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                continue;
            };
            if declarator
                .id
                .get_binding_identifier()
                .is_none_or(|id| id.name != "__returned__")
            {
                continue;
            }
            let Some(Expression::ObjectExpression(object)) = declarator.init.as_ref().map(unwrap)
            else {
                continue;
            };
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    continue;
                };
                if property.computed {
                    continue;
                }
                let Some(name) = property.key.static_name() else {
                    continue;
                };
                let (read, span, replacement) = match (property.kind, unwrap(&property.value)) {
                    (PropertyKind::Get, Expression::FunctionExpression(getter)) => {
                        let Some(body) = &getter.body else {
                            continue;
                        };
                        let [Statement::ReturnStatement(statement)] = body.statements.as_slice()
                        else {
                            continue;
                        };
                        let Some(Expression::Identifier(read)) =
                            statement.argument.as_ref().map(unwrap)
                        else {
                            continue;
                        };
                        (&**read, read.span, "undefined".to_string())
                    }
                    (PropertyKind::Init, Expression::Identifier(read)) if property.shorthand => {
                        (&**read, property.span, format!("{name}: undefined"))
                    }
                    (PropertyKind::Init, Expression::Identifier(read)) => {
                        (&**read, read.span, "undefined".to_string())
                    }
                    _ => continue,
                };
                let Some(symbol) = resolve(read) else {
                    continue;
                };
                if !watched(symbol) {
                    continue;
                }
                exposed.insert(name.to_string(), symbol);
                exposures.push(FoldVueExposure {
                    name: name.to_string(),
                    span: utf16.span(span),
                    replacement,
                    reads: Vec::new(),
                });
            }
        }
        if !exposures.is_empty() {
            for node in semantic.nodes().iter() {
                let AstKind::StaticMemberExpression(member) = node.kind() else {
                    continue;
                };
                let Some(name) = setup_read(member, semantic) else {
                    continue;
                };
                if let Some(exposure) = exposures.iter_mut().find(|exposure| exposure.name == name)
                {
                    exposure.reads.push(utf16.span(member.span));
                }
            }
        }
        Self {
            unref,
            exposed,
            exposures,
        }
    }

    /// The binding, and the member path under it, that a callee written either of Vue's two
    /// ways stands for.
    fn callee(
        &self,
        callee: &Expression<'_>,
        semantic: &Semantic<'_>,
    ) -> Option<(SymbolId, Vec<String>)> {
        let scoping = semantic.scoping();
        match unwrap(callee) {
            Expression::StaticMemberExpression(member) => {
                if let Some(name) = setup_read(member, semantic) {
                    return self.exposed.get(name).map(|symbol| (*symbol, Vec::new()));
                }
                let (symbol, mut members) = self.callee(&member.object, semantic)?;
                members.push(member.property.name.to_string());
                Some((symbol, members))
            }
            Expression::CallExpression(call) if call.arguments.len() == 1 => {
                let Expression::Identifier(function) = unwrap(&call.callee) else {
                    return None;
                };
                let function = function
                    .reference_id
                    .get()
                    .and_then(|reference| scoping.get_reference(reference).symbol_id())?;
                if !self.unref.contains(&function) {
                    return None;
                }
                let argument = call.arguments[0].as_expression()?;
                let symbol = root_identifier(argument)?
                    .reference_id
                    .get()
                    .and_then(|reference| scoping.get_reference(reference).symbol_id())?;
                Some((symbol, callee_members(argument)?))
            }
            _ => None,
        }
    }
}

/// The name a render function reads off its `$setup` parameter: `$setup.css` gives `css`.
fn setup_read<'a>(
    member: &'a StaticMemberExpression<'a>,
    semantic: &Semantic<'_>,
) -> Option<&'a str> {
    let Expression::Identifier(object) = unwrap(&member.object) else {
        return None;
    };
    if object.name != "$setup" {
        return None;
    }
    let symbol = object
        .reference_id
        .get()
        .and_then(|reference| semantic.scoping().get_reference(reference).symbol_id())?;
    matches!(
        semantic.symbol_declaration(symbol).kind(),
        AstKind::FormalParameter(_)
    )
    .then(|| member.property.name.as_str())
}

pub(crate) fn analyze_module(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    source: &str,
    entrypoints: &FoldEntrypoints<'_>,
    capture_references: bool,
) -> FoldAnalysis {
    let allocator = Allocator::default();
    let source_type = crate::evaluator::source_type_for(filename);
    let parsed = Parser::new(&allocator, source, source_type).parse();
    let errors: Vec<String> = parsed.diagnostics.iter().map(ToString::to_string).collect();
    if parsed.panicked {
        return empty_analysis(errors);
    }
    // Scope diagnostics are the type checker's business; see `analyze_source`.
    let semantic = SemanticBuilder::new_compiler()
        .with_build_nodes(true)
        .build(&parsed.program)
        .semantic;
    let facts = ModuleFacts {
        source,
        semantic: &semantic,
        program: &parsed.program,
    };
    project.begin_file(filename);
    let analysis = analyze_facts(
        project,
        filename,
        &facts,
        entrypoints,
        capture_references,
        errors,
    );
    let reads = project.end_file(filename);
    FoldAnalysis {
        dependencies: reads.dependencies,
        ..analysis
    }
}

fn empty_analysis(errors: Vec<String>) -> FoldAnalysis {
    FoldAnalysis {
        calls: Vec::new(),
        split_calls: Vec::new(),
        imports: Vec::new(),
        module_scope_names: Vec::new(),
        references: Vec::new(),
        runtime_shapes: Vec::new(),
        local_exports: Vec::new(),
        imported_recipes: Vec::new(),
        imported_styles: Vec::new(),
        dependencies: Vec::new(),
        vue_exposures: Vec::new(),
        errors,
    }
}

fn analyze_facts<'a>(
    project: &ProjectEvaluator<'_>,
    filename: &'a str,
    facts: &ModuleFacts<'a>,
    entrypoints: &FoldEntrypoints<'_>,
    capture_references: bool,
    errors: Vec<String>,
) -> FoldAnalysis {
    let semantic = facts.semantic;
    let scoping = semantic.scoping();
    let utf16 = Utf16::new(facts.source);
    let bindings = collect_bamboo_bindings(facts.program, entrypoints);
    let mut evaluator = FileEvaluator::new(filename, project, semantic, facts.program);

    // Imports of the module, for helper insertion, survivor watching and foreign-name checks.
    let mut imports = Vec::new();
    let mut module_names: HashMap<String, BambooBinding> = HashMap::new();
    let mut foreign_names = HashSet::new();
    let mut import_symbols: Vec<(SymbolId, String)> = Vec::new();
    for statement in &facts.program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        let module = declaration.source.value.to_string();
        let is_bamboo = entrypoints.is_bamboo(&module);
        let mut specifiers = Vec::new();
        let mut default_local = None;
        let mut namespace_local = None;
        for specifier in declaration.specifiers.iter().flatten() {
            match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                    let local = named.local.name.to_string();
                    let symbol = named.local.symbol_id.get();
                    let shadowed = symbol.is_some_and(|symbol| {
                        scoping.iter_bindings().any(|(scope, table)| {
                            scope != scoping.root_scope_id()
                                && table
                                    .get(local.as_str())
                                    .is_some_and(|other| *other != symbol)
                        })
                    });
                    specifiers.push(FoldImportSpecifier {
                        imported: named.imported.name().to_string(),
                        local: local.clone(),
                        type_only: named.import_kind.is_type(),
                        end: utf16.at(named.span.end),
                        shadowed_anywhere: shadowed,
                    });
                    if let Some(symbol) = symbol
                        && !declaration.import_kind.is_type()
                        && !named.import_kind.is_type()
                    {
                        import_symbols.push((symbol, local.clone()));
                        if is_bamboo && let Some(kind) = entrypoints.kind_of(&module) {
                            module_names.insert(
                                local.clone(),
                                BambooBinding {
                                    kind,
                                    imported: named.imported.name().to_string(),
                                    namespace: false,
                                },
                            );
                        } else if !is_bamboo {
                            foreign_names.insert(local.clone());
                        }
                    }
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                    default_local = Some(default.local.name.to_string());
                    if let Some(symbol) = default.local.symbol_id.get()
                        && !declaration.import_kind.is_type()
                    {
                        import_symbols.push((symbol, default.local.name.to_string()));
                    }
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                    namespace_local = Some(namespace.local.name.to_string());
                    if let Some(symbol) = namespace.local.symbol_id.get()
                        && !declaration.import_kind.is_type()
                    {
                        import_symbols.push((symbol, namespace.local.name.to_string()));
                    }
                }
            }
        }
        imports.push(FoldImport {
            span: utf16.span(declaration.span),
            module,
            type_only: declaration.import_kind.is_type(),
            specifiers,
            default_local,
            namespace_local,
        });
    }

    let definitions = recipe_definitions(facts, &bindings);
    let definition_names: HashSet<String> = definitions
        .iter()
        .map(|(name, _, _)| name.clone())
        .collect();
    let definition_symbols: HashMap<SymbolId, String> = definitions
        .iter()
        .filter_map(|(name, _, _)| {
            scoping
                .get_binding(scoping.root_scope_id(), name.as_str().into())
                .map(|symbol| (symbol, name.clone()))
        })
        .collect();

    // Imports that resolve to an inline recipe, or to a style binding, declared in another module.
    let (imported_recipes, imported_styles) =
        imported_recipe_bindings(project, filename, facts.program, entrypoints);
    let imported_recipe_symbols: HashMap<SymbolId, usize> = imported_recipes
        .iter()
        .enumerate()
        .filter_map(|(index, recipe)| {
            scoping
                .get_binding(scoping.root_scope_id(), recipe.local.as_str().into())
                .map(|symbol| (symbol, index))
        })
        .collect();

    // What a `cx()` argument naming a binding can stand for: a style call bound at module scope
    // here, by the call, or in a module this one imports it from, by its local name.
    let style_symbols: HashMap<SymbolId, FoldSpan> =
        style_definitions(facts, &bindings, entrypoints)
            .iter()
            .filter_map(|definition| {
                scoping
                    .get_binding(scoping.root_scope_id(), definition.name.as_str().into())
                    .map(|symbol| (symbol, utf16.span(definition.call.span)))
            })
            .collect();
    let imported_style_symbols: HashMap<SymbolId, String> = imported_styles
        .iter()
        .filter_map(|style| {
            scoping
                .get_binding(scoping.root_scope_id(), style.local.as_str().into())
                .map(|symbol| (symbol, style.local.clone()))
        })
        .collect();
    // Reads a `cx()` condition may not hold, by byte span, sorted. The fold copies a condition
    // into what it writes, so one reading a Bamboo import would keep the import alive, and one
    // reading a recipe would read the `undefined` the recipe's declaration is erased to.
    let mut guarded_reads: Option<Vec<Span>> = None;
    // Of `imported_styles`, those a `cx()` argument names: the only ones the fold reads.
    let mut cx_imported_styles: HashSet<String> = HashSet::new();

    let helper_names: Vec<&str> = ["cvaMap", "splitProps"]
        .into_iter()
        .chain(imports.iter().flat_map(|import| {
            import
                .specifiers
                .iter()
                .filter(|specifier| matches!(specifier.imported.as_str(), "cvaMap" | "splitProps"))
                .map(|specifier| specifier.local.as_str())
        }))
        .collect();

    let vue = VueTemplate::new(facts, &utf16, &|symbol| {
        bindings.contains_key(&symbol) || imported_recipe_symbols.contains_key(&symbol)
    });

    let mut calls = Vec::new();
    let mut split_calls = Vec::new();

    for node in semantic.nodes().iter() {
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        let call_span = utf16.span(call.span);

        // `x.splitVariantProps(arg)` on a recipe binding.
        if let Expression::StaticMemberExpression(member) = &call.callee
            && member.property.name == "splitVariantProps"
            && let Expression::Identifier(target) = &member.object
            && call.arguments.len() == 1
            && let Some(argument) = call.arguments[0].as_expression()
        {
            let symbol = target
                .reference_id
                .get()
                .and_then(|reference| scoping.get_reference(reference).symbol_id());
            let local = symbol.is_some_and(|symbol| {
                definition_symbols.contains_key(&symbol)
                    || imported_recipe_symbols.contains_key(&symbol)
            });
            let imported = symbol
                .and_then(|symbol| bindings.get(&symbol))
                .is_some_and(|binding| {
                    binding.kind == "recipe"
                        && !binding.namespace
                        && entrypoints.recipe_names.contains(&binding.imported)
                });
            if local || imported {
                split_calls.push(FoldSplitCall {
                    span: call_span,
                    binding: target.name.to_string(),
                    shadowed_helpers: shadowed_at(scoping, node.scope_id(), &helper_names),
                    imported: imported && !local,
                    argument_text: argument.span().source_text(facts.source).to_string(),
                });
            }
            continue;
        }

        // `unref(css)(…)` and `$setup.css(…)`: a call of `css`, spelled the way a compiled Vue
        // template spells it.
        let vue_target = vue.callee(&call.callee, semantic);

        // A recipe invocation of a local or imported inline recipe: `badge(...)`, and the
        // `badge.raw(...)` spelling of the same binding, which is reported rather than folded.
        let callee_root = match unwrap(&call.callee) {
            _ if vue_target.is_some() => None,
            Expression::Identifier(identifier) => Some(&**identifier),
            _ if is_raw_callee(&call.callee) => root_identifier(&call.callee),
            _ => None,
        };
        let recipe_symbol = match &vue_target {
            Some((symbol, members)) => (members.is_empty()
                || members.iter().map(String::as_str).eq(["raw"]))
            .then_some(*symbol),
            None => callee_root.and_then(|root| {
                root.reference_id
                    .get()
                    .and_then(|reference| scoping.get_reference(reference).symbol_id())
            }),
        };
        {
            let recipe_name = recipe_symbol.and_then(|symbol| {
                definition_symbols
                    .get(&symbol)
                    .cloned()
                    .map(|name| (name, None))
                    .or_else(|| {
                        imported_recipe_symbols.get(&symbol).map(|index| {
                            let recipe = &imported_recipes[*index];
                            (
                                recipe.local.clone(),
                                Some(FoldOrigin {
                                    file_path: recipe.file_path.clone(),
                                    name: recipe.name.clone(),
                                }),
                            )
                        })
                    })
            });
            if let Some((name, origin)) = recipe_name {
                calls.push(recipe_invocation(
                    &mut evaluator,
                    facts,
                    &utf16,
                    call,
                    node.id(),
                    name,
                    origin,
                    shadowed_at(scoping, node.scope_id(), &helper_names),
                    false,
                ));
                continue;
            }
            // A call of a name a module-scope recipe owns, reached through a nested binding:
            // somebody else's function, not the recipe.
            if let Some(root) = callee_root
                && (definition_names.contains(root.name.as_str())
                    || imported_recipes
                        .iter()
                        .any(|recipe| recipe.local == root.name.as_str()))
            {
                continue;
            }
        }

        let classified = match &vue_target {
            Some((symbol, members)) => classify_binding(*symbol, members, &bindings, entrypoints),
            None => classify_callee(&call.callee, scoping, &bindings, entrypoints),
        };
        let raw = match &vue_target {
            Some((_, members)) => members.last().is_some_and(|member| member == "raw"),
            None => is_raw_callee(&call.callee),
        };
        let Some((kind, name, property)) = classified else {
            if vue_target.is_none()
                && let Some((kind, name)) = not_imported_call(
                    &call.callee,
                    scoping,
                    &bindings,
                    &module_names,
                    &foreign_names,
                    entrypoints,
                )
            {
                calls.push(FoldCall {
                    name,
                    kind,
                    span: call_span,
                    slot: None,
                    slot_end: None,
                    shadowed_helpers: Vec::new(),
                    raw: is_raw_callee(&call.callee),
                    not_imported: true,
                    callee_property: None,
                    data: Vec::new(),
                    exact: false,
                    refusal: None,
                    argument_count: call.arguments.len() as u32,
                    trailing_arguments_inert: true,
                    selection: None,
                    origin: None,
                    binding: None,
                    cx_arguments: Vec::new(),
                    value: None,
                    guarded: false,
                    statement_start: false,
                });
            }
            continue;
        };

        // Recipe *definitions* bound at module scope are erased; others are reported like
        // any other non-foldable call.
        if kind == "cva" || kind == "sva" {
            let binding = definitions
                .iter()
                .find(|(_, definition, _)| definition.span == call.span)
                .map(|(name, _, _)| name.clone());
            let (data, _, _) = argument_values(&mut evaluator, call);
            calls.push(FoldCall {
                name,
                kind,
                span: call_span,
                slot: None,
                slot_end: None,
                shadowed_helpers: Vec::new(),
                raw: false,
                not_imported: false,
                callee_property: None,
                data,
                exact: true,
                refusal: None,
                argument_count: call.arguments.len() as u32,
                trailing_arguments_inert: true,
                selection: None,
                origin: None,
                binding,
                cx_arguments: Vec::new(),
                value: None,
                guarded: false,
                statement_start: false,
            });
            continue;
        }

        if kind == "cx" {
            let guarded_reads = guarded_reads.get_or_insert_with(|| {
                let mut reads: Vec<Span> = bindings
                    .keys()
                    .chain(definition_symbols.keys())
                    .chain(imported_recipe_symbols.keys())
                    .flat_map(|symbol| scoping.get_resolved_references(*symbol))
                    .map(|reference| semantic.nodes().get_node(reference.node_id()).kind().span())
                    .collect();
                reads.sort_unstable_by_key(|span| span.start);
                reads
            });
            let scope = CxScope {
                utf16: &utf16,
                scoping,
                styles: &style_symbols,
                imported_styles: &imported_style_symbols,
                guarded_reads,
            };
            let cx_arguments: Vec<FoldCxArgument> = call
                .arguments
                .iter()
                .map(|argument| cx_argument(argument, &scope))
                .collect();
            named_styles(&cx_arguments, &mut cx_imported_styles);
            calls.push(FoldCall {
                name,
                kind,
                span: call_span,
                slot: None,
                slot_end: None,
                shadowed_helpers: Vec::new(),
                raw: false,
                not_imported: false,
                callee_property: None,
                data: Vec::new(),
                exact: false,
                refusal: None,
                argument_count: call.arguments.len() as u32,
                trailing_arguments_inert: true,
                selection: None,
                origin: None,
                binding: None,
                cx_arguments,
                value: None,
                guarded: false,
                statement_start: is_statement_start(semantic, node.id()),
            });
            continue;
        }

        if kind == "recipe" {
            calls.push(recipe_invocation(
                &mut evaluator,
                facts,
                &utf16,
                call,
                node.id(),
                name,
                None,
                shadowed_at(scoping, node.scope_id(), &helper_names),
                true,
            ));
            continue;
        }

        let (data, _, refusal) = argument_values(&mut evaluator, call);
        // A token's path is its first argument; whatever follows is discarded once it resolves,
        // and is judged by `trailing_arguments_inert` rather than by what it evaluates to.
        let judged = if kind == "token" || kind == "tokenValue" {
            1
        } else {
            call.arguments.len()
        };
        let exact =
            call.arguments
                .iter()
                .take(judged)
                .all(|argument| match argument.as_expression() {
                    Some(expression) => Exactness {
                        evaluator: &mut evaluator,
                        // With more than one argument it does not: `css()` drops an argument
                        // whose values are all `undefined` before merging, and keeps one holding
                        // `null`, which then overrides what came before. `keyframes()` is named
                        // for, and written from, its stops without them.
                        drops_nullish: (kind == "css" || kind == "keyframes")
                            && call.arguments.len() == 1,
                    }
                    .check(expression),
                    None => false,
                });
        let trailing_arguments_inert = call
            .arguments
            .iter()
            .skip(1)
            .all(|argument| argument.as_expression().is_some_and(is_inert_literal));
        let (slot, slot_end) = slot_access(semantic, node.id(), &utf16);
        // The name an exact `keyframes()` returns, which replaces the call.
        let value = (kind == "keyframes" && exact && data.len() == 1)
            .then(|| data.first())
            .flatten()
            .filter(|stops| stops.is_object())
            .map(|stops| project.keyframes_name(stops));
        let guarded = (kind == "token" || kind == "tokenValue")
            && crate::result_guarded(semantic.nodes(), node.id());
        let statement_start = kind == "tokenValue" && is_statement_start(semantic, node.id());
        calls.push(FoldCall {
            name,
            kind,
            span: call_span,
            slot,
            slot_end,
            shadowed_helpers: Vec::new(),
            raw,
            not_imported: false,
            callee_property: property,
            data,
            exact,
            refusal: refusal
                .filter(|_| !exact)
                .map(|refusal| fold_refusal(&refusal)),
            argument_count: call.arguments.len() as u32,
            trailing_arguments_inert,
            selection: None,
            origin: None,
            binding: None,
            cx_arguments: Vec::new(),
            value,
            guarded,
            statement_start,
        });
    }

    let module_scope_names = module_scope_names(scoping);
    let mut references = Vec::new();
    let mut runtime_shapes = Vec::new();
    let mut local_exports = Vec::new();
    if capture_references {
        // Value reads of every import binding and every module-scope recipe binding.
        let mut watched: Vec<(SymbolId, String)> = import_symbols.clone();
        for (symbol, name) in &definition_symbols {
            watched.push((*symbol, name.clone()));
        }
        for (symbol, name) in watched {
            for reference in scoping.get_resolved_references(symbol) {
                let flags = reference.flags();
                if !flags.is_value() || flags.is_value_as_type() {
                    continue;
                }
                let node = semantic.nodes().get_node(reference.node_id());
                let span = node.kind().span();
                // A value reference inside a type query (`typeof badge`) is erased.
                if semantic
                    .nodes()
                    .ancestor_kinds(node.id())
                    .any(|kind| matches!(kind, AstKind::TSTypeQuery(_)))
                {
                    continue;
                }
                references.push(FoldReference {
                    name: name.clone(),
                    span: utf16.span(span),
                });
            }
        }
        // `<Button />` reads its binding; Oxc resolves a JSX tag as a reference too, and a
        // lowercase tag is an intrinsic element that never resolves to a binding.
        references.sort_by_key(|reference| (reference.span.start, reference.span.end));
        references.dedup_by(|a, b| a.span.start == b.span.start && a.span.end == b.span.end);

        for node in semantic.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call) => {
                    let is_require = matches!(&call.callee, Expression::Identifier(id) if id.name == "require")
                        && scoping
                            .find_binding(node.scope_id(), "require".into())
                            .is_none();
                    if !is_require {
                        continue;
                    }
                    let Some(module) = call
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .and_then(literal_string)
                    else {
                        continue;
                    };
                    runtime_shapes.push(FoldRuntimeShape {
                        kind: "require".into(),
                        name: "require".into(),
                        module,
                        span: utf16.span(call.span),
                    });
                }
                AstKind::ImportExpression(expression) => {
                    let Some(module) = literal_string(&expression.source) else {
                        continue;
                    };
                    runtime_shapes.push(FoldRuntimeShape {
                        kind: "import".into(),
                        name: "import".into(),
                        module,
                        span: utf16.span(expression.span),
                    });
                }
                AstKind::TSImportEqualsDeclaration(declaration) => {
                    if declaration.import_kind.is_type() {
                        continue;
                    }
                    let TSModuleReference::ExternalModuleReference(reference) =
                        &declaration.module_reference
                    else {
                        continue;
                    };
                    runtime_shapes.push(FoldRuntimeShape {
                        kind: "import-equals".into(),
                        name: declaration.id.name.to_string(),
                        module: reference.expression.value.to_string(),
                        span: utf16.span(declaration.span),
                    });
                }
                _ => {}
            }
        }
        for statement in &facts.program.body {
            match statement {
                Statement::ExportAllDeclaration(export) => {
                    if export.export_kind.is_type() {
                        continue;
                    }
                    runtime_shapes.push(FoldRuntimeShape {
                        kind: "export-star".into(),
                        name: export
                            .exported
                            .as_ref()
                            .map_or_else(|| "*".to_string(), |name| name.name().to_string()),
                        module: export.source.value.to_string(),
                        span: utf16.span(export.span),
                    });
                }
                Statement::ExportFromDeclaration(export) => {
                    if export.export_kind.is_type() {
                        continue;
                    }
                    for specifier in &export.specifiers {
                        if specifier.export_kind.is_type() {
                            continue;
                        }
                        runtime_shapes.push(FoldRuntimeShape {
                            kind: "export-from".into(),
                            name: module_export_name(&specifier.local),
                            module: export.source.value.to_string(),
                            span: utf16.span(specifier.span),
                        });
                    }
                }
                Statement::ExportNamedDeclaration(export) => {
                    if export.export_kind.is_type() {
                        continue;
                    }
                    for specifier in &export.specifiers {
                        if specifier.export_kind.is_type() {
                            continue;
                        }
                        local_exports.push(FoldLocalExport {
                            local: module_export_name(&specifier.local),
                            span: utf16.span(specifier.span),
                        });
                    }
                }
                _ => {}
            }
        }
    }

    // Order matters to the compiler's ledger: source order, outermost first.
    calls.sort_by_key(|call| (call.span.start, std::cmp::Reverse(call.span.end)));

    FoldAnalysis {
        calls,
        split_calls,
        imports,
        module_scope_names,
        references,
        runtime_shapes,
        local_exports,
        vue_exposures: vue.exposures,
        imported_recipes: imported_recipes
            .into_iter()
            .map(|recipe| FoldImportedRecipe {
                local: recipe.local,
                file_path: recipe.file_path,
                name: recipe.name,
                config: recipe.config,
                declaring_imports: recipe.declaring_imports,
                dependencies: recipe.dependencies,
            })
            .collect(),
        imported_styles: imported_styles
            .into_iter()
            .filter(|style| cx_imported_styles.contains(&style.local))
            .map(|style| FoldImportedStyle {
                local: style.local,
                file_path: style.file_path,
                name: style.name,
                kind: style.style.kind.clone(),
                callee: style.style.callee.clone(),
                data: style.style.data.clone(),
                dependencies: style.dependencies,
            })
            .collect(),
        dependencies: Vec::new(),
        errors,
    }
}

fn module_export_name(name: &ModuleExportName<'_>) -> String {
    name.name().to_string()
}

fn literal_string(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) => {
            template.single_quasi().map(|value| value.to_string())
        }
        _ => None,
    }
}

fn argument_values<'a>(
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    call: &'a oxc_ast::ast::CallExpression<'a>,
) -> (Vec<serde_json::Value>, bool, Option<Arc<Refusal>>) {
    let mut output = Vec::new();
    let mut complete = true;
    let mut refusal = None;
    for argument in &call.arguments {
        let result = argument
            .as_expression()
            .map_or_else(EvalResult::unknown, |expression| {
                evaluator.evaluate(expression)
            });
        complete &= result.complete;
        refusal = refusal.or_else(|| result.refusal.clone());
        let mut data = result.data();
        if data.is_empty() {
            data.push(serde_json::Value::Object(serde_json::Map::new()));
        }
        output.extend(data);
    }
    if call.arguments.is_empty() {
        output.push(serde_json::Value::Object(serde_json::Map::new()));
    }
    (output, complete, refusal)
}

/// What the evaluator refused, as the record JavaScript reads.
fn fold_refusal(refusal: &Refusal) -> FoldRefusal {
    FoldRefusal {
        kind: refusal.kind.to_string(),
        subject: refusal.subject.clone(),
        helper: refusal.helper.clone(),
        excerpt: refusal.excerpt.clone(),
        file_path: refusal.file_path.clone(),
        line: refusal.line,
        column: refusal.column,
    }
}

/// Whether `call` is the first thing an expression statement holds,
/// `token.value('zIndex.hide').toFixed()` written as one. An arrow's expression body is not a
/// statement here, and follows its `=>`.
fn is_statement_start(semantic: &Semantic<'_>, call: oxc_semantic::NodeId) -> bool {
    let nodes = semantic.nodes();
    let start = nodes.kind(call).span().start;
    let mut current = call;
    loop {
        let parent = nodes.parent_id(current);
        if parent == current {
            return false;
        }
        match nodes.kind(parent) {
            AstKind::ExpressionStatement(_) => return true,
            kind if kind.span().start == start => current = parent,
            _ => return false,
        }
    }
}

/// `call(...).slot` or `call(...)['slot']` directly around the call.
fn slot_access(
    semantic: &Semantic<'_>,
    call: oxc_semantic::NodeId,
    utf16: &Utf16,
) -> (Option<String>, Option<u32>) {
    match semantic.nodes().parent_kind(call) {
        AstKind::StaticMemberExpression(member) => (
            Some(member.property.name.to_string()),
            Some(utf16.at(member.span.end)),
        ),
        AstKind::ComputedMemberExpression(member) => match &member.expression {
            Expression::StringLiteral(literal) => (
                Some(literal.value.to_string()),
                Some(utf16.at(member.span.end)),
            ),
            Expression::TemplateLiteral(template) => match template.single_quasi() {
                Some(value) => (Some(value.to_string()), Some(utf16.at(member.span.end))),
                None => (None, None),
            },
            _ => (None, None),
        },
        _ => (None, None),
    }
}

#[allow(clippy::too_many_arguments)]
fn recipe_invocation<'a>(
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    facts: &ModuleFacts<'a>,
    utf16: &Utf16,
    call: &'a oxc_ast::ast::CallExpression<'a>,
    node: oxc_semantic::NodeId,
    name: String,
    origin: Option<FoldOrigin>,
    shadowed_helpers: Vec<String>,
    config_recipe: bool,
) -> FoldCall {
    let (data, _, _) = argument_values(evaluator, call);
    let selection = match call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(unwrap)
    {
        None if call.arguments.is_empty() => Some(FoldSelection {
            identifier: None,
            properties: Some(Vec::new()),
            unenumerable: false,
        }),
        Some(Expression::Identifier(identifier)) => Some(FoldSelection {
            identifier: Some(identifier.name.to_string()),
            properties: None,
            unenumerable: false,
        }),
        Some(Expression::ObjectExpression(object)) => {
            let mut properties = Vec::new();
            let mut unenumerable = false;
            for property in &object.properties {
                match property {
                    ObjectPropertyKind::SpreadProperty(_) => unenumerable = true,
                    ObjectPropertyKind::ObjectProperty(property) => {
                        if property.computed
                            || property.method
                            || property.kind != PropertyKind::Init
                        {
                            unenumerable = true;
                            continue;
                        }
                        let Some(key) = property_key_name(&property.key) else {
                            unenumerable = true;
                            continue;
                        };
                        let value = &property.value;
                        let result = evaluator.evaluate(value);
                        let exact = exact_result(&result)
                            && Exactness {
                                evaluator: &mut *evaluator,
                                drops_nullish: false,
                            }
                            .check(value);
                        // Written as an object or an array, or known to be one: a value no
                        // variant is named, whatever its parts are.
                        let structured = matches!(
                            unwrap(value),
                            Expression::ObjectExpression(_) | Expression::ArrayExpression(_)
                        ) || (exact
                            && matches!(
                                result.value,
                                Some(serde_json::Value::Object(_) | serde_json::Value::Array(_))
                            ));
                        let resolved = if exact {
                            match result.value {
                                Some(
                                    value @ (serde_json::Value::String(_)
                                    | serde_json::Value::Number(_)
                                    | serde_json::Value::Bool(_)
                                    | serde_json::Value::Null),
                                ) => Some(value),
                                _ => None,
                            }
                        } else {
                            None
                        };
                        properties.push(FoldSelectionProperty {
                            key,
                            shorthand: property.shorthand,
                            literal: if property.shorthand {
                                None
                            } else {
                                literal_json(value)
                            },
                            text: value.span().source_text(facts.source).to_string(),
                            inert: is_inert(value),
                            resolved,
                            structured,
                        });
                    }
                }
            }
            Some(FoldSelection {
                identifier: None,
                properties: Some(properties),
                unenumerable,
            })
        }
        _ => None,
    };
    let (slot, slot_end) = slot_access(facts.semantic, node, utf16);
    FoldCall {
        name,
        kind: if config_recipe {
            "recipe".into()
        } else {
            "cva-call".into()
        },
        span: utf16.span(call.span),
        slot,
        slot_end,
        shadowed_helpers,
        raw: is_raw_callee(&call.callee),
        not_imported: false,
        callee_property: None,
        data,
        exact: true,
        refusal: None,
        argument_count: call.arguments.len() as u32,
        trailing_arguments_inert: true,
        selection,
        origin,
        binding: None,
        cx_arguments: Vec::new(),
        value: None,
        guarded: false,
        statement_start: false,
    }
}

/// What a `cx()` argument naming a binding, or holding a condition, is resolved against.
struct CxScope<'s> {
    utf16: &'s Utf16,
    scoping: &'s Scoping,
    /// A module-scope binding of a style call → the call.
    styles: &'s HashMap<SymbolId, FoldSpan>,
    /// An import of a style binding declared in another module → its local name.
    imported_styles: &'s HashMap<SymbolId, String>,
    /// Byte spans of the reads a condition may not hold, sorted by start.
    guarded_reads: &'s [Span],
}

impl CxScope<'_> {
    /// Whether the condition at `span` reads something the fold may not copy.
    fn holds_guarded_read(&self, span: Span) -> bool {
        let first = self
            .guarded_reads
            .partition_point(|read| read.start < span.start);
        self.guarded_reads[first..]
            .first()
            .is_some_and(|read| read.start < span.end)
    }
}

fn cx_argument<'a>(argument: &'a Argument<'a>, scope: &CxScope<'_>) -> FoldCxArgument {
    let written = scope.utf16.span(argument.span());
    let classified = match argument.as_expression() {
        Some(expression) => cx_expression(expression, scope),
        None => cx_leaf(written, "spread"),
    };
    FoldCxArgument {
        written: Some(written),
        reads_bamboo: scope.holds_guarded_read(argument.span()),
        ..classified
    }
}

fn cx_leaf(span: FoldSpan, kind: &str) -> FoldCxArgument {
    FoldCxArgument {
        span,
        kind: kind.into(),
        value: None,
        elements: None,
        test: None,
        definition: None,
        binding: None,
        written: None,
        reads_bamboo: false,
    }
}

fn cx_expression<'a>(expression: &'a Expression<'a>, scope: &CxScope<'_>) -> FoldCxArgument {
    let expression = unwrap(expression);
    let span = scope.utf16.span(expression.span());
    match expression {
        Expression::StringLiteral(literal) => FoldCxArgument {
            value: Some(literal.value.to_string()),
            ..cx_leaf(span, "string")
        },
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            FoldCxArgument {
                value: template.single_quasi().map(|value| value.to_string()),
                ..cx_leaf(span, "string")
            }
        }
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_) => cx_leaf(span, "ignored"),
        Expression::Identifier(identifier) if identifier.name == "undefined" => {
            cx_leaf(span, "ignored")
        }
        Expression::Identifier(identifier) => {
            let symbol = identifier
                .reference_id
                .get()
                .and_then(|reference| scope.scoping.get_reference(reference).symbol_id());
            if let Some(definition) = symbol.and_then(|symbol| scope.styles.get(&symbol)) {
                FoldCxArgument {
                    definition: Some(*definition),
                    ..cx_leaf(span, "binding")
                }
            } else if let Some(local) = symbol.and_then(|symbol| scope.imported_styles.get(&symbol))
            {
                FoldCxArgument {
                    binding: Some(local.clone()),
                    ..cx_leaf(span, "binding")
                }
            } else {
                cx_leaf(span, "expression")
            }
        }
        // `test && value` is `value` when the test is truthy, and the falsy test otherwise —
        // which `cx` skips, as it skips every falsy argument.
        Expression::LogicalExpression(logical)
            if logical.operator == LogicalOperator::And
                && !scope.holds_guarded_read(logical.left.span()) =>
        {
            FoldCxArgument {
                elements: Some(vec![cx_expression(&logical.right, scope)]),
                test: Some(scope.utf16.span(logical.left.span())),
                ..cx_leaf(span, "when")
            }
        }
        Expression::ConditionalExpression(conditional)
            if !scope.holds_guarded_read(conditional.test.span()) =>
        {
            FoldCxArgument {
                elements: Some(vec![
                    cx_expression(&conditional.consequent, scope),
                    cx_expression(&conditional.alternate, scope),
                ]),
                test: Some(scope.utf16.span(conditional.test.span())),
                ..cx_leaf(span, "choose")
            }
        }
        Expression::ArrayExpression(array) => {
            let mut elements = Vec::new();
            let mut spread = false;
            for element in &array.elements {
                match element.as_expression() {
                    Some(expression) => elements.push(cx_expression(expression, scope)),
                    None => spread = true,
                }
            }
            FoldCxArgument {
                elements: (!spread).then_some(elements),
                ..cx_leaf(span, "array")
            }
        }
        _ => cx_leaf(span, "expression"),
    }
}

/// Every imported style binding `arguments` name, at any depth.
fn named_styles(arguments: &[FoldCxArgument], output: &mut HashSet<String>) {
    for argument in arguments {
        if let Some(local) = &argument.binding {
            output.insert(local.clone());
        }
        if let Some(elements) = &argument.elements {
            named_styles(elements, output);
        }
    }
}

/// Every name declared at module scope, which is what an added import could collide with.
///
/// The root scope's bindings are exactly that set: Oxc hoists a `var` to its function scope,
/// and the module is one, so a `var` written inside any top-level statement is here too.
fn module_scope_names(scoping: &Scoping) -> Vec<String> {
    let mut names: Vec<String> = scoping
        .get_bindings(scoping.root_scope_id())
        .keys()
        .map(|name| name.to_string())
        .collect();
    names.sort();
    names
}

struct ImportedRecipe {
    local: String,
    file_path: String,
    name: String,
    config: Option<serde_json::Value>,
    declaring_imports: Vec<String>,
    dependencies: Vec<String>,
}

struct ImportedStyle {
    local: String,
    file_path: String,
    name: String,
    style: Arc<ModuleStyle>,
    dependencies: Vec<String>,
}

/// Named imports of this module that resolve — through re-exports, aliases and star exports —
/// to an inline recipe, or to an exact style binding, declared at module scope in another module.
fn imported_recipe_bindings(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    program: &oxc_ast::ast::Program<'_>,
    entrypoints: &FoldEntrypoints<'_>,
) -> (Vec<ImportedRecipe>, Vec<ImportedStyle>) {
    // Every module this walk opens is a probe, not a dependency: a consumer importing ten
    // components from a barrel must not be re-folded when an unrelated one changes. The reads
    // are captured and discarded; each recipe found reports the modules it actually came through.
    let (output, _) =
        project.capture(|| imported_recipe_walk(project, filename, program, entrypoints));
    output
}

fn imported_recipe_walk(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    program: &oxc_ast::ast::Program<'_>,
    entrypoints: &FoldEntrypoints<'_>,
) -> (Vec<ImportedRecipe>, Vec<ImportedStyle>) {
    let mut output = Vec::new();
    let mut styles = Vec::new();
    let mut cache: HashMap<String, Option<Arc<ModuleRecipes>>> = HashMap::new();
    // Normalised once: a module importing many names compared every path against it, per name.
    let consumer = crate::evaluator::normalize_path(filename);
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.import_kind.is_type() {
            continue;
        }
        let specifier = declaration.source.value.as_str();
        if entrypoints.is_bamboo(specifier) {
            continue;
        }
        let named: Vec<_> = declaration
            .specifiers
            .iter()
            .flatten()
            .filter_map(|specifier| match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named)
                    if !named.import_kind.is_type() =>
                {
                    Some(named)
                }
                _ => None,
            })
            .collect();
        if named.is_empty() {
            continue;
        }
        let Some(target) = project.resolve_specifier(filename, specifier) else {
            continue;
        };
        let normalized_target = crate::evaluator::normalize_path(&target);
        if normalized_target == consumer {
            continue;
        }
        let exports = exported_recipes_cached(project, &target, entrypoints, &mut cache);
        let Some(exports) = exports else { continue };
        for named in named {
            let imported = named.imported.name().to_string();
            let Some(origin) = exports.names.get(&imported) else {
                continue;
            };
            let declaring = module_recipes(project, &origin.file_path, entrypoints, &mut cache);
            let dependencies = |reads: Vec<String>| {
                let mut dependencies: Vec<String> = std::iter::once(normalized_target.clone())
                    .chain(origin.through.iter().cloned())
                    .chain(std::iter::once(crate::evaluator::normalize_path(
                        &origin.file_path,
                    )))
                    .chain(reads)
                    .filter(|path| *path != consumer)
                    .collect();
                dependencies.sort();
                dependencies.dedup();
                dependencies
            };
            // A style binding is not a recipe: one whose call is not exact names nothing the
            // fold can use, and is left for the runtime `cx` to read.
            if let Some(module) = &declaring
                && let Some(style) = module.styles.get(&origin.name)
            {
                if let Some(style) = style {
                    styles.push(ImportedStyle {
                        local: named.local.name.to_string(),
                        file_path: origin.file_path.clone(),
                        name: origin.name.clone(),
                        style: style.clone(),
                        dependencies: dependencies(module.reads.clone()),
                    });
                }
                continue;
            }
            let (config, declaring_imports, config_reads) = declaring
                .map(|module| {
                    (
                        module.configs.get(&origin.name).cloned().flatten(),
                        module.imports.clone(),
                        module.reads.clone(),
                    )
                })
                .unwrap_or_default();
            output.push(ImportedRecipe {
                local: named.local.name.to_string(),
                file_path: origin.file_path.clone(),
                name: origin.name.clone(),
                config,
                declaring_imports,
                dependencies: dependencies(config_reads),
            });
        }
    }
    (output, styles)
}

#[derive(Clone)]
struct RecipeOrigin {
    file_path: String,
    name: String,
    /// Modules between the one asked and the declaring one, which a re-export route crossed.
    through: Vec<String>,
}

impl RecipeOrigin {
    /// This origin as seen from a module that reached it through `module`.
    fn via(&self, module: &str) -> Self {
        let mut through = self.through.clone();
        let module = crate::evaluator::normalize_path(module);
        if module != crate::evaluator::normalize_path(&self.file_path) && !through.contains(&module)
        {
            through.push(module);
        }
        Self {
            file_path: self.file_path.clone(),
            name: self.name.clone(),
            through,
        }
    }
}

#[derive(Clone)]
struct ModuleRecipes {
    /// Declared at module scope: name → config (absent when ambiguous).
    configs: HashMap<String, Option<serde_json::Value>>,
    /// Style bindings declared at module scope: name → the call (absent when it is not exact).
    styles: HashMap<String, Option<Arc<ModuleStyle>>>,
    exported_locally: HashSet<String>,
    imports: Vec<String>,
    /// Modules the configs' and the styles' evaluation read.
    reads: Vec<String>,
}

/// An exact style call a module binds at module scope.
#[derive(Clone)]
struct ModuleStyle {
    /// `css` or `pattern`.
    kind: String,
    /// `css`, or the pattern's name.
    callee: String,
    data: Vec<serde_json::Value>,
}

#[derive(Clone)]
struct ExportedRecipes {
    names: HashMap<String, RecipeOrigin>,
}

/// A module's module-scope inline recipes and its import specifiers.
fn module_recipes(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    entrypoints: &FoldEntrypoints<'_>,
    cache: &mut HashMap<String, Option<Arc<ModuleRecipes>>>,
) -> Option<Arc<ModuleRecipes>> {
    let key = crate::evaluator::normalize_path(filename);
    if let Some(cached) = cache.get(&key) {
        return cached.clone();
    }
    // Across native calls too: every transform of a module importing from a barrel walks the
    // barrel's members for recipes, and without this parsed each of them every time.
    let global_key = (project.fingerprint(), key.clone());
    let stored = MODULE_RECIPES_CACHE.get(&global_key);
    if let Some((result, witnesses)) = stored
        && project.witnesses_hold(&witnesses)
    {
        cache.insert(key, result.clone());
        return result;
    }
    let (result, witnesses) =
        project.witnessed(|| module_recipes_uncached(project, filename, entrypoints).map(Arc::new));
    MODULE_RECIPES_CACHE.insert(global_key, (result.clone(), witnesses));
    cache.insert(key, result.clone());
    result
}

/// One module's recipes, keyed by project fingerprint and path, with the files they read.
type ModuleRecipesEntry = (Option<Arc<ModuleRecipes>>, Vec<(String, Option<u64>)>);
static MODULE_RECIPES_CACHE: SharedCache<(u64, String), ModuleRecipesEntry> = SharedCache::new();

fn module_recipes_uncached(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    entrypoints: &FoldEntrypoints<'_>,
) -> Option<ModuleRecipes> {
    (|| {
        let text = project.module_text(filename)?;
        let allocator = Allocator::default();
        let source_type = crate::evaluator::source_type_for(filename);
        let parsed = Parser::new(&allocator, &text, source_type).parse();
        if parsed.panicked || !parsed.diagnostics.is_empty() {
            return None;
        }
        let semantic = SemanticBuilder::new_compiler()
            .with_build_nodes(true)
            .build(&parsed.program)
            .semantic;
        let facts = ModuleFacts {
            source: &text,
            semantic: &semantic,
            program: &parsed.program,
        };
        let bindings = collect_bamboo_bindings(&parsed.program, entrypoints);
        let definitions = recipe_definitions(&facts, &bindings);
        let style_definitions = style_definitions(&facts, &bindings, entrypoints);
        let ((configs, styles), reads) = project.capture(|| {
            let mut evaluator = FileEvaluator::new(filename, project, &semantic, &parsed.program);
            let mut configs: HashMap<String, Option<serde_json::Value>> = HashMap::new();
            for (name, call, _) in &definitions {
                let config = if configs.contains_key(name) {
                    None
                } else {
                    let (data, _, _) = argument_values(&mut evaluator, call);
                    (data.len() == 1).then(|| data.into_iter().next()).flatten()
                };
                configs.insert(name.clone(), config);
            }
            // Judged as the module's own fold judges the call: every argument exact, and a
            // nullish one only where `css()` drops it.
            let mut styles: HashMap<String, Option<Arc<ModuleStyle>>> = HashMap::new();
            for definition in &style_definitions {
                let style = if styles.contains_key(&definition.name) {
                    None
                } else {
                    let (data, _, _) = argument_values(&mut evaluator, definition.call);
                    let drops_nullish =
                        definition.kind == "css" && definition.call.arguments.len() == 1;
                    let exact = definition.call.arguments.iter().all(|argument| {
                        argument.as_expression().is_some_and(|expression| {
                            Exactness {
                                evaluator: &mut evaluator,
                                drops_nullish,
                            }
                            .check(expression)
                        })
                    });
                    exact.then(|| {
                        Arc::new(ModuleStyle {
                            kind: definition.kind.clone(),
                            callee: definition.callee.clone(),
                            data,
                        })
                    })
                };
                styles.insert(definition.name.clone(), style);
            }
            (configs, styles)
        });
        let mut exported_locally = HashSet::new();
        for statement in &parsed.program.body {
            if let Statement::ExportDeclaration(export) = statement
                && let oxc_ast::ast::Declaration::VariableDeclaration(declaration) =
                    &export.declaration
            {
                for declarator in &declaration.declarations {
                    if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                        exported_locally.insert(id.name.to_string());
                    }
                }
            }
        }
        let imports = parsed
            .program
            .body
            .iter()
            .filter_map(|statement| match statement {
                Statement::ImportDeclaration(declaration) if !declaration.import_kind.is_type() => {
                    Some(declaration.source.value.to_string())
                }
                _ => None,
            })
            .collect();
        Some(ModuleRecipes {
            configs,
            styles,
            exported_locally,
            imports,
            reads,
        })
    })()
}

type ExportedRecipesEntry = (Option<ExportedRecipes>, Vec<(String, Option<u64>)>);
static EXPORTED_RECIPES_CACHE: SharedCache<(u64, String), ExportedRecipesEntry> =
    SharedCache::new();

/// For `__poisonCaches` in `lib.rs`.
pub(crate) fn poison_caches() {
    MODULE_RECIPES_CACHE.poison();
    EXPORTED_RECIPES_CACHE.poison();
}

/// For `__cacheHits` in `lib.rs`.
pub(crate) fn cache_hits() -> u64 {
    MODULE_RECIPES_CACHE.hits() + EXPORTED_RECIPES_CACHE.hits()
}

/// `exported_recipes` from a fresh walk, remembered across native calls while every file the
/// walk read still holds what it held. Only the whole walk is stored: a nested one can be cut
/// short by a cycle, and its answer then depends on where the walk started.
fn exported_recipes_cached(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    entrypoints: &FoldEntrypoints<'_>,
    cache: &mut HashMap<String, Option<Arc<ModuleRecipes>>>,
) -> Option<ExportedRecipes> {
    let key = (
        project.fingerprint(),
        crate::evaluator::normalize_path(filename),
    );
    let stored = EXPORTED_RECIPES_CACHE.get(&key);
    if let Some((result, witnesses)) = stored
        && project.witnesses_hold(&witnesses)
    {
        return result;
    }
    let (result, witnesses) = project
        .witnessed(|| exported_recipes(project, filename, entrypoints, cache, &mut HashSet::new()));
    EXPORTED_RECIPES_CACHE.insert(key, (result.clone(), witnesses));
    result
}

/// The names a module exports that are inline recipes, following re-exports.
fn exported_recipes(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    entrypoints: &FoldEntrypoints<'_>,
    cache: &mut HashMap<String, Option<Arc<ModuleRecipes>>>,
    seen: &mut HashSet<String>,
) -> Option<ExportedRecipes> {
    let key = crate::evaluator::normalize_path(filename);
    if !seen.insert(key) {
        return Some(ExportedRecipes {
            names: HashMap::new(),
        });
    }
    let recipes = module_recipes(project, filename, entrypoints, cache);
    let text = project.module_text(filename)?;
    let allocator = Allocator::default();
    let source_type = crate::evaluator::source_type_for(filename);
    let parsed = Parser::new(&allocator, &text, source_type).parse();
    if parsed.panicked {
        return None;
    }

    let mut names = HashMap::new();
    let mut local: HashMap<String, RecipeOrigin> = HashMap::new();
    if let Some(recipes) = &recipes {
        // A style binding travels the same routes a recipe does; the declaring module's record
        // tells the two apart at the end of the walk.
        for name in recipes.configs.keys().chain(recipes.styles.keys()) {
            let origin = RecipeOrigin {
                file_path: filename.to_string(),
                name: name.clone(),
                through: Vec::new(),
            };
            local.insert(name.clone(), origin.clone());
            if recipes.exported_locally.contains(name) {
                names.insert(name.clone(), origin);
            }
        }
    }
    // `import { badge } from './a'` then `export { badge }`. Only an import one of those local
    // export statements names is followed: walking every import made each lookup visit the
    // module's whole transitive graph — the rest of the app, for a component file — though only
    // a re-exported binding can reach this module's exports.
    let reexported_locals: HashSet<String> = parsed
        .program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::ExportNamedDeclaration(export) if !export.export_kind.is_type() => {
                Some(export)
            }
            _ => None,
        })
        .flat_map(|export| export.specifiers.iter())
        .filter(|specifier| !specifier.export_kind.is_type())
        .map(|specifier| module_export_name(&specifier.local))
        .collect();
    for statement in &parsed.program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.import_kind.is_type() {
            continue;
        }
        let reexports_one = declaration.specifiers.iter().flatten().any(|specifier| {
            matches!(specifier, ImportDeclarationSpecifier::ImportSpecifier(named)
                if !named.import_kind.is_type() && reexported_locals.contains(named.local.name.as_str()))
        });
        if !reexports_one {
            continue;
        }
        let Some(target) = project.resolve_specifier(filename, declaration.source.value.as_str())
        else {
            continue;
        };
        let Some(exports) = exported_recipes(project, &target, entrypoints, cache, seen) else {
            continue;
        };
        for specifier in declaration.specifiers.iter().flatten() {
            if let ImportDeclarationSpecifier::ImportSpecifier(named) = specifier
                && !named.import_kind.is_type()
                && let Some(origin) = exports.names.get(named.imported.name().as_str())
            {
                local
                    .entry(named.local.name.to_string())
                    .or_insert_with(|| origin.via(&target));
            }
        }
    }
    let mut starred: HashMap<String, RecipeOrigin> = HashMap::new();
    let mut ambiguous = HashSet::new();
    for statement in &parsed.program.body {
        match statement {
            Statement::ExportNamedDeclaration(export) if !export.export_kind.is_type() => {
                for specifier in &export.specifiers {
                    if specifier.export_kind.is_type() {
                        continue;
                    }
                    if let Some(origin) = local.get(&module_export_name(&specifier.local)) {
                        names.insert(module_export_name(&specifier.exported), origin.clone());
                    }
                }
            }
            Statement::ExportFromDeclaration(export) if !export.export_kind.is_type() => {
                let Some(target) =
                    project.resolve_specifier(filename, export.source.value.as_str())
                else {
                    continue;
                };
                let Some(exports) = exported_recipes(project, &target, entrypoints, cache, seen)
                else {
                    continue;
                };
                for specifier in &export.specifiers {
                    if specifier.export_kind.is_type() {
                        continue;
                    }
                    if let Some(origin) = exports.names.get(&module_export_name(&specifier.local)) {
                        names.insert(module_export_name(&specifier.exported), origin.via(&target));
                    }
                }
            }
            // `export * as ns` makes no individual name importable.
            Statement::ExportAllDeclaration(export)
                if export.exported.is_none() && !export.export_kind.is_type() =>
            {
                let Some(target) =
                    project.resolve_specifier(filename, export.source.value.as_str())
                else {
                    continue;
                };
                let Some(exports) = exported_recipes(project, &target, entrypoints, cache, seen)
                else {
                    continue;
                };
                for (name, origin) in exports.names {
                    let origin = origin.via(&target);
                    match starred.get(&name) {
                        Some(existing)
                            if existing.file_path != origin.file_path
                                || existing.name != origin.name =>
                        {
                            ambiguous.insert(name);
                        }
                        _ => {
                            starred.insert(name, origin);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    // A name the module exports itself is its own, recipe or not: a star member's recipe of it is
    // not what importing it gives, and calling the module's own `button()` compiled to the recipe.
    let own = own_export_names(&parsed.program);
    for (name, origin) in starred {
        if !names.contains_key(&name) && !own.contains(&name) && !ambiguous.contains(&name) {
            names.insert(name, origin);
        }
    }
    Some(ExportedRecipes { names })
}

/// The names `program` exports itself, before any `export *`: what it declares, what it exports by
/// name, from itself or another module, `export * as` names, and `default`. Not a declaration
/// TypeScript erases (`erased`), nor a type.
fn own_export_names(program: &oxc_ast::ast::Program<'_>) -> HashSet<String> {
    let mut names = HashSet::new();
    for statement in &program.body {
        match statement {
            Statement::ExportDeclaration(export) => {
                if crate::evaluator::erased(&export.declaration) {
                    continue;
                }
                match &export.declaration {
                    Declaration::VariableDeclaration(declaration) => {
                        for declarator in &declaration.declarations {
                            names.extend(
                                declarator
                                    .id
                                    .get_binding_identifiers()
                                    .iter()
                                    .map(|id| id.name.to_string()),
                            );
                        }
                    }
                    Declaration::FunctionDeclaration(function) => {
                        names.extend(function.id.as_ref().map(|id| id.name.to_string()));
                    }
                    Declaration::ClassDeclaration(class) => {
                        names.extend(class.id.as_ref().map(|id| id.name.to_string()));
                    }
                    Declaration::TSEnumDeclaration(enumeration) => {
                        names.insert(enumeration.id.name.to_string());
                    }
                    Declaration::TSNamespaceDeclaration(namespace) => {
                        names.insert(namespace.id.name.to_string());
                    }
                    Declaration::TSImportEqualsDeclaration(import) => {
                        names.insert(import.id.name.to_string());
                    }
                    _ => {}
                }
            }
            Statement::ExportNamedDeclaration(export) if !export.export_kind.is_type() => {
                names.extend(
                    export
                        .specifiers
                        .iter()
                        .filter(|specifier| !specifier.export_kind.is_type())
                        .map(|specifier| module_export_name(&specifier.exported)),
                );
            }
            Statement::ExportFromDeclaration(export) if !export.export_kind.is_type() => {
                names.extend(
                    export
                        .specifiers
                        .iter()
                        .filter(|specifier| !specifier.export_kind.is_type())
                        .map(|specifier| module_export_name(&specifier.exported)),
                );
            }
            Statement::ExportAllDeclaration(export) if !export.export_kind.is_type() => {
                names.extend(export.exported.as_ref().map(module_export_name));
            }
            Statement::ExportDefaultDeclaration(_) => {
                names.insert("default".to_string());
            }
            _ => {}
        }
    }
    names
}
