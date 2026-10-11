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
//! - a choice (`?:`, `||`, `&&`, `??`, a comparison) must be *decided* at build time: its
//!   deciding operand written right there, or reached by a name whose value is itself exact —
//!   and `undefined`, an option nobody passed, decides as surely as a value;
//! - a property read off an object literal answers for that property alone: its siblings may be
//!   unknown, but nothing written after it may replace it;
//! - a value reached through a destructuring default is a fallback, not a value;
//! - an unknown leaf anywhere declines.

use oxc_ast::{
    AstKind,
    ast::{
        ArrayExpressionElement, BindingPattern, Expression, LogicalOperator, ObjectPropertyKind,
        PropertyKey, PropertyKind,
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
                let Some(truthy) = test.truthiness().filter(|_| exact_result(&test)) else {
                    return false;
                };
                if !self.decides(&conditional.test) {
                    return false;
                }
                if truthy {
                    self.accounts(&conditional.consequent)
                } else {
                    self.accounts(&conditional.alternate)
                }
            }
            Expression::LogicalExpression(logical) => {
                if !self.decides(&logical.left) {
                    return false;
                }
                let left = self.evaluator.evaluate(&logical.left);
                if !exact_result(&left) {
                    return false;
                }
                let right_wins = match &left.value {
                    Some(value) => match logical.operator {
                        LogicalOperator::Or => !crate_truthy(value),
                        LogicalOperator::And => crate_truthy(value),
                        LogicalOperator::Coalesce => value.is_null(),
                    },
                    // `undefined`: falsy, and nullish.
                    None if left.is_undefined() => logical.operator != LogicalOperator::And,
                    None => return false,
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
            Expression::StaticMemberExpression(member) => self.member_read(inner, &member.object),
            Expression::ComputedMemberExpression(member) => {
                if literal_key(&member.expression).is_some() {
                    self.member_read(inner, &member.object)
                } else {
                    self.accounts(&member.object)
                        && exact_result(&self.evaluator.evaluate(&member.expression))
                }
            }
            Expression::TemplateLiteral(template) => template
                .expressions
                .iter()
                .all(|expression| self.accounts(expression)),
            _ => exact_result(&self.evaluator.evaluate(inner)),
        }
    }

    /// Whether the operand deciding a choice is known for what it is: written right there, or
    /// reached by a name — a binding, or a property path off one — whose value is itself exact.
    ///
    /// A name used to be refused outright: a value reached through one recorded the declaration
    /// rather than the value, and truthiness is what that changes. A binding written after its
    /// declaration is refused now (`is_mutated`), as is a parameter, whose value is the caller's,
    /// so a name the audit accounts for holds what its declaration says. `o.display ?? 'block'`
    /// on a module's own options object no longer fails the compile.
    fn decides(&mut self, expression: &'a Expression<'a>) -> bool {
        match unwrap(expression) {
            Expression::Identifier(_) | Expression::StaticMemberExpression(_) => {
                self.accounts(expression)
            }
            Expression::ComputedMemberExpression(member)
                if literal_key(&member.expression).is_some() =>
            {
                self.accounts(expression)
            }
            _ => is_written_here(expression),
        }
    }

    /// A property read: exact through that property's own source, where the source can be
    /// followed to it, and otherwise only if the whole receiver is.
    fn member_read(&mut self, read: &'a Expression<'a>, receiver: &'a Expression<'a>) -> bool {
        match self.property_source(read, Vec::new()) {
            MemberSource::Property(value) => self.accounts(value),
            // Another module's property: its evaluator answers for the property alone.
            MemberSource::Imported => exact_result(&self.evaluator.evaluate(read)),
            MemberSource::Receiver => self.accounts(receiver),
        }
    }

    /// Where `receiver.path` comes from, as far as the source says: a binding to its initializer,
    /// a destructured name to the property it takes, an object literal to the property's last
    /// write.
    fn property_source(
        &mut self,
        mut receiver: &'a Expression<'a>,
        mut path: Vec<&'a str>,
    ) -> MemberSource<'a> {
        // Bindings that refer to each other cannot cycle in a module that runs, but the build
        // reads modules without running them; this bounds the walk regardless.
        for _ in 0..64 {
            match unwrap(receiver) {
                Expression::StaticMemberExpression(member) if !member.optional => {
                    path.insert(0, member.property.name.as_str());
                    receiver = &member.object;
                }
                Expression::ComputedMemberExpression(member) if !member.optional => {
                    let Some(key) = literal_key(&member.expression) else {
                        return MemberSource::Receiver;
                    };
                    path.insert(0, key);
                    receiver = &member.object;
                }
                Expression::ObjectExpression(object) if !path.is_empty() => {
                    let Some(value) = last_write(object, path.remove(0)) else {
                        return MemberSource::Receiver;
                    };
                    receiver = value;
                }
                Expression::Identifier(identifier) if !path.is_empty() => {
                    let semantic = self.evaluator.semantic();
                    let scoping = semantic.scoping();
                    let Some(symbol) = identifier
                        .reference_id
                        .get()
                        .and_then(|reference| scoping.get_reference(reference).symbol_id())
                    else {
                        return MemberSource::Receiver;
                    };
                    // Written after its declaration, the binding is refused by the whole-receiver
                    // check this falls back to.
                    if self.evaluator.is_mutated(symbol) {
                        return MemberSource::Receiver;
                    }
                    if self.evaluator.is_import(symbol) {
                        return MemberSource::Imported;
                    }
                    let AstKind::VariableDeclarator(declarator) =
                        semantic.symbol_declaration(symbol).kind()
                    else {
                        return MemberSource::Receiver;
                    };
                    let Some(init) = declarator.init.as_ref() else {
                        return MemberSource::Receiver;
                    };
                    if !matches!(declarator.id, BindingPattern::BindingIdentifier(_)) {
                        let Some(mut taken) = binding_path(&declarator.id, symbol) else {
                            return MemberSource::Receiver;
                        };
                        taken.append(&mut path);
                        path = taken;
                    }
                    receiver = init;
                }
                _ if path.is_empty() => return MemberSource::Property(receiver),
                _ => return MemberSource::Receiver,
            }
        }
        MemberSource::Receiver
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
        // Written after its declaration, a binding no longer holds what its initializer says.
        if self.evaluator.is_mutated(symbol) {
            return false;
        }
        if self.evaluator.is_import(symbol) {
            // Cross-module values are resolved by the evaluator from the exporting module's
            // initializer; the exactness of that initializer was established there.
            return exact_result(&self.evaluator.evaluate_symbol(symbol));
        }
        let declaration = semantic.symbol_declaration(symbol);
        match declaration.kind() {
            AstKind::VariableDeclarator(declarator) => {
                if !matches!(declarator.id, BindingPattern::BindingIdentifier(_)) {
                    // Destructured: the value is exact only when no default on the path to the
                    // name can supply it.
                    if pattern_default_reaches(&declarator.id, symbol) {
                        return false;
                    }
                    // And it is the property it takes, not the whole initializer: `{ w } = theme`
                    // beside `px: compute()` is `w`.
                    if let (Some(init), Some(path)) =
                        (&declarator.init, binding_path(&declarator.id, symbol))
                    {
                        return match self.property_source(init, path) {
                            MemberSource::Property(value) => self.accounts(value),
                            MemberSource::Imported => {
                                exact_result(&self.evaluator.evaluate_symbol(symbol))
                            }
                            MemberSource::Receiver => self.accounts(init),
                        };
                    }
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

/// Where a property read's value comes from.
enum MemberSource<'a> {
    /// The expression the source writes for the property, followed through local bindings and
    /// object literals, with nothing written after it in its literal able to replace it.
    Property(&'a Expression<'a>),
    /// A property of an imported binding.
    Imported,
    /// Anything else: the whole receiver has to be exact.
    Receiver,
}

/// The value `object` writes for `name` last, unless something written after it — a spread, a
/// computed key — may replace it, or it is an accessor or a method.
fn last_write<'a>(
    object: &'a oxc_ast::ast::ObjectExpression<'a>,
    name: &str,
) -> Option<&'a Expression<'a>> {
    for property in object.properties.iter().rev() {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if property.computed {
            return None;
        }
        if property.key.static_name().is_some_and(|key| key == name) {
            return (property.kind == PropertyKind::Init && !property.method)
                .then_some(&property.value);
        }
    }
    None
}

/// A property key written as a literal: `theme['w']`.
fn literal_key<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match unwrap(expression) {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => template
            .quasis
            .first()
            .and_then(|quasi| quasi.value.cooked.as_ref())
            .map(|cooked| cooked.as_str()),
        _ => None,
    }
}

/// The keys a destructuring pattern takes `symbol` through: `{ sizes: { w } }` gives `sizes`,
/// `w`. None when the way there has a default, an array, a rest or a computed key.
fn binding_path<'a>(
    pattern: &'a BindingPattern<'a>,
    symbol: oxc_syntax::symbol::SymbolId,
) -> Option<Vec<&'a str>> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            (identifier.symbol_id.get() == Some(symbol)).then(Vec::new)
        }
        BindingPattern::ObjectPattern(object) => {
            let property = object
                .properties
                .iter()
                .find(|property| binds(&property.value, symbol))?;
            let key = match &property.key {
                PropertyKey::StaticIdentifier(identifier) if !property.computed => {
                    identifier.name.as_str()
                }
                PropertyKey::StringLiteral(literal) if !property.computed => literal.value.as_str(),
                _ => return None,
            };
            let mut path = binding_path(&property.value, symbol)?;
            path.insert(0, key);
            Some(path)
        }
        _ => None,
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
