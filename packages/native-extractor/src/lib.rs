use std::collections::HashMap;

use evaluator::{EvalResult, FileEvaluator, ProjectEvaluator};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        Argument, Expression, ImportDeclarationSpecifier, JSXAttributeItem, JSXAttributeName,
        JSXAttributeValue, JSXElementName, Statement,
    },
};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::{GetSpan, SourceType};
use oxc_syntax::symbol::SymbolId;

mod evaluator;

#[napi(object)]
pub struct NativeEntrypoint {
    pub kind: String,
    pub modules: Vec<String>,
    /// The configured callable exports for this entrypoint.
    pub names: Vec<String>,
}

#[napi(object)]
pub struct NativeLoss {
    pub prop: Option<String>,
    pub reason: String,
}

#[napi(object)]
pub struct NativeCall {
    /// The local binding at the call site.
    pub name: String,
    /// The name exported by the Bamboo entrypoint.
    pub imported_name: String,
    pub kind: String,
    /// The module specifier which introduced the binding.
    pub module: String,
    pub start: u32,
    pub end: u32,
    pub callee_start: u32,
    pub callee_end: u32,
    pub line: u32,
    pub column: u32,
    /// Data fragments to feed to the existing encoder. Unknown dynamic values are omitted;
    /// statically enumerable conditional branches are included as independent fragments.
    pub arguments: Vec<serde_json::Value>,
    pub complete: bool,
    pub losses: Vec<NativeLoss>,
}

#[napi(object)]
pub struct NativeAnalysis {
    pub calls: Vec<NativeCall>,
    pub errors: Vec<String>,
    pub dependencies: Vec<String>,
    pub pending_candidates: Vec<String>,
    pub configuration_files: Vec<String>,
}

#[napi(object)]
pub struct NativeSource {
    pub filename: String,
    pub source: String,
}

#[napi(object)]
pub struct NativePathMapping {
    pub pattern: String,
    pub paths: Vec<String>,
}

#[napi(object)]
pub struct NativeToken {
    pub path: String,
    pub value: Option<serde_json::Value>,
    pub variable: Option<String>,
}

#[napi(object)]
pub struct NativeProjectOptions {
    pub cwd: Option<String>,
    pub base_url: Option<String>,
    pub paths: Vec<NativePathMapping>,
    pub tokens: Vec<NativeToken>,
    pub jsx: bool,
}

#[napi(object)]
pub struct NativeFileAnalysis {
    pub filename: String,
    pub calls: Vec<NativeCall>,
    pub errors: Vec<String>,
    pub dependencies: Vec<String>,
    pub pending_candidates: Vec<String>,
    pub configuration_files: Vec<String>,
}

#[derive(Clone)]
struct CallBinding {
    kind: String,
    imported_name: String,
    module: String,
    supported: bool,
}

fn source_type(filename: &str) -> Result<SourceType> {
    SourceType::from_path(filename)
        // A parser hook can turn a framework single-file component into TSX while preserving
        // its logical filename. The transformed content, not that extension, decides syntax.
        .or_else(|_| Ok::<_, String>(SourceType::tsx()))
        .map_err(|error| Error::new(Status::InvalidArg, error.to_string()))
}

fn utf16_offset(source: &str, byte: u32) -> u32 {
    source[..byte as usize].encode_utf16().count() as u32
}

fn line_and_column(source: &str, start: u32) -> (u32, u32) {
    let mut line_starts = vec![0];
    let mut characters = source.char_indices().peekable();
    while let Some((index, character)) = characters.next() {
        match character {
            '\r' => {
                if characters.peek().is_some_and(|(_, next)| *next == '\n') {
                    characters.next();
                    line_starts.push(index + 2);
                } else {
                    line_starts.push(index + 1);
                }
            }
            '\n' => line_starts.push(index + 1),
            '\u{2028}' | '\u{2029}' => line_starts.push(index + character.len_utf8()),
            _ => {}
        }
    }
    let start = start as usize;
    let line_index = line_starts.partition_point(|line_start| *line_start <= start) - 1;
    let column = source[line_starts[line_index]..start]
        .encode_utf16()
        .count() as u32
        + 1;
    (line_index as u32 + 1, column)
}

