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
//!   deciding operand written right there, reached by a name whose value is itself exact, or a
//!   `token()` lookup of a path that is — and `undefined`, an option nobody passed or a path
//!   naming no token, decides as surely as a value;
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
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::BinaryOperator;

use crate::evaluator::{EvalResult, FileEvaluator};

/// What the audit could not account for, and where: why a call is reported as `dynamic` where the
/// evaluator refused nothing. Each kind is what the walk met, not a guess at what was meant.
///
/// - `parameter`: a function's parameter, or a name bound from one, whose value is the caller's.
/// - `lookup`: a property read by a key known only at runtime, `sizes[size]`.
/// - `default`: a value a destructuring default supplies, which is a fallback rather than a value.
/// - `loop`: a loop's variable.
/// - `global`: a name the module does not declare.
/// - `import`: an imported value the build cannot read.
/// - `call`: a call the build cannot evaluate.
/// - `write`: a binding written after its declaration. The evaluator's refusal names the write,
///   and is what is reported where there is one.
/// - `spread`: a spread of something the build cannot enumerate.
/// - `spread-choice`: a choice inside a spread.
/// - `key`: a computed key the build cannot evaluate.
/// - `method`: a method or an accessor, which runs when read.
/// - `proto`: a `__proto__` key, which sets the object's prototype rather than a property.
/// - `choice`: a choice where none compiles: in a pattern, or inside another value.
/// - `and`: a choice written with `&&`, which gives its left operand where that is falsy.
/// - `test`: a choice whose test reads a Bamboo import or a recipe, which the compiled call no
///   longer holds. See `style_choice`.
/// - `choices`: more combinations of answers than one call compiles to. See `style_choice`.
/// - `value`: anything else the build cannot evaluate.
#[derive(Clone, Copy)]
pub(crate) struct Unknown<'a> {
    pub kind: &'static str,
    /// The value, as written.
    pub span: Span,
    /// For `choices`: how many the call holds.
    pub count: u32,
    /// For an operator's value or a call's: the expression, whose operands `Exactness::explain`
    /// reads for the one that is unknown.
    operands_of: Option<&'a Expression<'a>>,
}

impl Unknown<'_> {
    /// `choices`, for a call holding `count` of them.
    pub(crate) fn choices(span: Span, count: u32) -> Self {
        Unknown {
            count,
            ..unknown("choices", span)
        }
    }
}

pub(crate) fn unknown<'a>(kind: &'static str, span: Span) -> Unknown<'a> {
    Unknown {
        kind,
        span,
        count: 0,
        operands_of: None,
    }
}

/// Accounted for, or the first value that is not.
type Audit<'a> = Result<(), Unknown<'a>>;

/// What a spread the build cannot enumerate holds: a choice, which compiles nowhere inside one,
/// or anything else.
pub(crate) fn spread_kind(argument: &Expression<'_>) -> &'static str {
    match unwrap(argument) {
        Expression::ConditionalExpression(_) | Expression::LogicalExpression(_) => "spread-choice",
        _ => "spread",
    }
}

/// What a read's receiver lacks, reported as the read: `props.tone` rather than `props`, which is
/// what is written where the value is used. A lookup stays where it is, since that is what it
/// names, and so does anything found elsewhere, in a declaration the read followed.
fn anchored<'a>(found: Unknown<'a>, read: &'a Expression<'a>) -> Unknown<'a> {
    let span = read.span();
    if found.kind == "lookup" || found.span.start < span.start || found.span.end > span.end {
        return found;
    }
    Unknown {
        span,
        operands_of: None,
        ..found
    }
}

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
    /// Whether the value replaced drops a `null` and an `undefined` alike, as `css()` drops both,
    /// so a `null` that may be either is as exact as both are.
    pub drops_nullish: bool,
}

