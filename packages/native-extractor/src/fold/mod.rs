//! Per-module facts for the Vite compiler. See `model.rs`.

pub mod exact;
pub mod model;

use std::collections::{HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Expression, ImportDeclarationSpecifier, ModuleExportName,
        ObjectPropertyKind, PropertyKind, Statement, TSModuleReference,
    },
};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, Semantic, SemanticBuilder};
use oxc_span::{GetSpan, Span};
use oxc_syntax::symbol::SymbolId;

use crate::evaluator::{EvalResult, FileEvaluator, ProjectEvaluator};
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

struct Utf16 {
    /// Byte offset → UTF-16 offset, computed lazily for sources that are not pure ASCII.
    ascii: bool,
    prefix: Vec<u32>,
}

impl Utf16 {
    fn new(source: &str) -> Self {
        if source.is_ascii() {
            return Self {
                ascii: true,
                prefix: Vec::new(),
            };
        }
        let mut prefix = vec![0u32; source.len() + 1];
        let mut units = 0u32;
        for (index, character) in source.char_indices() {
            for offset in 0..character.len_utf8() {
                prefix[index + offset] = units;
            }
            units += character.len_utf16() as u32;
        }
        prefix[source.len()] = units;
        Self {
            ascii: false,
            prefix,
        }
    }

