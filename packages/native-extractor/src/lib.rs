use std::collections::{HashMap, HashSet};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, CallExpression, Expression, ImportDeclarationSpecifier, ObjectPropertyKind,
    Statement, VariableDeclaration, VariableDeclarationKind,
};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::{GetSpan, SourceType};
use oxc_syntax::symbol::SymbolId;

#[napi(object)]
pub struct NativeEntrypoint {
    pub kind: String,
    pub modules: Vec<String>,
    /// The configured callable exports for this entrypoint.
    pub names: Vec<String>,
}

#[napi(object)]
pub struct NativeCall {
    /// The local binding at the call site.
    pub name: String,
    /// The name exported by the Bamboo entrypoint.
    pub imported_name: String,
    pub kind: String,
    pub start: u32,
    pub end: u32,
    pub line: u32,
    pub column: u32,
    pub arguments: Vec<serde_json::Value>,
    pub complete: bool,
}

#[napi(object)]
pub struct NativeAnalysis {
    pub calls: Vec<NativeCall>,
    pub errors: Vec<String>,
    /// True only when this file can bypass the TypeScript extractor without losing semantics.
    pub safe: bool,
    pub fallback_reason: Option<String>,
}

#[napi(object)]
pub struct NativeSource {
    pub filename: String,
    pub source: String,
}

#[napi(object)]
pub struct NativeFileAnalysis {
    pub filename: String,
    pub calls: Vec<NativeCall>,
    pub errors: Vec<String>,
    pub safe: bool,
    pub fallback_reason: Option<String>,
}

fn is_javascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000d}'
            | '\u{0020}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

fn normalize_whitespace(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut whitespace = false;
    for character in value.chars() {
        if is_javascript_whitespace(character) {
            if !whitespace {
                output.push(' ');
                whitespace = true;
            }
        } else {
            output.push(character);
            whitespace = false;
        }
    }
    output
}

fn literal_value(
    expression: &Expression<'_>,
    scoping: &Scoping,
    constants: &HashMap<SymbolId, serde_json::Value>,
) -> Option<serde_json::Value> {
    match expression {
        Expression::BooleanLiteral(value) => Some(value.value.into()),
        Expression::NullLiteral(_) => Some(serde_json::Value::Null),
        Expression::NumericLiteral(value) => {
            serde_json::Number::from_f64(value.value).map(Into::into)
        }
        Expression::StringLiteral(value) => Some(normalize_whitespace(value.value.as_str()).into()),
        Expression::TemplateLiteral(value) if value.expressions.is_empty() => value
            .quasis
            .first()
            .and_then(|quasi| quasi.value.cooked.as_ref())
            .map(|value| normalize_whitespace(value.as_str()).into()),
        Expression::ArrayExpression(value) => {
            let mut output = Vec::with_capacity(value.elements.len());
            for element in &value.elements {
                match element {
                    oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
                        let serde_json::Value::Array(values) =
                            literal_value(&spread.argument, scoping, constants)?
                        else {
                            return None;
                        };
                        output.extend(values);
                    }
                    oxc_ast::ast::ArrayExpressionElement::Elision(_) => return None,
                    _ => output.push(literal_value(element.as_expression()?, scoping, constants)?),
                }
            }
            Some(output.into())
        }
        Expression::ObjectExpression(value) => {
            let mut output = serde_json::Map::with_capacity(value.properties.len());
            for property in &value.properties {
                match property {
                    ObjectPropertyKind::ObjectProperty(property) => {
                        if property.computed || property.method {
                            return None;
                        }
                        output.insert(
                            property.key.static_name()?.into_owned(),
                            literal_value(&property.value, scoping, constants)?,
                        );
                    }
                    ObjectPropertyKind::SpreadProperty(spread) => {
                        let serde_json::Value::Object(values) =
                            literal_value(&spread.argument, scoping, constants)?
                        else {
                            return None;
                        };
                        output.extend(values);
                    }
                }
            }
            Some(output.into())
        }
        Expression::Identifier(identifier) => {
            let reference = identifier.reference_id.get()?;
            let symbol = scoping.get_reference(reference).symbol_id()?;
            constants.get(&symbol).cloned()
        }
        Expression::ParenthesizedExpression(value) => {
            literal_value(&value.expression, scoping, constants)
        }
        Expression::TSAsExpression(value) => literal_value(&value.expression, scoping, constants),
        Expression::TSSatisfiesExpression(value) => {
            literal_value(&value.expression, scoping, constants)
        }
        Expression::TSTypeAssertion(value) => literal_value(&value.expression, scoping, constants),
        Expression::TSNonNullExpression(value) => {
            literal_value(&value.expression, scoping, constants)
        }
        _ => None,
    }
}