fn callee_symbol_and_members(
    expression: &Expression<'_>,
    scoping: &Scoping,
) -> Option<(SymbolId, Vec<String>, String)> {
    match expression {
        Expression::Identifier(identifier) => {
            let reference = identifier.reference_id.get()?;
            Some((
                scoping.get_reference(reference).symbol_id()?,
                Vec::new(),
                identifier.name.to_string(),
            ))
        }
        Expression::StaticMemberExpression(member) => {
            let (symbol, mut members, mut display) =
                callee_symbol_and_members(&member.object, scoping)?;
            members.push(member.property.name.to_string());
            display.push('.');
            display.push_str(member.property.name.as_str());
            Some((symbol, members, display))
        }
        Expression::ComputedMemberExpression(member) => {
            let Expression::StringLiteral(property) = &member.expression else {
                return None;
            };
            let (symbol, mut members, mut display) =
                callee_symbol_and_members(&member.object, scoping)?;
            members.push(property.value.to_string());
            display.push('.');
            display.push_str(property.value.as_str());
            Some((symbol, members, display))
        }
        Expression::ParenthesizedExpression(value) => {
            callee_symbol_and_members(&value.expression, scoping)
        }
        _ => None,
    }
}

fn callee_root_span(expression: &Expression<'_>) -> oxc_span::Span {
    match expression {
        Expression::StaticMemberExpression(member) => callee_root_span(&member.object),
        Expression::ComputedMemberExpression(member) => callee_root_span(&member.object),
        Expression::ParenthesizedExpression(value) => callee_root_span(&value.expression),
        _ => expression.span(),
    }
}

type NamedBindings = HashMap<SymbolId, CallBinding>;
type NamespaceBindings = HashMap<SymbolId, (String, String)>;
type JsxAliases = HashMap<SymbolId, String>;

fn collect_bindings(
    program: &oxc_ast::ast::Program<'_>,
    entrypoints: &[NativeEntrypoint],
) -> (NamedBindings, NamespaceBindings, JsxAliases) {
    let mut named = HashMap::new();
    let mut namespaces = HashMap::new();
    let mut jsx_aliases = HashMap::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        let Some(entrypoint) = entrypoints.iter().find(|entrypoint| {
            entrypoint
                .modules
                .iter()
                .any(|module| declaration.source.value.contains(module))
        }) else {
            continue;
        };
        for specifier in declaration.specifiers.iter().flatten() {
            match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                    let Some(symbol) = specifier.local.symbol_id.get() else {
                        continue;
                    };
                    let imported_name = specifier.imported.name().to_string();
                    jsx_aliases.insert(symbol, imported_name.clone());
                    named.insert(
                        symbol,
                        CallBinding {
                            kind: entrypoint.kind.clone(),
                            supported: entrypoint.names.iter().any(|name| name == &imported_name),
                            imported_name,
                            module: declaration.source.value.to_string(),
                        },
                    );
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                    if let Some(symbol) = specifier.local.symbol_id.get() {
                        namespaces.insert(
                            symbol,
                            (
                                entrypoint.kind.clone(),
                                declaration.source.value.to_string(),
                            ),
                        );
                    }
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => {}
            }
        }
    }
    // JSX aliases can come from any module, not only a Bamboo entrypoint. A project-written
    // recipe component is commonly imported from its own component module.
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        for specifier in declaration.specifiers.iter().flatten() {
            match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                    if let Some(symbol) = specifier.local.symbol_id.get() {
                        jsx_aliases.insert(symbol, specifier.imported.name().to_string());
                    }
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                    if let Some(symbol) = specifier.local.symbol_id.get() {
                        jsx_aliases.insert(symbol, "default".to_string());
                    }
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => {}
            }
        }
    }
    (named, namespaces, jsx_aliases)
}