    fn at(&self, byte: u32) -> u32 {
        if self.ascii {
            byte
        } else {
            self.prefix[byte as usize]
        }
    }

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
    let binding = bindings.get(&symbol)?;
    let members = callee_members(callee).unwrap_or_default();
    let (imported, rest): (String, &[String]) = if binding.namespace {
        let first = members.first()?.clone();
        (first, &members[1..])
    } else {
        (binding.imported.clone(), &members[..])
    };
    let property = rest.first().cloned();
    let kind = match binding.kind {
        "css" => match imported.as_str() {
            "css" | "cva" | "sva" | "cx" | "viewTransition" => imported.clone(),
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
                "css" | "viewTransition" => other,
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

pub(crate) fn analyze_module(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    source: &str,
    entrypoints: &FoldEntrypoints<'_>,
    capture_references: bool,
) -> FoldAnalysis {
    let allocator = Allocator::default();
    let source_type =
        oxc_span::SourceType::from_path(filename).unwrap_or_else(|_| oxc_span::SourceType::tsx());
    let parsed = Parser::new(&allocator, source, source_type).parse();
    let mut errors: Vec<String> = parsed.diagnostics.iter().map(ToString::to_string).collect();
    if parsed.panicked {
        return empty_analysis(errors);
    }
    let built = SemanticBuilder::new_compiler()
        .with_build_nodes(true)
        .build(&parsed.program);
    errors.extend(built.diagnostics.iter().map(ToString::to_string));
    let semantic = built.semantic;
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
        dependencies: Vec::new(),
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

    // Imports that resolve to an inline recipe declared in another module.
    let imported_recipes = imported_recipe_bindings(project, filename, facts.program, entrypoints);
    let imported_recipe_symbols: HashMap<SymbolId, usize> = imported_recipes
        .iter()
        .enumerate()
        .filter_map(|(index, recipe)| {
            scoping
                .get_binding(scoping.root_scope_id(), recipe.local.as_str().into())
                .map(|symbol| (symbol, index))
        })
        .collect();

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

        // A recipe invocation of a local or imported inline recipe: `badge(...)`, and the
        // `badge.raw(...)` spelling of the same binding, which is reported rather than folded.
        let callee_root = match unwrap(&call.callee) {
            Expression::Identifier(identifier) => Some(&**identifier),
            _ if is_raw_callee(&call.callee) => root_identifier(&call.callee),
            _ => None,
        };
        if let Some(root) = callee_root {
            let symbol = root
                .reference_id
                .get()
                .and_then(|reference| scoping.get_reference(reference).symbol_id());
            let recipe_name = symbol.and_then(|symbol| {
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
            if definition_names.contains(root.name.as_str())
                || imported_recipes
                    .iter()
                    .any(|recipe| recipe.local == root.name.as_str())
            {
                continue;
            }
        }

        let classified = classify_callee(&call.callee, scoping, &bindings, entrypoints);
        let Some((kind, name, property)) = classified else {
            if let Some((kind, name)) = not_imported_call(
                &call.callee,
                scoping,
                &bindings,
                &module_names,
                &foreign_names,
                entrypoints,
            ) {
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
                    argument_count: call.arguments.len() as u32,
                    trailing_arguments_inert: true,
                    selection: None,
                    origin: None,
                    binding: None,
                    cx_arguments: Vec::new(),
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
            let (data, _) = argument_values(&mut evaluator, call);
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
                argument_count: call.arguments.len() as u32,
                trailing_arguments_inert: true,
                selection: None,
                origin: None,
                binding,
                cx_arguments: Vec::new(),
            });
            continue;
        }

        if kind == "cx" {
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
                argument_count: call.arguments.len() as u32,
                trailing_arguments_inert: true,
                selection: None,
                origin: None,
                binding: None,
                cx_arguments: call
                    .arguments
                    .iter()
                    .map(|argument| cx_argument(argument, &utf16))
                    .collect(),
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

        let (data, _) = argument_values(&mut evaluator, call);
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
        calls.push(FoldCall {
            name,
            kind,
            span: call_span,
            slot,
            slot_end,
            shadowed_helpers: Vec::new(),
            raw: is_raw_callee(&call.callee),
            not_imported: false,
            callee_property: property,
            data,
            exact,
            argument_count: call.arguments.len() as u32,
            trailing_arguments_inert,
            selection: None,
            origin: None,
            binding: None,
            cx_arguments: Vec::new(),
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
) -> (Vec<serde_json::Value>, bool) {
    let mut output = Vec::new();
    let mut complete = true;
    for argument in &call.arguments {
        let result = argument
            .as_expression()
            .map_or_else(EvalResult::unknown, |expression| {
                evaluator.evaluate(expression)
            });
        complete &= result.complete;
        let mut data = result.data();
        if data.is_empty() {
            data.push(serde_json::Value::Object(serde_json::Map::new()));
        }
        output.extend(data);
    }
    if call.arguments.is_empty() {
        output.push(serde_json::Value::Object(serde_json::Map::new()));
    }
    (output, complete)
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
    let (data, _) = argument_values(evaluator, call);
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
                        let resolved = {
                            let result = evaluator.evaluate(value);
                            let exact = exact_result(&result)
                                && Exactness {
                                    evaluator: &mut *evaluator,
                                }
                                .check(value);
                            if exact {
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
                            }
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
        argument_count: call.arguments.len() as u32,
        trailing_arguments_inert: true,
        selection,
        origin,
        binding: None,
        cx_arguments: Vec::new(),
    }
}

fn cx_argument(argument: &Argument<'_>, utf16: &Utf16) -> FoldCxArgument {
    let Some(expression) = argument.as_expression() else {
        return FoldCxArgument {
            span: utf16.span(argument.span()),
            kind: "spread".into(),
            value: None,
            elements: None,
        };
    };
    cx_expression(expression, utf16)
}

fn cx_expression(expression: &Expression<'_>, utf16: &Utf16) -> FoldCxArgument {
    let span = utf16.span(expression.span());
    match expression {
        Expression::StringLiteral(literal) => FoldCxArgument {
            span,
            kind: "string".into(),
            value: Some(literal.value.to_string()),
            elements: None,
        },
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            FoldCxArgument {
                span,
                kind: "string".into(),
                value: template.single_quasi().map(|value| value.to_string()),
                elements: None,
            }
        }
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_) => FoldCxArgument {
            span,
            kind: "ignored".into(),
            value: None,
            elements: None,
        },
        Expression::Identifier(identifier) if identifier.name == "undefined" => FoldCxArgument {
            span,
            kind: "ignored".into(),
            value: None,
            elements: None,
        },
        Expression::ArrayExpression(array) => {
            let mut elements = Vec::new();
            let mut spread = false;
            for element in &array.elements {
                match element.as_expression() {
                    Some(expression) => elements.push(cx_expression(expression, utf16)),
                    None => spread = true,
                }
            }
            FoldCxArgument {
                span,
                kind: "array".into(),
                value: None,
                elements: (!spread).then_some(elements),
            }
        }
        _ => FoldCxArgument {
            span,
            kind: "expression".into(),
            value: None,
            elements: None,
        },
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

/// Named imports of this module that resolve — through re-exports, aliases and star exports —
/// to an inline recipe declared at module scope in another module.
fn imported_recipe_bindings(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    program: &oxc_ast::ast::Program<'_>,
    entrypoints: &FoldEntrypoints<'_>,
) -> Vec<ImportedRecipe> {
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
) -> Vec<ImportedRecipe> {
    let mut output = Vec::new();
    let mut cache: HashMap<String, Option<ModuleRecipes>> = HashMap::new();
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
        if crate::evaluator::normalize_path(&target) == crate::evaluator::normalize_path(filename) {
            continue;
        }
        let exports = exported_recipes(
            project,
            &target,
            entrypoints,
            &mut cache,
            &mut HashSet::new(),
        );
        let Some(exports) = exports else { continue };
        for named in named {
            let imported = named.imported.name().to_string();
            let Some(origin) = exports.names.get(&imported) else {
                continue;
            };
            let declaring = module_recipes(project, &origin.file_path, entrypoints, &mut cache);
            let (config, declaring_imports, config_reads) = declaring
                .map(|module| {
                    (
                        module.configs.get(&origin.name).cloned().flatten(),
                        module.imports.clone(),
                        module.reads.clone(),
                    )
                })
                .unwrap_or_default();
            let mut dependencies: Vec<String> =
                std::iter::once(crate::evaluator::normalize_path(&target))
                    .chain(origin.through.iter().cloned())
                    .chain(std::iter::once(crate::evaluator::normalize_path(
                        &origin.file_path,
                    )))
                    .chain(config_reads)
                    .filter(|path| *path != crate::evaluator::normalize_path(filename))
                    .collect();
            dependencies.sort();
            dependencies.dedup();
            output.push(ImportedRecipe {
                local: named.local.name.to_string(),
                file_path: origin.file_path.clone(),
                name: origin.name.clone(),
                config,
                declaring_imports,
                dependencies,
            });
        }
    }
    output
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
    exported_locally: HashSet<String>,
    imports: Vec<String>,
    /// Modules the configs' evaluation read.
    reads: Vec<String>,
}

struct ExportedRecipes {
    names: HashMap<String, RecipeOrigin>,
}

/// A module's module-scope inline recipes and its import specifiers.
fn module_recipes(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    entrypoints: &FoldEntrypoints<'_>,
    cache: &mut HashMap<String, Option<ModuleRecipes>>,
) -> Option<ModuleRecipes> {
    let key = crate::evaluator::normalize_path(filename);
    if let Some(cached) = cache.get(&key) {
        return cached.clone();
    }
    let result = (|| {
        let text = project.module_text(filename)?;
        let allocator = Allocator::default();
        let source_type = oxc_span::SourceType::from_path(filename)
            .unwrap_or_else(|_| oxc_span::SourceType::tsx());
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
        let (configs, reads) = project.capture(|| {
            let mut evaluator = FileEvaluator::new(filename, project, &semantic, &parsed.program);
            let mut configs: HashMap<String, Option<serde_json::Value>> = HashMap::new();
            for (name, call, _) in &definitions {
                let config = if configs.contains_key(name) {
                    None
                } else {
                    let (data, _) = argument_values(&mut evaluator, call);
                    (data.len() == 1).then(|| data.into_iter().next()).flatten()
                };
                configs.insert(name.clone(), config);
            }
            configs
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
            exported_locally,
            imports,
            reads,
        })
    })();
    cache.insert(key, result.clone());
    result
}

/// The names a module exports that are inline recipes, following re-exports.
fn exported_recipes(
    project: &ProjectEvaluator<'_>,
    filename: &str,
    entrypoints: &FoldEntrypoints<'_>,
    cache: &mut HashMap<String, Option<ModuleRecipes>>,
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
    let source_type =
        oxc_span::SourceType::from_path(filename).unwrap_or_else(|_| oxc_span::SourceType::tsx());
    let parsed = Parser::new(&allocator, &text, source_type).parse();
    if parsed.panicked {
        return None;
    }

    let mut names = HashMap::new();
    let mut local: HashMap<String, RecipeOrigin> = HashMap::new();
    if let Some(recipes) = &recipes {
        for name in recipes.configs.keys() {
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
    // `import { badge } from './a'` then `export { badge }`.
    for statement in &parsed.program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.import_kind.is_type() {
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
    for (name, origin) in starred {
        if !names.contains_key(&name) && !ambiguous.contains(&name) {
            names.insert(name, origin);
        }
    }
    Some(ExportedRecipes { names })
}