struct DeclarationVisitor<'s> {
    constants: HashMap<SymbolId, serde_json::Value>,
    scoping: &'s Scoping,
}

impl<'a> Visit<'a> for DeclarationVisitor<'_> {
    fn visit_variable_declaration(&mut self, declaration: &VariableDeclaration<'a>) {
        if declaration.kind == VariableDeclarationKind::Const {
            for declarator in &declaration.declarations {
                if let (Some(binding), Some(expression)) =
                    (declarator.id.get_binding_identifier(), &declarator.init)
                    && let Some(symbol) = binding.symbol_id.get()
                    && let Some(value) = literal_value(expression, self.scoping, &self.constants)
                {
                    self.constants.insert(symbol, value);
                }
            }
        }
        walk::walk_variable_declaration(self, declaration);
    }
}

struct CallVisitor<'s> {
    bindings: HashMap<SymbolId, (String, String)>,
    imported_symbols: HashSet<SymbolId>,
    constants: HashMap<SymbolId, serde_json::Value>,
    scoping: &'s Scoping,
    calls: Vec<NativeCall>,
    calls_by_binding: HashMap<SymbolId, usize>,
    unsafe_import_call: bool,
}

impl<'a> Visit<'a> for CallVisitor<'_> {
    fn visit_call_expression(&mut self, expression: &CallExpression<'a>) {
        let member_callee = matches!(
            expression.callee,
            Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_)
        );
        let imported_callee = match &expression.callee {
            Expression::Identifier(identifier) => identifier
                .reference_id
                .get()
                .and_then(|reference| self.scoping.get_reference(reference).symbol_id()),
            Expression::StaticMemberExpression(member) => member
                .object
                .get_identifier_reference()
                .and_then(|identifier| {
                    identifier
                        .reference_id
                        .get()
                        .and_then(|reference| self.scoping.get_reference(reference).symbol_id())
                }),
            Expression::ComputedMemberExpression(member) => member
                .object
                .get_identifier_reference()
                .and_then(|identifier| {
                    identifier
                        .reference_id
                        .get()
                        .and_then(|reference| self.scoping.get_reference(reference).symbol_id())
                }),
            _ => None,
        };
        if imported_callee.is_some_and(|symbol| {
            self.imported_symbols.contains(&symbol)
                && (member_callee || !self.bindings.contains_key(&symbol))
        }) {
            self.unsafe_import_call = true;
        }

        if let Expression::Identifier(identifier) = &expression.callee
            && let Some(reference_id) = identifier.reference_id.get()
            && let Some(symbol_id) = self.scoping.get_reference(reference_id).symbol_id()
            && let Some((kind, imported_name)) = self.bindings.get(&symbol_id)
        {
            // `cx` only joins class strings. It is relevant to the Vite fold but contributes
            // no stylesheet data, so observing its binding use is enough for cold extraction.
            if imported_name == "cx" {
                *self.calls_by_binding.entry(symbol_id).or_default() += 1;
                walk::walk_call_expression(self, expression);
                return;
            }
            let span = expression.span();
            let mut complete = true;
            let arguments = expression
                .arguments
                .iter()
                .filter_map(|argument| match argument {
                    Argument::SpreadElement(_) => {
                        complete = false;
                        None
                    }
                    _ => {
                        let value = argument.as_expression().and_then(|expression| {
                            literal_value(expression, self.scoping, &self.constants)
                        });
                        if value.is_none() {
                            complete = false;
                        }
                        value
                    }
                })
                .collect();
            *self.calls_by_binding.entry(symbol_id).or_default() += 1;
            self.calls.push(NativeCall {
                name: identifier.name.to_string(),
                imported_name: imported_name.clone(),
                kind: kind.clone(),
                start: span.start,
                end: span.end,
                // Filled from the source once traversal has completed.
                line: 0,
                column: 0,
                arguments,
                complete,
            });
        }
        walk::walk_call_expression(self, expression);
    }
}