fn classify_call(
    expression: &Expression<'_>,
    scoping: &Scoping,
    named: &HashMap<SymbolId, CallBinding>,
    namespaces: &HashMap<SymbolId, (String, String)>,
    entrypoints: &[NativeEntrypoint],
) -> Option<(CallBinding, String)> {
    let (symbol, members, display) = callee_symbol_and_members(expression, scoping)?;
    if let Some(binding) = named.get(&symbol) {
        let mut binding = binding.clone();
        if let Some(member) = members.first() {
            // `token.value()` and every `.raw()` surface retain the root's identity.
            if member != "value" && member != "raw" {
                return None;
            }
            if member == "value" && binding.kind == "token" {
                binding.kind = "tokenValue".to_string();
            }
        }
        return Some((binding, display));
    }
    let (kind, module) = namespaces.get(&symbol)?;
    let imported_name = members.first()?.clone();
    let entrypoint = entrypoints.iter().find(|entrypoint| {
        entrypoint.kind == *kind && entrypoint.modules.iter().any(|item| module.contains(item))
    })?;
    let mut call_kind = kind.clone();
    if kind == "token" && members.get(1).is_some_and(|member| member == "value") {
        call_kind = "tokenValue".to_string();
    }
    Some((
        CallBinding {
            kind: call_kind,
            imported_name: imported_name.clone(),
            module: module.clone(),
            supported: entrypoint.names.iter().any(|name| name == &imported_name),
        },
        display,
    ))
}

fn argument_data<'a>(
    arguments: &'a oxc_allocator::Vec<'a, Argument<'a>>,
    evaluator: &mut FileEvaluator<'a, '_, '_>,
) -> (Vec<serde_json::Value>, bool) {
    let mut output = Vec::new();
    let mut complete = true;
    for argument in arguments {
        match argument {
            Argument::SpreadElement(spread) => {
                let result = evaluator.evaluate(&spread.argument);
                complete &= result.complete;
                if let Some(serde_json::Value::Array(values)) = result.value {
                    output.extend(values);
                } else {
                    complete = false;
                }
                output.extend(result.conditions);
            }
            _ => {
                let result = argument
                    .as_expression()
                    .map_or_else(EvalResult::unknown, |expression| {
                        evaluator.evaluate(expression)
                    });
                complete &= result.complete;
                let mut data = result.data();
                if data.is_empty() {
                    // `unbox(undefined)` is `{}` for every Bamboo style surface.
                    data.push(serde_json::Value::Object(serde_json::Map::new()));
                }
                output.extend(data);
            }
        }
    }
    if arguments.is_empty() {
        output.push(serde_json::Value::Object(serde_json::Map::new()));
    }
    (output, complete)
}

fn jsx_tag(
    name: &JSXElementName<'_>,
    scoping: &Scoping,
    aliases: &HashMap<SymbolId, String>,
) -> Option<(String, String)> {
    match name {
        JSXElementName::Identifier(identifier) => {
            let name = identifier.name.to_string();
            Some((name.clone(), name))
        }
        JSXElementName::IdentifierReference(identifier) => {
            let local = identifier.name.to_string();
            let canonical = identifier
                .reference_id
                .get()
                .and_then(|reference| scoping.get_reference(reference).symbol_id())
                .and_then(|symbol| aliases.get(&symbol).cloned())
                .unwrap_or_else(|| local.clone());
            Some((local, canonical))
        }
        _ => None,
    }
}