impl<'a> Exactness<'_, 'a, '_, '_> {
    /// The whole argument evaluates to exactly one value the program will produce.
    pub fn check(&mut self, expression: &'a Expression<'a>) -> bool {
        let result = self.evaluator.evaluate(expression);
        // A hole decides a choice as `null` or `undefined` would, but where the two differ a value
        // holding one cannot replace source: a recipe takes `null` for an explicit miss and
        // `undefined` for its default, and a pattern's defaults stand in for `undefined` alone.
        if !exact_result(&result) || (result.holds_nullish() && !self.drops_nullish) {
            return false;
        }
        self.accounts(expression).is_ok()
    }

    /// Why `check` refuses `expression`: the first value in it the walk cannot account for, in the
    /// order the source writes them. `None` where `check` accepts it.
    ///
    /// For a call reported as `dynamic`, so off the path a compiled call takes. The walk is the one
    /// `check` makes, so the reason is the decision itself rather than a second opinion of it; only
    /// an operator's operands are read further here, for the one among them that is unknown.
    pub fn explain(&mut self, expression: &'a Expression<'a>) -> Option<Unknown<'a>> {
        let result = self.evaluator.evaluate(expression);
        let exact = exact_result(&result) && !(result.holds_nullish() && !self.drops_nullish);
        match self.accounts(expression) {
            Err(found) => Some(self.operand(found)),
            Ok(()) if !exact => Some(unknown("value", expression.span())),
            Ok(()) => None,
        }
    }

    /// Of a value no better described than unknown, the operand that makes it so, where one does:
    /// the parameter in `size * 2`, or the one a helper is called with.
    fn operand(&mut self, found: Unknown<'a>) -> Unknown<'a> {
        let Some(expression) = found.operands_of else {
            return found;
        };
        let operands: Vec<&'a Expression<'a>> = match expression {
            Expression::BinaryExpression(binary) => vec![&binary.left, &binary.right],
            Expression::UnaryExpression(unary) => vec![&unary.argument],
            Expression::CallExpression(call) => call
                .arguments
                .iter()
                .filter_map(|argument| argument.as_expression())
                .collect(),
            _ => Vec::new(),
        };
        operands
            .into_iter()
            .find_map(|operand| self.accounts(operand).err())
            .map_or(found, |inner| self.operand(inner))
    }

    /// Walks the source and requires every value in it to be exact. The evaluated result is
    /// complete by the time this runs, so the walk is about *provenance*: what the evaluator
    /// accepted but a rewrite may not.
    fn accounts(&mut self, expression: &'a Expression<'a>) -> Audit<'a> {
        let inner = unwrap(expression);
        match inner {
            Expression::ConditionalExpression(conditional) => {
                let test = self.evaluator.evaluate(&conditional.test);
                // An undecided test collapses to both arms as conditions, which `exact_result`
                // already refused; a decided one is exact only through its chosen arm.
                let Some(truthy) = test.truthiness().filter(|_| exact_result(&test)) else {
                    return Err(unknown("choice", inner.span()));
                };
                if self.decides(&conditional.test).is_err() {
                    return Err(unknown("choice", inner.span()));
                }
                if truthy {
                    self.accounts(&conditional.consequent)
                } else {
                    self.accounts(&conditional.alternate)
                }
            }
            Expression::LogicalExpression(logical) => {
                // `a && b` gives `a` where `a` is falsy, so where `a` is not known it is a choice
                // between the two. `a || b` and `a ?? b` give `a` itself unless it is falsy or
                // nullish, so what is not known about it is what is not known about the value.
                let undecided = |found: Unknown<'a>| match logical.operator {
                    LogicalOperator::And => unknown("and", inner.span()),
                    _ => found,
                };
                self.decides(&logical.left).map_err(undecided)?;
                let left = self.evaluator.evaluate(&logical.left);
                if !exact_result(&left) {
                    return Err(undecided(unknown("value", logical.left.span())));
                }
                let right_wins = match &left.value {
                    Some(value) => match logical.operator {
                        LogicalOperator::Or => !crate_truthy(value),
                        LogicalOperator::And => crate_truthy(value),
                        LogicalOperator::Coalesce => value.is_null(),
                    },
                    // `undefined`: falsy, and nullish.
                    None if left.is_undefined() => logical.operator != LogicalOperator::And,
                    None => return Err(undecided(unknown("value", logical.left.span()))),
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
                Err(unknown("value", inner.span()))
            }
            Expression::ObjectExpression(object) => {
                for property in &object.properties {
                    match property {
                        ObjectPropertyKind::SpreadProperty(spread) => {
                            let argument = unwrap(&spread.argument);
                            if let Expression::ObjectExpression(_) = argument {
                                self.accounts(argument)?;
                                continue;
                            }
                            // A named spread: exact only when it resolved to an object and the
                            // object it resolved from is itself accounted for.
                            let value = self.evaluator.evaluate(argument);
                            if !exact_result(&value)
                                || !matches!(value.value, Some(serde_json::Value::Object(_)))
                            {
                                return Err(unknown(spread_kind(argument), spread.span));
                            }
                            self.accounts(argument)?;
                        }
                        ObjectPropertyKind::ObjectProperty(property) => {
                            if property.method || property.kind != PropertyKind::Init {
                                return Err(unknown("method", property.span));
                            }
                            if property.computed {
                                let Some(key) = property.key.as_expression() else {
                                    return Err(unknown("key", property.key.span()));
                                };
                                if !exact_result(&self.evaluator.evaluate(key)) {
                                    return Err(unknown("key", key.span()));
                                }
                            }
                            // `{ display: undefined }` contributes nothing and is dropped by the
                            // encoder too.
                            if matches!(unwrap(&property.value), Expression::Identifier(id) if id.name == "undefined")
                            {
                                continue;
                            }
                            self.accounts(&property.value)?;
                        }
                    }
                }
                Ok(())
            }
            Expression::ArrayExpression(array) => {
                for element in &array.elements {
                    match element {
                        ArrayExpressionElement::SpreadElement(spread) => {
                            return Err(unknown("spread", spread.span));
                        }
                        ArrayExpressionElement::Elision(_) => {}
                        _ => match element.as_expression() {
                            Some(value) => self.accounts(value)?,
                            None => return Err(unknown("value", element.span())),
                        },
                    }
                }
                Ok(())
            }
            Expression::Identifier(identifier) => {
                if identifier.name == "undefined" {
                    return Ok(());
                }
                self.identifier_is_exact(identifier)
            }
            Expression::StaticMemberExpression(member) => self.member_read(inner, &member.object),
            Expression::ComputedMemberExpression(member) => {
                if literal_key(&member.expression).is_some() {
                    self.member_read(inner, &member.object)
                } else {
                    self.accounts(&member.object)
                        .map_err(|unknown| anchored(unknown, inner))?;
                    if exact_result(&self.evaluator.evaluate(&member.expression)) {
                        Ok(())
                    } else {
                        Err(unknown("lookup", inner.span()))
                    }
                }
            }
            Expression::TemplateLiteral(template) => {
                for expression in &template.expressions {
                    self.accounts(expression)?;
                }
                Ok(())
            }
            // An operator's operands are not walked. What the walk refuses as unknowable at build
            // time — a binding or property written after its declaration, a caller's argument —
            // the evaluator refuses too, and a destructuring default it takes only where the
            // property is known to be absent, which is the runtime's value as well.
            // `fold-known-values.test.ts` pins those refusals under `+`, `*`, unary `-`, a
            // template literal and a helper's argument.
            _ => {
                if exact_result(&self.evaluator.evaluate(inner)) {
                    return Ok(());
                }
                let kind = match inner {
                    Expression::CallExpression(_) | Expression::NewExpression(_) => "call",
                    _ => "value",
                };
                Err(Unknown {
                    operands_of: Some(inner),
                    ..unknown(kind, inner.span())
                })
            }
        }
    }

    /// Whether the operand deciding a choice is known for what it is: written right there,
    /// reached by a name — a binding, or a property path off one — whose value is itself exact, or
    /// looked up by `token()` from a path that is.
    ///
    /// A name used to be refused outright: a value reached through one recorded the declaration
    /// rather than the value, and truthiness is what that changes. A binding written after its
    /// declaration is refused now (`is_mutated`), as is a parameter, whose value is the caller's,
    /// so a name the audit accounts for holds what its declaration says. `o.display ?? 'block'`
    /// on a module's own options object no longer fails the compile.
    fn decides(&mut self, expression: &'a Expression<'a>) -> Audit<'a> {
        match unwrap(expression) {
            Expression::Identifier(_) | Expression::StaticMemberExpression(_) => {
                self.accounts(expression)
            }
            // An index written as a number, `sizes[0]`, is a path as `sizes['0']` is; `accounts`
            // requires the whole receiver for it.
            Expression::ComputedMemberExpression(member)
                if literal_key(&member.expression).is_some()
                    || matches!(unwrap(&member.expression), Expression::NumericLiteral(_)) =>
            {
                self.accounts(expression)
            }
            // `token(path)` is a lookup in the table the runtime looks the path up in, so once the
            // path is known, so is what it returns: the token's variable or value, or `undefined`
            // for a path naming none. `token('colors.brand') ?? '#fff'` is how a path that may name
            // nothing is written now the fallback argument is retired, and was refused here for
            // being a call. What follows the path goes with the call, so it has to be inert.
            Expression::CallExpression(call) if self.evaluator.is_token_call(call) => {
                match call
                    .arguments
                    .first()
                    .and_then(|argument| argument.as_expression())
                {
                    Some(path) => self.accounts(path)?,
                    None => return Err(unknown("value", call.span)),
                }
                if call
                    .arguments
                    .iter()
                    .skip(1)
                    .all(|argument| argument.as_expression().is_some_and(is_inert_literal))
                {
                    Ok(())
                } else {
                    Err(unknown("value", call.span))
                }
            }
            _ if is_written_here(expression) => Ok(()),
            _ => Err(unknown("value", expression.span())),
        }
    }

    /// A property read: exact through that property's own source, where the source can be
    /// followed to it, and otherwise only if the whole receiver is.
    fn member_read(&mut self, read: &'a Expression<'a>, receiver: &'a Expression<'a>) -> Audit<'a> {
        match self.property_source(read, Vec::new()) {
            MemberSource::Property(value) => self.accounts(value),
            // Another module's property: its evaluator answers for the property alone.
            MemberSource::Imported => {
                if exact_result(&self.evaluator.evaluate(read)) {
                    Ok(())
                } else {
                    Err(unknown("import", read.span()))
                }
            }
            MemberSource::Receiver => self
                .accounts(receiver)
                .map_err(|found| anchored(found, read)),
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
        // The binding the walk last followed, and the keys it read off that binding's value since:
        // where an array reached that way is handed on (`hands_on`), it is read whole.
        let mut root = None;
        let mut walked: Vec<&'a str> = Vec::new();
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
                    let key = path.remove(0);
                    let Some(value) = last_write(object, key) else {
                        return MemberSource::Receiver;
                    };
                    walked.push(key);
                    receiver = value;
                }
                // The element the literal places at the index read, with no spread at or before
                // it to move it: what the read gives, whatever its siblings are — unless the array
                // is handed on, to a function, an alias or a `return`, which may reorder it where
                // the build cannot see: `flip(tones)`, or `list.reverse()` after
                // `list = theme.tones`.
                Expression::ArrayExpression(array) if !path.is_empty() => {
                    if root.is_some_and(|symbol| self.evaluator.hands_on(symbol, &walked)) {
                        return MemberSource::Receiver;
                    }
                    let Some(element) = path[0]
                        .parse::<usize>()
                        .ok()
                        .filter(|index| index.to_string() == path[0])
                        .filter(|&index| {
                            !array.elements.iter().take(index + 1).any(|element| {
                                matches!(element, ArrayExpressionElement::SpreadElement(_))
                            })
                        })
                        .and_then(|index| array.elements.get(index))
                        .and_then(ArrayExpressionElement::as_expression)
                    else {
                        return MemberSource::Receiver;
                    };
                    walked.push(path.remove(0));
                    receiver = element;
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
                    root = Some(symbol);
                    walked.clear();
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
    ) -> Audit<'a> {
        let at = identifier.span;
        let semantic = self.evaluator.semantic();
        let scoping = semantic.scoping();
        let Some(symbol) = identifier
            .reference_id
            .get()
            .and_then(|reference| scoping.get_reference(reference).symbol_id())
        else {
            return Err(unknown("global", at));
        };
        // Written after its declaration, a binding no longer holds what its initializer says.
        if self.evaluator.is_mutated(symbol) {
            return Err(unknown("write", at));
        }
        let symbol_is_exact = |evaluator: &mut FileEvaluator<'a, '_, '_>, kind| {
            if exact_result(&evaluator.evaluate_symbol(symbol)) {
                Ok(())
            } else {
                Err(unknown(kind, at))
            }
        };
        if self.evaluator.is_import(symbol) {
            // Cross-module values are resolved by the evaluator from the exporting module's
            // initializer; the exactness of that initializer was established there.
            return symbol_is_exact(self.evaluator, "import");
        }
        let declaration = semantic.symbol_declaration(symbol);
        // A binding declared through a pattern whose node kind is the pattern element (for-of
        // heads, nested patterns) is not a plain value: what it is bound from, where it is one of
        // those.
        let bound_from = || {
            semantic
                .nodes()
                .ancestor_kinds(declaration.id())
                .find_map(|kind| match kind {
                    AstKind::FormalParameter(_) => Some("parameter"),
                    AstKind::ForOfStatement(_) | AstKind::ForInStatement(_) => Some("loop"),
                    AstKind::AssignmentPattern(_) => Some("default"),
                    _ => None,
                })
        };
        match declaration.kind() {
            AstKind::VariableDeclarator(declarator) => {
                if !matches!(declarator.id, BindingPattern::BindingIdentifier(_)) {
                    // Destructured: the value is exact only when no default on the path to the
                    // name can supply it.
                    if pattern_default_reaches(&declarator.id, symbol) {
                        return Err(unknown("default", at));
                    }
                    // And it is the property it takes, not the whole initializer: `{ w } = theme`
                    // beside `px: compute()` is `w`.
                    if let (Some(init), Some(path)) =
                        (&declarator.init, binding_path(&declarator.id, symbol))
                    {
                        return match self.property_source(init, path) {
                            MemberSource::Property(value) => self.accounts(value),
                            MemberSource::Imported => symbol_is_exact(self.evaluator, "import"),
                            MemberSource::Receiver => self.accounts(init),
                        };
                    }
                }
                match &declarator.init {
                    Some(init) => self.accounts(init),
                    None => Err(unknown("value", at)),
                }
            }
            // A parameter's value is the caller's; a default is a fallback, not a value.
            AstKind::FormalParameter(_) | AstKind::CatchParameter(_) => {
                Err(unknown("parameter", at))
            }
            AstKind::BindingRestElement(_) => Err(unknown(bound_from().unwrap_or("value"), at)),
            AstKind::TSEnumDeclaration(_) => Ok(()),
            // The enum a namespace declared before it merges with, read as the enum is.
            AstKind::TSNamespaceDeclaration(_) if self.evaluator.merges_enum(symbol) => Ok(()),
            _ => match bound_from() {
                Some(kind) => Err(unknown(kind, at)),
                None => symbol_is_exact(self.evaluator, "value"),
            },
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

/// A property key written as a literal: `theme['w']`, or an index as JavaScript names it,
/// `sizes[1]` — not `1.0` or `0x1`, whose key is another spelling of it.
fn literal_key<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match unwrap(expression) {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        Expression::NumericLiteral(literal) => {
            literal.raw.as_ref().map(|raw| raw.as_str()).filter(|raw| {
                raw.bytes().all(|byte| byte.is_ascii_digit())
                    && (*raw == "0" || !raw.starts_with('0'))
            })
        }
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