fn analyze_source(
    filename: &str,
    source: &str,
    entrypoints: &[NativeEntrypoint],
) -> Result<NativeAnalysis> {
    let source_type = SourceType::from_path(filename)
        .map_err(|error| Error::new(Status::InvalidArg, error.to_string()))?;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    let mut errors: Vec<_> = parsed.diagnostics.iter().map(ToString::to_string).collect();
    let semantic = SemanticBuilder::new_compiler().build(&parsed.program);
    errors.extend(semantic.diagnostics.iter().map(ToString::to_string));
    let scoping = semantic.semantic.scoping();
    let mut bindings = HashMap::new();
    let mut imported_symbols = HashSet::new();
    let mut has_entrypoint_import = false;
    for statement in &parsed.program.body {
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
        has_entrypoint_import = true;
        for specifier in declaration.specifiers.iter().flatten() {
            if let Some(symbol) = specifier.local().symbol_id.get() {
                imported_symbols.insert(symbol);
            }
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                // Namespace and default imports need property/default binding semantics. Falling
                // back is safer than treating either as an ordinary named call.
                continue;
            };
            let imported = specifier.imported.name();
            if !entrypoint
                .names
                .iter()
                .any(|name| name == imported.as_str())
            {
                continue;
            }
            let Some(symbol_id) = specifier.local.symbol_id.get() else {
                continue;
            };
            bindings.insert(symbol_id, (entrypoint.kind.clone(), imported.to_string()));
        }
    }
    let mut declarations = DeclarationVisitor {
        constants: HashMap::new(),
        scoping,
    };
    declarations.visit_program(&parsed.program);
    let mut visitor = CallVisitor {
        bindings,
        imported_symbols,
        constants: declarations.constants,
        scoping,
        calls: Vec::new(),
        calls_by_binding: HashMap::new(),
        unsafe_import_call: false,
    };
    visitor.visit_program(&parsed.program);
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
    for call in &mut visitor.calls {
        let start = call.start as usize;
        let line_index = line_starts.partition_point(|line_start| *line_start <= start) - 1;
        call.line = line_index as u32 + 1;
        call.column = source[line_starts[line_index]..start]
            .encode_utf16()
            .count() as u32
            + 1;
    }
    let every_entrypoint_use_is_accounted = visitor.imported_symbols.iter().all(|symbol| {
        let references = scoping.get_resolved_reference_ids(*symbol).len();
        match visitor.bindings.get(symbol) {
            Some(_) => {
                references
                    == visitor
                        .calls_by_binding
                        .get(symbol)
                        .copied()
                        .unwrap_or_default()
            }
            None => references == 0,
        }
    });
    let supported_calls = visitor.calls.iter().all(|call| {
        call.complete
            && (call.kind == "pattern"
                || call.kind == "recipe"
                || (call.kind == "css"
                    && matches!(call.imported_name.as_str(), "css" | "cva" | "sva")))
    });
    let fallback_reason = if !errors.is_empty() {
        Some("diagnostic".to_string())
    } else if !has_entrypoint_import {
        // A module with no direct Bamboo entrypoint cannot contribute stylesheet data. It may
        // call an imported inline recipe, but that call only selects classes whose rules are
        // emitted by the recipe's declaration; Vite reparses the call module when folding.
        None
    } else if visitor.unsafe_import_call {
        Some("unknown-entrypoint-call".to_string())
    } else if !every_entrypoint_use_is_accounted {
        Some("non-call-binding-use".to_string())
    } else if !supported_calls {
        Some("unsupported-call".to_string())
    } else {
        None
    };
    Ok(NativeAnalysis {
        calls: visitor.calls,
        errors,
        safe: fallback_reason.is_none(),
        fallback_reason,
    })
}

#[napi]
pub fn analyze(
    filename: String,
    source: String,
    entrypoints: Vec<NativeEntrypoint>,
) -> Result<NativeAnalysis> {
    analyze_source(&filename, &source, &entrypoints)
}

/// Analyze a cold inventory in one N-API call. The AST never crosses into JavaScript; each
/// source is dropped after its compact call records have been copied into the result.
#[napi]
pub fn analyze_many(
    sources: Vec<NativeSource>,
    entrypoints: Vec<NativeEntrypoint>,
) -> Result<Vec<NativeFileAnalysis>> {
    sources
        .iter()
        .map(|source| {
            let analysis = analyze_source(&source.filename, &source.source, &entrypoints)?;
            Ok(NativeFileAnalysis {
                filename: source.filename.clone(),
                calls: analysis.calls,
                errors: analysis.errors,
                safe: analysis.safe,
                fallback_reason: analysis.fallback_reason,
            })
        })
        .collect()
}