fn jsx_data<'a>(
    attributes: &'a oxc_allocator::Vec<'a, JSXAttributeItem<'a>>,
    evaluator: &mut FileEvaluator<'a, '_, '_>,
) -> (Vec<serde_json::Value>, bool) {
    let mut object = serde_json::Map::new();
    let mut conditions = Vec::new();
    let mut complete = true;
    for attribute in attributes {
        match attribute {
            JSXAttributeItem::Attribute(attribute) => {
                let JSXAttributeName::Identifier(name) = &attribute.name else {
                    complete = false;
                    continue;
                };
                let key = name.name.to_string();
                let value = match &attribute.value {
                    None => EvalResult {
                        value: Some(true.into()),
                        conditions: Vec::new(),
                        complete: true,
                    },
                    Some(JSXAttributeValue::StringLiteral(value)) => EvalResult {
                        value: Some(value.value.to_string().into()),
                        conditions: Vec::new(),
                        complete: true,
                    },
                    Some(JSXAttributeValue::ExpressionContainer(container)) => {
                        evaluator.evaluate_jsx_expression(&container.expression)
                    }
                    _ => EvalResult::unknown(),
                };
                complete &= value.complete;
                for condition in value.conditions {
                    let mut fragment = serde_json::Map::new();
                    fragment.insert(key.clone(), condition);
                    conditions.push(fragment.into());
                }
                if let Some(value) = value.value {
                    object.insert(key, value);
                }
            }
            JSXAttributeItem::SpreadAttribute(spread) => {
                let value = evaluator.evaluate(&spread.argument);
                complete &= value.complete;
                conditions.extend(value.conditions);
                if let Some(serde_json::Value::Object(value)) = value.value {
                    object.extend(value);
                } else {
                    complete = false;
                }
            }
        }
    }
    conditions.push(object.into());
    (conditions, complete)
}

fn unwrap_expression<'a>(expression: &'a Expression<'a>) -> &'a Expression<'a> {
    match expression {
        Expression::ParenthesizedExpression(value) => unwrap_expression(&value.expression),
        Expression::TSAsExpression(value) => unwrap_expression(&value.expression),
        Expression::TSSatisfiesExpression(value) => unwrap_expression(&value.expression),
        Expression::TSTypeAssertion(value) => unwrap_expression(&value.expression),
        Expression::TSNonNullExpression(value) => unwrap_expression(&value.expression),
        _ => expression,
    }
}

fn recipe_losses<'a>(
    expression: &'a Expression<'a>,
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    path: &str,
    output: &mut Vec<NativeLoss>,
) {
    match unwrap_expression(expression) {
        Expression::ObjectExpression(object) => {
            for property in &object.properties {
                match property {
                    oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread) => {
                        if !matches!(
                            evaluator.evaluate(&spread.argument).value,
                            Some(serde_json::Value::Object(_))
                        ) {
                            output.push(NativeLoss {
                                prop: (!path.is_empty()).then(|| path.to_string()),
                                reason: "unenumerable-keys".to_string(),
                            });
                        }
                    }
                    oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) => {
                        let key = if property.computed {
                            property
                                .key
                                .as_expression()
                                .and_then(|key| evaluator.evaluate(key).value)
                                .map(|value| match value {
                                    serde_json::Value::String(value) => value,
                                    value => value.to_string(),
                                })
                        } else {
                            property.key.static_name().map(|name| name.into_owned())
                        };
                        let Some(key) = key else {
                            output.push(NativeLoss {
                                prop: (!path.is_empty()).then(|| path.to_string()),
                                reason: "unenumerable-keys".to_string(),
                            });
                            continue;
                        };
                        let child_path = if path.is_empty() {
                            key
                        } else {
                            format!("{path}.{key}")
                        };
                        let value = evaluator.evaluate(&property.value);
                        if value.value.is_none() && value.conditions.is_empty() && !value.complete {
                            output.push(NativeLoss {
                                prop: Some(child_path.clone()),
                                reason: "missing-property".to_string(),
                            });
                        }
                        recipe_losses(&property.value, evaluator, &child_path, output);
                    }
                }
            }
        }
        Expression::ArrayExpression(array) => {
            for (index, element) in array.elements.iter().enumerate() {
                let Some(expression) = element.as_expression() else {
                    continue;
                };
                recipe_losses(expression, evaluator, &format!("{path}.{index}"), output);
            }
        }
        _ => {}
    }
}

