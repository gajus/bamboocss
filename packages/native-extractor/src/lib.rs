use std::collections::HashMap;

use evaluator::{
    EvalResult, FileEvaluator, Fragments, ProjectEvaluator, spread_value, write_property,
};
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
use oxc_semantic::{AstNodes, NodeId, Scoping, SemanticBuilder};
use oxc_span::GetSpan;
use oxc_syntax::{operator::UnaryOperator, symbol::SymbolId};

mod cache;
mod evaluator;
mod fold;
mod names;
mod offsets;
mod token_accounting;

pub use token_accounting::{NativeTokenAccounting, NativeTokenDecline};

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
    /// Keys written at the top level of the first argument (or as JSX attributes) whose value
    /// the build could not read. A config recipe needs them: `button({ size })` with a dynamic
    /// `size` and `button()` both arrive as `{}`, and only the first must emit every size.
    pub unresolved_keys: Vec<String>,
    /// What a call returns that the build knows: the name of a `keyframes()` whose stops it
    /// read whole, the name the stylesheet writes on its block.
    pub value: Option<String>,
    /// A `token()` call whose result is tested or defaulted rather than used as it is. See
    /// `result_guarded`.
    pub guarded: bool,
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
    /// The class prefix a `keyframes()` name is written after: `app-kf_feVUdh`.
    pub class_prefix: Option<String>,
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
    arguments: &'a [Argument<'a>],
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
    for value in &mut output {
        drop_nullish_properties(value);
    }
    (output, complete)
}

/// Whether a call's result is tested or defaulted rather than used as it is: the left of `??`,
/// `||` or `&&`, a conditional's or an `if`'s test, the operand of `!` or `typeof`, or a side of
/// an equality. A `token()` call there asks whether its token exists — with the fallback argument
/// retired, `token('colors.brand') ?? '#fff'` is how a path that may name nothing is written — so
/// naming nothing is a case its author handled, not a mistake.
pub(crate) fn result_guarded(nodes: &AstNodes<'_>, call: NodeId) -> bool {
    let mut current = call;
    loop {
        let span = nodes.kind(current).span();
        let parent = nodes.parent_id(current);
        if parent == current {
            return false;
        }
        match nodes.kind(parent) {
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSTypeAssertion(_) => current = parent,
            AstKind::LogicalExpression(logical) => return logical.left.span() == span,
            AstKind::ConditionalExpression(conditional) => return conditional.test.span() == span,
            AstKind::IfStatement(statement) => return statement.test.span() == span,
            AstKind::UnaryExpression(unary) => {
                return matches!(
                    unary.operator,
                    UnaryOperator::LogicalNot | UnaryOperator::Typeof
                );
            }
            AstKind::BinaryExpression(binary) => return binary.operator.is_equality(),
            _ => return false,
        }
    }
}

/// Style data carries no nullish declarations.
///
/// `{ color: null }` and `{ color: undefined }` declare nothing, and `undefined` already has no
/// JSON form, so keeping `null` made the two spellings of one declaration differ — two inline
/// recipes that name the same class then conflict. Evaluation keeps `null` (`??` needs it);
/// only the data handed to the encoder drops it.
pub(crate) fn drop_nullish_properties(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(object) => {
            object.retain(|_, value| !value.is_null());
            for value in object.values_mut() {
                drop_nullish_properties(value);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                drop_nullish_properties(value);
            }
        }
        _ => {}
    }
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
        // `<Tabs.Root>`: a recipe's `jsx` patterns match the dotted name as written.
        JSXElementName::MemberExpression(member) => {
            let name = jsx_member_name(member)?;
            Some((name.clone(), name))
        }
        _ => None,
    }
}

fn jsx_member_name(member: &oxc_ast::ast::JSXMemberExpression<'_>) -> Option<String> {
    use oxc_ast::ast::JSXMemberExpressionObject;
    let object = match &member.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => identifier.name.to_string(),
        JSXMemberExpressionObject::MemberExpression(inner) => jsx_member_name(inner)?,
        JSXMemberExpressionObject::ThisExpression(_) => return None,
    };
    Some(format!("{object}.{}", member.property.name))
}

