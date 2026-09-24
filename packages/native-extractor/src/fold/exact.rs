//! Whether an argument evaluates to exactly the value the program will produce.
//!
//! Extraction is deliberately optimistic: when a branch cannot be decided it emits rules for
//! every arm, and it omits a value it cannot evaluate rather than failing. That is right for
//! generating CSS. Rewriting source is the other direction — the call is *replaced* by the
//! value — so a guess becomes the only thing that runs. This module is the audit the fold
//! applies before trusting an evaluated argument. It mirrors the rules of the TypeScript
//! implementation it replaces (`fold-analysis.ts`), which are documented in its tests:
//!
//! - every written property must reach the value (nothing dropped as unknown);
//! - a spread must be an inline literal, or a value the evaluator fully resolved;
//! - a computed key must evaluate; a method or accessor declines;
//! - a choice (`?:`, `||`, `&&`, `??`, a comparison) must be *decided* at build time, which
//!   for a short-circuit means its left operand is written right there, not reached by name;
//! - a value reached through a destructuring default is a fallback, not a value;
//! - an unknown leaf anywhere declines.

use oxc_ast::{
    AstKind,
    ast::{
        ArrayExpressionElement, BindingPattern, Expression, LogicalOperator, ObjectPropertyKind,
        PropertyKind,
    },
};
use oxc_syntax::operator::BinaryOperator;

use crate::evaluator::{EvalResult, FileEvaluator};

/// Strip the wrappers that carry no runtime meaning.
pub(crate) fn unwrap<'a>(expression: &'a Expression<'a>) -> &'a Expression<'a> {
    match expression {
        Expression::ParenthesizedExpression(value) => unwrap(&value.expression),
        Expression::TSAsExpression(value) => unwrap(&value.expression),
        Expression::TSSatisfiesExpression(value) => unwrap(&value.expression),
        Expression::TSTypeAssertion(value) => unwrap(&value.expression),
        Expression::TSNonNullExpression(value) => unwrap(&value.expression),
        _ => expression,
    }
}

/// An expression whose evaluation cannot do anything observable, so deleting it preserves
/// behaviour. A bare identifier is a binding read, which cannot run anything.
pub(crate) fn is_inert(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::Identifier(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        Expression::ParenthesizedExpression(value) => is_inert(&value.expression),
        Expression::TSAsExpression(value) => is_inert(&value.expression),
        Expression::TSSatisfiesExpression(value) => is_inert(&value.expression),
        Expression::TSTypeAssertion(value) => is_inert(&value.expression),
        Expression::TSNonNullExpression(value) => is_inert(&value.expression),
        Expression::UnaryExpression(unary) => {
            use oxc_syntax::operator::UnaryOperator::*;
            matches!(
                unary.operator,
                UnaryNegation | UnaryPlus | LogicalNot | BitwiseNot
            ) && is_inert(&unary.argument)
        }
        // `??`, `||` and `&&` only ever evaluate their operands. Arithmetic and comparison
        // coerce, which can reach `valueOf`.
        Expression::LogicalExpression(logical) => {
            is_inert(&logical.left) && is_inert(&logical.right)
        }
        Expression::ObjectExpression(object) => {
            object.properties.iter().all(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    property.kind == PropertyKind::Init
                        && !property.method
                        && !property.computed
                        && (property.shorthand || is_inert(&property.value))
                }
                ObjectPropertyKind::SpreadProperty(_) => false,
            })
        }
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| match element {
            ArrayExpressionElement::SpreadElement(_) => false,
            ArrayExpressionElement::Elision(_) => true,
            _ => element.as_expression().is_some_and(is_inert),
        }),
        _ => false,
    }
}

/// A literal an argument can carry after the first without anything running: the leaves of
/// `is_inert`, no identifiers other than `undefined`.
pub(crate) fn is_inert_literal(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        Expression::Identifier(identifier) => identifier.name == "undefined",
        _ => false,
    }
}