fn call_losses<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    binding: &CallBinding,
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    named: &NamedBindings,
    namespaces: &NamespaceBindings,
    entrypoints: &[NativeEntrypoint],
) -> Vec<NativeLoss> {
    let mut losses = Vec::new();
    let recipe = binding.kind == "css" && matches!(binding.imported_name.as_str(), "cva" | "sva");
    for argument in &call.arguments {
        let Some(expression) = argument.as_expression() else {
            losses.push(NativeLoss {
                prop: None,
                reason: "unenumerable-keys".to_string(),
            });
            continue;
        };
        if binding.kind == "css"
            && binding.imported_name == "css"
            && let Expression::CallExpression(inner) = unwrap_expression(expression)
            && let Some((inner_binding, display)) = classify_call(
                &inner.callee,
                evaluator.scoping,
                named,
                namespaces,
                entrypoints,
            )
            && matches!(inner_binding.kind.as_str(), "pattern" | "recipe")
            && display.ends_with(".raw")
        {
            losses.push(NativeLoss {
                prop: Some(display.trim_end_matches(".raw").to_string()),
                reason: "unresolved-raw".to_string(),
            });
        }
        if recipe {
            if !matches!(
                unwrap_expression(expression),
                Expression::ObjectExpression(_)
            ) && !evaluator.evaluate(expression).complete
            {
                losses.push(NativeLoss {
                    prop: None,
                    reason: "unresolvable-value".to_string(),
                });
            }
            recipe_losses(expression, evaluator, "", &mut losses);
        } else if binding.kind == "css"
            && binding.imported_name == "css"
            && let Expression::ObjectExpression(object) = unwrap_expression(expression)
        {
            for property in &object.properties {
                match property {
                    oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread)
                        if !matches!(
                            evaluator.evaluate(&spread.argument).value,
                            Some(serde_json::Value::Object(_))
                        ) =>
                    {
                        losses.push(NativeLoss {
                            prop: None,
                            reason: "unenumerable-keys".to_string(),
                        });
                    }
                    oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property)
                        if property.computed
                            && property
                                .key
                                .as_expression()
                                .is_none_or(|key| evaluator.evaluate(key).value.is_none()) =>
                    {
                        losses.push(NativeLoss {
                            prop: None,
                            reason: "unenumerable-keys".to_string(),
                        });
                    }
                    _ => {}
                }
            }
        }
    }
    losses
}