fn jsx_data<'a>(
    attributes: &'a oxc_allocator::Vec<'a, JSXAttributeItem<'a>>,
    evaluator: &mut FileEvaluator<'a, '_, '_>,
) -> (Vec<serde_json::Value>, bool) {
    // Attributes are written as an object literal's properties are, a spread as a spread.
    let mut object = serde_json::Map::new();
    let mut fragments = Fragments::default();
    let mut partial = None;
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
                        refusal: None,
                        partial: None,
                        nullish: false,
                    },
                    Some(JSXAttributeValue::StringLiteral(value)) => EvalResult {
                        value: Some(value.value.to_string().into()),
                        conditions: Vec::new(),
                        complete: true,
                        refusal: None,
                        partial: None,
                        nullish: false,
                    },
                    Some(JSXAttributeValue::ExpressionContainer(container)) => {
                        evaluator.evaluate_jsx_expression(&container.expression)
                    }
                    _ => EvalResult::unknown(),
                };
                complete &= value.complete;
                write_property(&mut object, &mut fragments, &mut partial, key, value);
            }
            JSXAttributeItem::SpreadAttribute(spread) => {
                let value = evaluator.evaluate(&spread.argument);
                complete &= value.complete;
                spread_value(
                    &mut object,
                    &mut fragments,
                    &mut partial,
                    &mut complete,
                    value,
                );
            }
        }
    }
    let mut conditions = fragments.list;
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

/// Top-level keys of an object literal whose value evaluated to nothing at all.
fn unresolved_object_keys<'a>(
    expression: &'a Expression<'a>,
    evaluator: &mut FileEvaluator<'a, '_, '_>,
) -> Vec<String> {
    let Expression::ObjectExpression(object) = unwrap_expression(expression) else {
        return Vec::new();
    };
    let mut keys = Vec::new();
    for property in &object.properties {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        if property.computed || property.method {
            continue;
        }
        let Some(key) = property.key.static_name() else {
            continue;
        };
        let value = evaluator.evaluate(&property.value);
        if value.value.is_none() && value.conditions.is_empty() {
            keys.push(key.into_owned());
        }
    }
    keys
}

/// JSX attributes whose value evaluated to nothing at all.
fn unresolved_jsx_keys<'a>(
    attributes: &'a oxc_allocator::Vec<'a, JSXAttributeItem<'a>>,
    evaluator: &mut FileEvaluator<'a, '_, '_>,
) -> Vec<String> {
    let mut keys = Vec::new();
    for attribute in attributes {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            continue;
        };
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            continue;
        };
        if let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value {
            let value = evaluator.evaluate_jsx_expression(&container.expression);
            if value.value.is_none() && value.conditions.is_empty() {
                keys.push(name.name.to_string());
            }
        }
    }
    keys
}