/// Is this operand's value written here, rather than named?
fn is_written_here(expression: &Expression<'_>) -> bool {
    match unwrap(expression) {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::ObjectExpression(_)
        | Expression::ArrayExpression(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        Expression::UnaryExpression(unary) => {
            unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation
                && matches!(unary.argument, Expression::NumericLiteral(_))
        }
        _ => false,
    }
}

pub(crate) struct Exactness<'e, 'a, 'p, 's> {
    pub evaluator: &'e mut FileEvaluator<'a, 'p, 's>,
}

impl<'a> Exactness<'_, 'a, '_, '_> {
    /// The whole argument evaluates to exactly one value the program will produce.
    pub fn check(&mut self, expression: &'a Expression<'a>) -> bool {
        let result = self.evaluator.evaluate(expression);
        if !exact_result(&result) {
            return false;
        }
        self.accounts(expression)
    }

    /// Walks the source and requires every value in it to be exact. The evaluated result is
    /// complete by the time this runs, so the walk is about *provenance*: what the evaluator
    /// accepted but a rewrite may not.
    fn accounts(&mut self, expression: &'a Expression<'a>) -> bool {
        let inner = unwrap(expression);
        match inner {
            Expression::ConditionalExpression(conditional) => {
                let test = self.evaluator.evaluate(&conditional.test);
                // An undecided test collapses to both arms as conditions, which `exact_result`
                // already refused; a decided one is exact only through its chosen arm.
                let Some(value) = test.value else {
                    return false;
                };
                if !is_written_here(&conditional.test) && !self.value_is_stable(&conditional.test) {
                    return false;
                }
                if crate_truthy(&value) {
                    self.accounts(&conditional.consequent)
                } else {
                    self.accounts(&conditional.alternate)
                }
            }
            Expression::LogicalExpression(logical) => {
                // The left has to be written here: a box reached through a name records the
                // declaration rather than the value, and truthiness is what that changes.
                if !is_written_here(&logical.left) {
                    return false;
                }
                let left = self.evaluator.evaluate(&logical.left);
                let Some(value) = left.value else {
                    return false;
                };
                let right_wins = match logical.operator {
                    LogicalOperator::Or => !crate_truthy(&value),
                    LogicalOperator::And => crate_truthy(&value),
                    LogicalOperator::Coalesce => value.is_null(),
                };
                if right_wins {
                    self.accounts(&logical.right)
                } else {
                    self.accounts(&logical.left)
                }
            }
            // A comparison's value is a boolean the extractor computes; there is no operand for
            // it to have collapsed to. Accepted only when both sides are exact.
            Expression::BinaryExpression(binary)
                if matches!(
                    binary.operator,
                    BinaryOperator::Equality
                        | BinaryOperator::StrictEquality
                        | BinaryOperator::Inequality
                        | BinaryOperator::StrictInequality
                        | BinaryOperator::LessThan
                        | BinaryOperator::LessEqualThan
                        | BinaryOperator::GreaterThan
                        | BinaryOperator::GreaterEqualThan
                        | BinaryOperator::In
                        | BinaryOperator::Instanceof
                ) =>
            {
                false
            }
            Expression::ObjectExpression(object) => {
                for property in &object.properties {
                    match property {
                        ObjectPropertyKind::SpreadProperty(spread) => {
                            let argument = unwrap(&spread.argument);
                            if let Expression::ObjectExpression(_) = argument {
                                if !self.accounts(argument) {
                                    return false;
                                }
                                continue;
                            }
                            // A named spread: exact only when it resolved to an object and the
                            // object it resolved from is itself accounted for.
                            let value = self.evaluator.evaluate(argument);
                            if !exact_result(&value)
                                || !matches!(value.value, Some(serde_json::Value::Object(_)))
                            {
                                return false;
                            }
                            if !self.accounts(argument) {
                                return false;
                            }
                        }
                        ObjectPropertyKind::ObjectProperty(property) => {
                            if property.method || property.kind != PropertyKind::Init {
                                return false;
                            }
                            if property.computed {
                                let Some(key) = property.key.as_expression() else {
                                    return false;
                                };
                                if !exact_result(&self.evaluator.evaluate(key)) {
                                    return false;
                                }
                            }
                            // `{ display: undefined }` contributes nothing and is dropped by the
                            // encoder too.
                            if matches!(unwrap(&property.value), Expression::Identifier(id) if id.name == "undefined")
                            {
                                continue;
                            }
                            if !self.accounts(&property.value) {
                                return false;
                            }
                        }
                    }
                }
                true
            }
            Expression::ArrayExpression(array) => {
                array.elements.iter().all(|element| match element {
                    ArrayExpressionElement::SpreadElement(_) => false,
                    ArrayExpressionElement::Elision(_) => true,
                    _ => element
                        .as_expression()
                        .is_some_and(|value| self.accounts(value)),
                })
            }
            Expression::Identifier(identifier) => {
                if identifier.name == "undefined" {
                    return true;
                }
                self.identifier_is_exact(identifier)
            }
            Expression::StaticMemberExpression(member) => self.accounts(&member.object),
            Expression::ComputedMemberExpression(member) => {
                self.accounts(&member.object)
                    && exact_result(&self.evaluator.evaluate(&member.expression))
            }
            Expression::TemplateLiteral(template) => template
                .expressions
                .iter()
                .all(|expression| self.accounts(expression)),
            _ => exact_result(&self.evaluator.evaluate(inner)),
        }
    }

    /// A test reached by name is exact when the name is a `const` bound to something exact.
    fn value_is_stable(&mut self, expression: &'a Expression<'a>) -> bool {
        match unwrap(expression) {
            Expression::Identifier(identifier) => self.identifier_is_exact(identifier),
            _ => false,
        }
    }

    /// An identifier is exact unless its value came from a destructuring default, or from a
    /// binding whose initializer is itself not exact.
    fn identifier_is_exact(
        &mut self,
        identifier: &'a oxc_ast::ast::IdentifierReference<'a>,
    ) -> bool {
        let semantic = self.evaluator.semantic();
        let scoping = semantic.scoping();
        let Some(symbol) = identifier
            .reference_id
            .get()
            .and_then(|reference| scoping.get_reference(reference).symbol_id())
        else {
            return false;
        };
        if self.evaluator.is_import(symbol) {
            // Cross-module values are resolved by the evaluator from the exporting module's
            // initializer; the exactness of that initializer was established there.
            return exact_result(&self.evaluator.evaluate_symbol(symbol));
        }
        let declaration = semantic.symbol_declaration(symbol);
        match declaration.kind() {
            AstKind::VariableDeclarator(declarator) => {
                // Destructured: the value is exact only when no default on the path to the
                // name can supply it.
                if !matches!(declarator.id, BindingPattern::BindingIdentifier(_))
                    && pattern_default_reaches(&declarator.id, symbol)
                {
                    return false;
                }
                match &declarator.init {
                    Some(init) => self.accounts(init),
                    None => false,
                }
            }
            // A parameter's value is the caller's; a default is a fallback, not a value.
            AstKind::FormalParameter(_) | AstKind::CatchParameter(_) => false,
            AstKind::BindingRestElement(_) => false,
            AstKind::TSEnumDeclaration(_) => true,
            _ => {
                // A binding declared through a pattern whose node kind is the pattern element
                // (for-of heads, nested patterns) is not a plain value.
                let mut ids = semantic.nodes().ancestor_kinds(declaration.id());
                if ids.any(|kind| {
                    matches!(
                        kind,
                        AstKind::FormalParameter(_)
                            | AstKind::ForOfStatement(_)
                            | AstKind::ForInStatement(_)
                            | AstKind::AssignmentPattern(_)
                    )
                }) {
                    return false;
                }
                exact_result(&self.evaluator.evaluate_symbol(symbol))
            }
        }
    }
}

