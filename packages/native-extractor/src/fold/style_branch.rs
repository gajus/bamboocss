//! One finite choice in an otherwise exact `css()` argument.

use oxc_ast::ast::{Expression, ObjectPropertyKind, PropertyKind};
use oxc_span::{GetSpan, Span};
use serde_json::{Map, Value};

use crate::{evaluator::FileEvaluator, offsets::Utf16};

use super::{Exactness, holds_guarded_read, model::FoldStyleBranch, unwrap};

/// The two styles a `css()` argument holding one ternary gives, and its test, which the fold
/// copies into what it writes: the test choosing between two class strings, asked where the call
/// was, once, as the call asked it.
///
/// Only the two answers have to be known, so the test can be anything a copied condition can be —
/// `compact`, `props.size === 'sm'` — reading neither a Bamboo import nor a recipe:
/// `guarded_reads`, sorted by start. Every other value in the argument has to be exact.
pub(super) fn analyze<'a>(
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    expression: &'a Expression<'a>,
    utf16: &Utf16,
    guarded_reads: &[Span],
) -> Option<FoldStyleBranch> {
    let mut test = None;
    let [
        Some(consequent @ Value::Object(_)),
        Some(alternate @ Value::Object(_)),
    ] = branch_values(evaluator, expression, guarded_reads, &mut test)?
    else {
        return None;
    };
    Some(FoldStyleBranch {
        test: utf16.span(test?),
        consequent,
        alternate,
    })
}

fn branch_values<'a>(
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    expression: &'a Expression<'a>,
    guarded_reads: &[Span],
    test: &mut Option<Span>,
) -> Option<[Option<Value>; 2]> {
    if let Expression::ConditionalExpression(choice) = unwrap(expression)
        && !holds_guarded_read(guarded_reads, choice.test.span())
    {
        // The caller keeps the original test at runtime. Two independent tests would need a
        // decision tree; a single pair of argument values cannot represent that call.
        if test.replace(choice.test.span()).is_some() {
            return None;
        }
        return Some([
            exact_value(evaluator, &choice.consequent)?,
            exact_value(evaluator, &choice.alternate)?,
        ]);
    }

    if let Expression::ObjectExpression(object) = unwrap(expression) {
        let mut arms = [Map::new(), Map::new()];
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            if property.computed || property.method || property.kind != PropertyKind::Init {
                return None;
            }
            let key = property.key.static_name()?.into_owned();
            if key == "__proto__" {
                return None;
            }
            for (arm, value) in arms.iter_mut().zip(branch_values(
                evaluator,
                &property.value,
                guarded_reads,
                test,
            )?) {
                if let Some(value) = value {
                    arm.insert(key.clone(), value);
                } else {
                    arm.shift_remove(&key);
                }
            }
        }
        return Some(arms.map(|arm| Some(Value::Object(arm))));
    }

    let value = exact_value(evaluator, expression)?;
    Some([value.clone(), value])
}

fn exact_value<'a>(
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    expression: &'a Expression<'a>,
) -> Option<Option<Value>> {
    Exactness {
        evaluator,
        drops_nullish: true,
    }
    .check(expression)
    .then(|| evaluator.evaluate(expression).value)
}