/// `name.raw` where `name` is a binding initialized by a `cva`/`sva` call.
fn inline_recipe_raw<'a>(
    callee: &Expression<'a>,
    evaluator: &FileEvaluator<'a, '_, '_>,
    named: &NamedBindings,
    namespaces: &NamespaceBindings,
    entrypoints: &[NativeEntrypoint],
) -> Option<String> {
    let Expression::StaticMemberExpression(member) = unwrap_expression(callee) else {
        return None;
    };
    if member.property.name != "raw" {
        return None;
    }
    let Expression::Identifier(object) = unwrap_expression(&member.object) else {
        return None;
    };
    let semantic = evaluator.semantic();
    let symbol = semantic
        .scoping()
        .get_reference(object.reference_id.get()?)
        .symbol_id()?;
    let AstKind::VariableDeclarator(declarator) = semantic.symbol_declaration(symbol).kind() else {
        return None;
    };
    let Expression::CallExpression(init) = unwrap_expression(declarator.init.as_ref()?) else {
        return None;
    };
    let (binding, _) = classify_call(
        &init.callee,
        semantic.scoping(),
        named,
        namespaces,
        entrypoints,
    )?;
    (binding.kind == "css" && matches!(binding.imported_name.as_str(), "cva" | "sva"))
        .then(|| object.name.to_string())
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
        } else if binding.kind == "css"
            && binding.imported_name == "css"
            && let Expression::CallExpression(inner) = unwrap_expression(expression)
            && let Some(name) =
                inline_recipe_raw(&inner.callee, evaluator, named, namespaces, entrypoints)
        {
            // `textInput.raw()` on a recipe this module declared with `cva`/`sva`.
            losses.push(NativeLoss {
                prop: Some(name),
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
        } else if ((binding.kind == "css" && binding.imported_name == "css")
            || binding.kind == "pattern")
            && let Expression::ObjectExpression(object) = unwrap_expression(expression)
        {
            for property in &object.properties {
                // A written key whose value the evaluator could not read disappears from the
                // data without a trace — `css({ color: tone })` reached the stylesheet as
                // `{}`, reported complete with no loss, so nothing warned and nothing failed.
                // The same check the recipe path already makes, at the top level: nested
                // values that are unknown already surface as a condition or an incomplete
                // parent, which this catches through their key.
                if let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property
                    && !property.method
                    && let Some(key) = if property.computed {
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
                    }
                {
                    let value = evaluator.evaluate(&property.value);
                    if value.value.is_none() && value.conditions.is_empty() && !value.complete {
                        losses.push(NativeLoss {
                            prop: Some(key),
                            reason: "missing-property".to_string(),
                        });
                    }
                }
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
    let parsed = evaluator::parse_source(&allocator, source, filename);
    let errors: Vec<_> = parsed.diagnostics.iter().map(ToString::to_string).collect();
    // Scope diagnostics — a name declared twice, say — are the type checker's business, not
    // extraction's. A Svelte component's module and instance scripts can both declare one type,
    // which Svelte compiles; failing the file here dropped every style in it.
    let semantic = SemanticBuilder::new_compiler()
        .with_build_nodes(true)
        .build(&parsed.program)
        .semantic;
    let scoping = semantic.scoping();
    let (named, namespaces, jsx_aliases) = collect_bindings(&parsed.program, entrypoints);
    project.begin_file(filename);
    let mut evaluator = FileEvaluator::new(filename, project, &semantic, &parsed.program);
    let mut calls = Vec::new();
    let positions = offsets::Positions::new(source);

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

        // A token's path is its first argument. Whatever follows is the retired fallback, which the
        // runtime ignores, and read as one more path `token('colors.x', '#fff')` would name `#fff`
        // — or, dynamic, would leave the path itself undecided.
        let read = if matches!(binding.kind.as_str(), "token" | "tokenValue") {
            &expression.arguments[..expression.arguments.len().min(1)]
        } else {
            &expression.arguments[..]
        };
        let (arguments, complete) = argument_data(read, &mut evaluator);
        let value = (binding.kind == "css"
            && binding.imported_name == "keyframes"
            && complete
            && arguments.len() == 1)
            .then(|| arguments.first())
            .flatten()
            .filter(|stops| stops.is_object())
            .map(|stops| project.keyframes_name(stops));
        let unresolved_keys = if binding.kind == "recipe" {
            expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .map(|argument| unresolved_object_keys(argument, &mut evaluator))
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let losses = call_losses(
            expression,
            &binding,
            &mut evaluator,
            &named,
            &namespaces,
            entrypoints,
        );
        let span = expression.span();
        let (line, column) = positions.line_and_column(span.start);
        let kind = if !binding.supported && matches!(binding.kind.as_str(), "pattern" | "recipe") {
            "dead".to_string()
        } else {
            binding.kind
        };
        let callee_span = callee_root_span(&expression.callee);
        let guarded = matches!(kind.as_str(), "token" | "tokenValue")
            && result_guarded(semantic.nodes(), node.id());
        calls.push(NativeCall {
            name: display,
            imported_name: binding.imported_name,
            kind,
            module: binding.module,
            start: positions.utf16(span.start),
            end: positions.utf16(span.end),
            callee_start: positions.utf16(callee_span.start),
            callee_end: positions.utf16(callee_span.end),
            line,
            column,
            arguments,
            complete,
            losses,
            unresolved_keys,
            value,
            guarded,
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
            let unresolved_keys = unresolved_jsx_keys(&element.attributes, &mut evaluator);
            let (arguments, complete) = jsx_data(&element.attributes, &mut evaluator);
            let span = element.span();
            let (line, column) = positions.line_and_column(span.start);
            calls.push(NativeCall {
                name: local,
                imported_name: canonical,
                kind: "jsx".to_string(),
                module: String::new(),
                start: positions.utf16(span.start),
                end: positions.utf16(span.end),
                callee_start: positions.utf16(span.start),
                callee_end: positions.utf16(span.start),
                line,
                column,
                arguments,
                complete,
                losses: Vec::new(),
                unresolved_keys,
                value: None,
                guarded: false,
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

// Every export catches a panic, `#[napi(catch_unwind)]`, and throws it in JavaScript as an error.
// One unwinding into N-API instead ends the process, which is the dev server.

/// Armed by `__panicNext`: the next call into an entry point panics as it starts.
static PANIC_NEXT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn panic_if_asked() {
    use std::sync::atomic::Ordering::Relaxed;
    if PANIC_NEXT.load(Relaxed) && PANIC_NEXT.swap(false, Relaxed) {
        // Without the panic hook, which would print a panic nobody needs to read about.
        std::panic::resume_unwind(Box::new("a panic `__panicNext` asked for"));
    }
}

/// For the tests, and not part of the API: the next call into `analyze`, `analyzeMany`,
/// `accountTokens` or `compileModules` panics, as a bug in it would.
#[napi(catch_unwind, js_name = "__panicNext")]
pub fn panic_next() {
    PANIC_NEXT.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// For the tests: poison the lock of every cache native calls share, as a panic caught while a
/// call held one would.
#[napi(catch_unwind, js_name = "__poisonCaches")]
pub fn poison_caches() {
    evaluator::poison_caches();
    fold::poison_caches();
}

/// For the tests: how many lookups the caches native calls share have answered.
#[napi(catch_unwind, js_name = "__cacheHits")]
pub fn cache_hits() -> i64 {
    (evaluator::cache_hits() + fold::cache_hits()) as i64
}

#[napi(catch_unwind)]
pub fn analyze(
    filename: String,
    source: String,
    entrypoints: Vec<NativeEntrypoint>,
) -> Result<NativeAnalysis> {
    panic_if_asked();
    let project = ProjectEvaluator::new(
        std::iter::once((filename.as_str(), source.as_str())),
        &entrypoints,
        None,
    );
    analyze_source(&project, &filename, &source, &entrypoints, false)
}

/// Analyze a cold or incremental inventory in one N-API call. ASTs and expression graphs stay
/// in Rust; only compact extraction records cross into JavaScript.
#[napi(catch_unwind)]
pub fn analyze_many(
    sources: Vec<NativeSource>,
    entrypoints: Vec<NativeEntrypoint>,
    options: Option<NativeProjectOptions>,
) -> Result<Vec<NativeFileAnalysis>> {
    panic_if_asked();
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

/// Token accounting for one file: the token paths it asks for, the prefixes a template literal
/// bounds, and every reference the build cannot follow. See `token_accounting.rs`.
///
/// `tokenModules` are the configured tokens entrypoints; `pathMappings` are the tsconfig
/// `paths`, resolved so a specifier mapped onto the artifact counts as the artifact.
#[napi(catch_unwind)]
pub fn account_tokens(
    filename: String,
    source: String,
    token_modules: Vec<String>,
    path_mappings: Option<Vec<NativePathMapping>>,
) -> Result<NativeTokenAccounting> {
    panic_if_asked();
    let mappings = path_mappings.unwrap_or_default();
    let is_entrypoint = |specifier: &str| {
        if token_modules
            .iter()
            .any(|module| specifier.contains(module.as_str()))
        {
            return true;
        }
        mappings.iter().any(|mapping| {
            resolve_path_pattern(&mapping.pattern, &mapping.paths, specifier).is_some_and(
                |resolved| {
                    token_modules
                        .iter()
                        .any(|module| resolved.contains(module.as_str()) || resolved == *module)
                },
            )
        })
    };
    Ok(token_accounting::account(
        &source,
        &filename,
        &is_entrypoint,
    ))
}

/// A tsconfig `paths` pattern applied to a specifier, the way `resolveTsPathPattern` does it:
/// `@/*` → `./src/*` maps `@/tokens` to `./src/tokens`. The first template wins.
fn resolve_path_pattern(pattern: &str, templates: &[String], specifier: &str) -> Option<String> {
    let captured = match pattern.split_once('*') {
        Some((prefix, suffix)) => specifier
            .strip_prefix(prefix)
            .and_then(|rest| rest.strip_suffix(suffix))?,
        None if pattern == specifier => "",
        None => return None,
    };
    templates
        .first()
        .map(|template| template.replace('*', captured))
}

/// Options for `compileModules`.
#[napi(object)]
pub struct NativeFoldOptions {
    pub cwd: Option<String>,
    pub base_url: Option<String>,
    pub paths: Vec<NativePathMapping>,
    pub tokens: Vec<NativeToken>,
    pub css_modules: Vec<String>,
    pub token_modules: Vec<String>,
    pub recipe_modules: Vec<String>,
    pub pattern_modules: Vec<String>,
    pub recipe_names: Vec<String>,
    pub pattern_names: Vec<String>,
    /// Collect survivor-check references and runtime shapes. Off for a provisional re-fold.
    pub references: bool,
    /// The class prefix a `keyframes()` name is written after.
    pub class_prefix: Option<String>,
}

/// Per-module facts for the Vite compiler, for each of `sources`. See `fold/model.rs`.
///
/// `sources` are the modules to analyze; `auxiliary` are modules whose bytes differ from disk
/// (a `parser:before` output, an unsaved buffer) and which a cross-module read must see as-is.
#[napi(catch_unwind)]
pub fn compile_modules(
    sources: Vec<NativeSource>,
    auxiliary: Vec<NativeSource>,
    options: NativeFoldOptions,
) -> Result<Vec<fold::model::FoldAnalysis>> {
    panic_if_asked();
    let entrypoints = vec![
        NativeEntrypoint {
            kind: "css".into(),
            modules: options.css_modules.clone(),
            names: vec![
                "css".into(),
                "cva".into(),
                "sva".into(),
                "cx".into(),
                "fallback".into(),
                "viewTransition".into(),
                "keyframes".into(),
            ],
        },
        NativeEntrypoint {
            kind: "token".into(),
            modules: options.token_modules.clone(),
            names: vec!["token".into()],
        },
        NativeEntrypoint {
            kind: "recipe".into(),
            modules: options.recipe_modules.clone(),
            names: options.recipe_names.clone(),
        },
        NativeEntrypoint {
            kind: "pattern".into(),
            modules: options.pattern_modules.clone(),
            names: options.pattern_names.clone(),
        },
    ];
    let project_options = NativeProjectOptions {
        cwd: options.cwd.clone(),
        base_url: options.base_url.clone(),
        paths: options
            .paths
            .iter()
            .map(|mapping| NativePathMapping {
                pattern: mapping.pattern.clone(),
                paths: mapping.paths.clone(),
            })
            .collect(),
        tokens: options
            .tokens
            .iter()
            .map(|token| NativeToken {
                path: token.path.clone(),
                value: token.value.clone(),
                variable: token.variable.clone(),
            })
            .collect(),
        jsx: false,
        class_prefix: options.class_prefix.clone(),
    };
    let project = ProjectEvaluator::new(
        sources
            .iter()
            .chain(auxiliary.iter())
            .map(|source| (source.filename.as_str(), source.source.as_str())),
        &entrypoints,
        Some(&project_options),
    );
    let recipe_names: std::collections::HashSet<String> =
        options.recipe_names.iter().cloned().collect();
    let pattern_names: std::collections::HashSet<String> =
        options.pattern_names.iter().cloned().collect();
    let fold_entrypoints = fold::FoldEntrypoints {
        css: &options.css_modules,
        tokens: &options.token_modules,
        recipes: &options.recipe_modules,
        patterns: &options.pattern_modules,
        recipe_names: &recipe_names,
        pattern_names: &pattern_names,
    };
    Ok(sources
        .iter()
        .map(|source| {
            fold::analyze_module(
                &project,
                &source.filename,
                &source.source,
                &fold_entrypoints,
                options.references,
            )
        })
        .collect())
}