/// Whether any `= default` in the pattern sits on the path to `symbol`.
fn pattern_default_reaches(
    pattern: &BindingPattern<'_>,
    symbol: oxc_syntax::symbol::SymbolId,
) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(_) => false,
        BindingPattern::AssignmentPattern(assignment) => {
            binds(&assignment.left, symbol) || pattern_default_reaches(&assignment.left, symbol)
        }
        BindingPattern::ObjectPattern(object) => {
            object
                .properties
                .iter()
                .any(|property| pattern_default_reaches(&property.value, symbol))
                || object
                    .rest
                    .as_ref()
                    .is_some_and(|rest| pattern_default_reaches(&rest.argument, symbol))
        }
        BindingPattern::ArrayPattern(array) => {
            array
                .elements
                .iter()
                .flatten()
                .any(|element| pattern_default_reaches(element, symbol))
                || array
                    .rest
                    .as_ref()
                    .is_some_and(|rest| pattern_default_reaches(&rest.argument, symbol))
        }
    }
}

fn binds(pattern: &BindingPattern<'_>, symbol: oxc_syntax::symbol::SymbolId) -> bool {
    pattern
        .get_binding_identifiers()
        .iter()
        .any(|identifier| identifier.symbol_id.get() == Some(symbol))
}

/// Complete, a single value, no condition fragments.
pub(crate) fn exact_result(result: &EvalResult) -> bool {
    result.complete && result.conditions.is_empty()
}

fn crate_truthy(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(value) => value
            .as_f64()
            .is_some_and(|value| value != 0.0 && !value.is_nan()),
        serde_json::Value::String(value) => !value.is_empty(),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => true,
    }
}
