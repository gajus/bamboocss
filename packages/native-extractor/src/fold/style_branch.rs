//! One finite choice in an otherwise exact `css()` argument.

use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, ObjectPropertyKind, PropertyKind, VariableDeclarationKind},
};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::BinaryOperator;
use serde_json::{Map, Value};

use crate::{evaluator::FileEvaluator, offsets::Utf16};

use super::{Exactness, literal_json, model::FoldStyleBranch, unwrap};

pub(super) fn analyze<'a>(
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    expression: &'a Expression<'a>,
    utf16: &Utf16,
) -> Option<FoldStyleBranch> {
    let mut test = None;
    let [
        Some(consequent @ Value::Object(_)),
        Some(alternate @ Value::Object(_)),
    ] = branch_values(evaluator, expression, &mut test)?
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
    test: &mut Option<Span>,
) -> Option<[Option<Value>; 2]> {
    if let Expression::ConditionalExpression(choice) = unwrap(expression)
        && finite_test(evaluator, &choice.test)
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
            for (arm, value) in
                arms.iter_mut()
                    .zip(branch_values(evaluator, &property.value, test)?)
            {
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

fn is_primitive_literal(expression: &Expression<'_>) -> bool {
    matches!(unwrap(expression), Expression::NullLiteral(_)) || literal_json(expression).is_some()
}

fn finite_test(evaluator: &FileEvaluator<'_, '_, '_>, expression: &Expression<'_>) -> bool {
    let expression = unwrap(expression);
    let binding = match expression {
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::StrictEquality | BinaryOperator::StrictInequality
            ) =>
        {
            if is_primitive_literal(&binary.right) {
                unwrap(&binary.left)
            } else if is_primitive_literal(&binary.left) {
                unwrap(&binary.right)
            } else {
                return false;
            }
        }
        _ => expression,
    };
    let Expression::Identifier(identifier) = binding else {
        return false;
    };
    let semantic = evaluator.semantic();
    let Some(symbol) = identifier
        .reference_id
        .get()
        .and_then(|reference| semantic.scoping().get_reference(reference).symbol_id())
    else {
        return false;
    };
    let node = semantic.symbol_declaration(symbol);
    let AstKind::VariableDeclarator(declaration) = node.kind() else {
        return false;
    };
    matches!(semantic.nodes().parent_kind(node.id()), AstKind::VariableDeclaration(parent)
        if parent.kind == VariableDeclarationKind::Const)
        && matches!(declaration.id, BindingPattern::BindingIdentifier(_))
        && matches!(declaration.init.as_ref().map(unwrap), Some(Expression::ConditionalExpression(initializer))
            if is_primitive_literal(&initializer.consequent) && is_primitive_literal(&initializer.alternate))
}
