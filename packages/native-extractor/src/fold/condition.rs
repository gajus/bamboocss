//! What a condition the fold copies asks, so that one answer on a path can decide another.
//!
//! The compiled form of a `cx()` or `css()` call holding conditions is a ternary asking each where
//! the call asked it, one class string per combination of answers. Combinations no value can reach
//! used to be written out all the same: `cx(base, variant === 'secondary' && secondary,
//! variant === 'ghost' && ghost)` asked whether `variant` was `'ghost'` where it had just answered
//! that it was `'secondary'`. Classified here, a condition reading one value alone says what an
//! answer to it means for that value, and the decision skips a condition its path has decided.

use oxc_ast::ast::{BinaryOperator, ChainElement, Expression, UnaryOperator};
use oxc_semantic::Scoping;

use super::{model::FoldCondition, unwrap};

/// What `test` asks, as the decision reasons with it. See `FoldCondition`.
pub(super) fn condition(test: &Expression<'_>, scoping: &Scoping) -> FoldCondition {
    let inert = runs_nothing(test);
    let mut negated = false;
    let mut asked = unwrap(test);
    while let Expression::UnaryExpression(unary) = asked
        && unary.operator == UnaryOperator::LogicalNot
    {
        negated = !negated;
        asked = unwrap(&unary.argument);
    }
    let compared = match asked {
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::StrictEquality | BinaryOperator::StrictInequality
            ) =>
        {
            let pair = plain_read(&binary.left)
                .zip(literal(&binary.right, scoping))
                .or_else(|| plain_read(&binary.right).zip(literal(&binary.left, scoping)));
            pair.map(|pair| (pair, binary.operator == BinaryOperator::StrictInequality))
        }
        _ => None,
    };
    match compared {
        Some(((subject, (literal, truthy)), inequality)) => FoldCondition {
            inert,
            subject: Some(subject),
            literal: Some(literal),
            literal_truthy: Some(truthy),
            negated: negated != inequality,
        },
        None => FoldCondition {
            inert,
            subject: plain_read(asked),
            literal: None,
            literal_truthy: None,
            negated,
        },
    }
}

/// `active`, `props.size` or `this.props.size`: a read with nothing to run, keyed by what it reads.
/// Two conditions of one call reading one name read one binding, and one `this`, since they are
/// written in one scope: a condition holding a function is not one the decision reasons with.
fn plain_read(expression: &Expression<'_>) -> Option<String> {
    match unwrap(expression) {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        Expression::ThisExpression(_) => Some("this".into()),
        Expression::StaticMemberExpression(member) if !member.optional => {
            plain_read(&member.object).map(|object| format!("{object}.{}", member.property.name))
        }
        _ => None,
    }
}

/// A primitive written as one, as JavaScript writes it, and whether it is truthy: two literals are
/// strictly equal where they are the same text. A string holding a lone surrogate is none, since
/// its value spells the surrogate as an escape a plain string could hold.
fn literal(expression: &Expression<'_>, scoping: &Scoping) -> Option<(String, bool)> {
    let string = |value: &str| {
        (
            serde_json::Value::from(value).to_string(),
            !value.is_empty(),
        )
    };
    let number = |value: f64| {
        (
            crate::evaluator::js_number_string(value),
            value != 0.0 && !value.is_nan(),
        )
    };
    match unwrap(expression) {
        Expression::StringLiteral(literal) if !literal.lone_surrogates => {
            Some(string(literal.value.as_str()))
        }
        Expression::TemplateLiteral(template)
            if template.quasis.iter().all(|quasi| !quasi.lone_surrogates) =>
        {
            template.single_quasi().map(|value| string(value.as_str()))
        }
        Expression::NumericLiteral(literal) => Some(number(literal.value)),
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::UnaryNegation => {
            match unwrap(&unary.argument) {
                Expression::NumericLiteral(literal) => Some(number(-literal.value)),
                _ => None,
            }
        }
        Expression::BooleanLiteral(literal) => Some((literal.value.to_string(), literal.value)),
        Expression::NullLiteral(_) => Some(("null".into(), false)),
        // The global: a binding of that name is a value like any other.
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && identifier.reference_id.get().is_some_and(|reference| {
                    scoping.get_reference(reference).symbol_id().is_none()
                }) =>
        {
            Some(("undefined".into(), false))
        }
        Expression::UnaryExpression(unary)
            if unary.operator == UnaryOperator::Void
                && matches!(unwrap(&unary.argument), Expression::NumericLiteral(_)) =>
        {
            Some(("undefined".into(), false))
        }
        _ => None,
    }
}

/// Whether evaluating `expression` can run nothing but the reads it makes, so asking it changes no
/// value another condition reads: reads, literals — a negative number among them — and `!`,
/// `typeof`, `void`, `===`, `!==`, `&&`, `||`, `??` and `?:` over them. Every other operator can call
/// a method of an object it is handed — `<` its `valueOf`, a template its `toString` — and a call or
/// an assignment can do anything. A getter is taken for a read, as a plain read written twice is
/// asked once.
fn runs_nothing(expression: &Expression<'_>) -> bool {
    match unwrap(expression) {
        Expression::Identifier(_)
        | Expression::ThisExpression(_)
        | Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        Expression::StaticMemberExpression(member) => runs_nothing(&member.object),
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::StaticMemberExpression(member) => runs_nothing(&member.object),
            _ => false,
        },
        Expression::UnaryExpression(unary) => match unary.operator {
            UnaryOperator::LogicalNot | UnaryOperator::Typeof | UnaryOperator::Void => {
                runs_nothing(&unary.argument)
            }
            UnaryOperator::UnaryNegation => matches!(
                unwrap(&unary.argument),
                Expression::NumericLiteral(_) | Expression::BigIntLiteral(_)
            ),
            _ => false,
        },
        Expression::BinaryExpression(binary) => {
            matches!(
                binary.operator,
                BinaryOperator::StrictEquality | BinaryOperator::StrictInequality
            ) && runs_nothing(&binary.left)
                && runs_nothing(&binary.right)
        }
        Expression::LogicalExpression(logical) => {
            runs_nothing(&logical.left) && runs_nothing(&logical.right)
        }
        Expression::ConditionalExpression(conditional) => {
            runs_nothing(&conditional.test)
                && runs_nothing(&conditional.consequent)
                && runs_nothing(&conditional.alternate)
        }
        _ => false,
    }
}

/// What `query` answers where `known`, asked earlier on the same path, answered `answer`, if that
/// decides it: both ask about one value, and the answer leaves `query` only one. The rules are the
/// fold's `impliedAnswer`, which decides a `cx()` call's conditions as this decides a `css()` call's.
pub(super) fn implied(known: &FoldCondition, answer: bool, query: &FoldCondition) -> Option<bool> {
    let (Some(subject), Some(asked)) = (&known.subject, &query.subject) else {
        return None;
    };
    if subject != asked {
        return None;
    }
    // Whether what `known` asks, before it is negated, holds of the value.
    let holds = answer != known.negated;
    let decided = match (&known.literal, &query.literal) {
        // The value is truthy, or it is not.
        (None, None) => Some(holds),
        (None, Some(_)) => (query.literal_truthy != Some(holds)).then_some(false),
        // The value is the literal.
        (Some(_), None) if holds => known.literal_truthy,
        (Some(literal), Some(other)) if holds => Some(literal == other),
        // The value is not the literal.
        (Some(literal), Some(other)) if literal == other => Some(false),
        _ => None,
    };
    decided.map(|decided| decided != query.negated)
}