fn analyze_source<'sources>(
    project: &ProjectEvaluator<'sources>,
    filename: &str,
    source: &'sources str,
    entrypoints: &[NativeEntrypoint],
    capture_jsx: bool,
) -> Result<NativeAnalysis> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type(filename)?).parse();
    let mut errors: Vec<_> = parsed.diagnostics.iter().map(ToString::to_string).collect();
    let semantic = SemanticBuilder::new_compiler()
        .with_build_nodes(true)
        .build(&parsed.program);
    errors.extend(semantic.diagnostics.iter().map(ToString::to_string));
    let semantic = semantic.semantic;
    let scoping = semantic.scoping();
    let (named, namespaces, jsx_aliases) = collect_bindings(&parsed.program, entrypoints);
    project.begin_file(filename);
    let mut evaluator = FileEvaluator::new(filename, project, &semantic, &parsed.program);
    let mut calls = Vec::new();

    for node in semantic.nodes().iter() {
        let AstKind::CallExpression(expression) = node.kind() else {
            continue;
        };
        let Some((binding, display)) = classify_call(
            &expression.callee,
            scoping,
            &named,
            &namespaces,
            entrypoints,
        ) else {
            continue;
        };
        if !binding.supported && !matches!(binding.kind.as_str(), "pattern" | "recipe") {
            continue;
        }

        // `cx` and `fallback` affect folded runtime values but never contribute rules. Nested
        // token calls are still visited independently by the node iteration.
        if binding.kind == "css" && matches!(binding.imported_name.as_str(), "cx" | "fallback") {
            continue;
        }

        let (arguments, complete) = argument_data(&expression.arguments, &mut evaluator);
        let losses = call_losses(
            expression,
            &binding,
            &mut evaluator,
            &named,
            &namespaces,
            entrypoints,
        );
        let span = expression.span();
        let (line, column) = line_and_column(source, span.start);
        let kind = if !binding.supported && matches!(binding.kind.as_str(), "pattern" | "recipe") {
            "dead".to_string()
        } else {
            binding.kind
        };
        let callee_span = callee_root_span(&expression.callee);
        calls.push(NativeCall {
            name: display,
            imported_name: binding.imported_name,
            kind,
            module: binding.module,
            start: utf16_offset(source, span.start),
            end: utf16_offset(source, span.end),
            callee_start: utf16_offset(source, callee_span.start),
            callee_end: utf16_offset(source, callee_span.end),
            line,
            column,
            arguments,
            complete,
            losses,
        });
    }
    if capture_jsx {
        for node in semantic.nodes().iter() {
            let AstKind::JSXOpeningElement(element) = node.kind() else {
                continue;
            };
            let Some((local, canonical)) = jsx_tag(&element.name, scoping, &jsx_aliases) else {
                continue;
            };
            let (arguments, complete) = jsx_data(&element.attributes, &mut evaluator);
            let span = element.span();
            let (line, column) = line_and_column(source, span.start);
            calls.push(NativeCall {
                name: local,
                imported_name: canonical,
                kind: "jsx".to_string(),
                module: String::new(),
                start: utf16_offset(source, span.start),
                end: utf16_offset(source, span.end),
                callee_start: utf16_offset(source, span.start),
                callee_end: utf16_offset(source, span.start),
                line,
                column,
                arguments,
                complete,
                losses: Vec::new(),
            });
        }
    }
    calls.sort_by_key(|call| call.start);

    let reads = project.end_file(filename);
    Ok(NativeAnalysis {
        calls,
        dependencies: reads.dependencies,
        pending_candidates: reads.pending_candidates,
        configuration_files: reads.configuration_files,
        errors,
    })
}

#[napi]
pub fn analyze(
    filename: String,
    source: String,
    entrypoints: Vec<NativeEntrypoint>,
) -> Result<NativeAnalysis> {
    let project = ProjectEvaluator::new(
        std::iter::once((filename.as_str(), source.as_str())),
        &entrypoints,
        None,
    );
    analyze_source(&project, &filename, &source, &entrypoints, false)
}

/// Analyze a cold or incremental inventory in one N-API call. ASTs and expression graphs stay
/// in Rust; only compact extraction records cross into JavaScript.
#[napi]
pub fn analyze_many(
    sources: Vec<NativeSource>,
    entrypoints: Vec<NativeEntrypoint>,
    options: Option<NativeProjectOptions>,
) -> Result<Vec<NativeFileAnalysis>> {
    let project = ProjectEvaluator::new(
        sources
            .iter()
            .map(|source| (source.filename.as_str(), source.source.as_str())),
        &entrypoints,
        options.as_ref(),
    );
    sources
        .iter()
        .map(|source| {
            let analysis = analyze_source(
                &project,
                &source.filename,
                &source.source,
                &entrypoints,
                options.as_ref().is_some_and(|options| options.jsx),
            )?;
            Ok(NativeFileAnalysis {
                filename: source.filename.clone(),
                calls: analysis.calls,
                errors: analysis.errors,
                dependencies: analysis.dependencies,
                pending_candidates: analysis.pending_candidates,
                configuration_files: analysis.configuration_files,
            })
        })
        .collect()
}
