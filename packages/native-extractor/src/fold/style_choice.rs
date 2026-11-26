//! The finite choices in an otherwise exact `css()` call.

use oxc_ast::ast::{Argument, Expression, ObjectPropertyKind, PropertyKind};
use oxc_span::{GetSpan, Span};
use serde_json::{Map, Value};

use crate::{evaluator::FileEvaluator, offsets::Utf16};

use super::{
    Exactness, Unknown,
    condition::{condition, implied},
    holds_guarded_read,
    model::{FoldCondition, FoldStyleChoice},
    spread_kind, unknown, unwrap,
};

/// The most combinations of answers one call is compiled to, as `MAX_CX_COMBINATIONS` bounds a
/// `cx()`: each is written out whole, so what the call compiles to doubles with each independent
/// choice. Past this the call is dynamic.
const MAX_COMBINATIONS: usize = 32;

/// What the call's arguments style on each path through its tests, and the tests, which the fold
/// copies into what it writes: a ternary per test, asked where the call was and only on the path
/// that reaches it, choosing between class strings. Otherwise, why not, where it is the choices
/// that keep the call from compiling: `None` for a call holding none, which is not exact for some
/// other reason the audit says.
///
/// A test can be anything a copied condition can be — `compact`, `props.size === 'sm'` — reading
/// neither a Bamboo import nor a recipe: `guarded_reads`, sorted by start. Each answer, and every
/// other value in the arguments, has to be exact. An exact spread is merged where it is written, and
/// a second argument after the first, as `css()` merges them. A test the answers on its path decide
/// is not asked there (`answer`): a plain read written twice answers as it did, and `size === 'lg'`
/// answers no where `size === 'sm'` answered yes, so no combination is written that no value reaches.
///
/// `composed`: a `cx()` composes the call, and is handed what its tests ask (`conditions`).
pub(super) fn analyze<'a>(
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    arguments: &'a [Argument<'a>],
    utf16: &Utf16,
    guarded_reads: &[Span],
    composed: bool,
) -> Result<FoldStyleChoice, Option<Unknown<'a>>> {
    let mut expressions = Vec::with_capacity(arguments.len());
    for argument in arguments {
        match argument.as_expression() {
            Some(expression) => expressions.push(expression),
            // `css(...styles)`: how many style objects it passes is not known, let alone which.
            None => return Err(Some(unknown("spread", argument.span()))),
        }
    }

    let mut written = Vec::new();
    let mut guarded = None;
    for expression in &expressions {
        collect_tests(expression, guarded_reads, &mut written, &mut guarded);
    }
    if written.is_empty() {
        return Err(guarded.map(|test| unknown("test", test)));
    }
    // Where a call has more combinations than it compiles to: the choices it holds, which is the
    // count that has to come down.
    let past_limit = || {
        let span = Span::new(
            arguments.first().map_or(0, |first| first.span().start),
            arguments.last().map_or(0, |last| last.span().end),
        );
        Some(Unknown::choices(span, written.len() as u32))
    };

    let mut choices = Choices {
        evaluator,
        guarded_reads,
        tests: Vec::new(),
        conditions: Vec::new(),
    };
    let mut call = Tree::Leaf(Vec::new());
    for expression in expressions {
        let argument = choices
            .explore(expression)
            .map_err(|found| match found.kind {
                "choices" => past_limit(),
                _ => Some(found),
            })?;
        call = sequence(
            call,
            argument,
            &mut Vec::new(),
            &choices.conditions,
            &mut |mut styles: Vec<Value>, value| {
                match value {
                    // `css()` drops a nullish argument.
                    None => {}
                    Some(object @ Value::Object(_)) => styles.push(object),
                    Some(_) => return None,
                }
                Some(styles)
            },
        )
        .ok_or_else(|| Some(unknown("value", expression.span())))?;
        bounded(&call).ok_or_else(past_limit)?;
    }

    let mut tree = String::new();
    call.write_json(&mut tree);
    Ok(FoldStyleChoice {
        tests: choices.tests.iter().map(|test| utf16.span(*test)).collect(),
        conditions: composed
            .then(|| serde_json::to_string(&choices.conditions).ok())
            .flatten(),
        tree,
    })
}

/// Every test `explore` meets, in the order it meets them, and the first of those it cannot ask:
/// one reading a Bamboo binding or a recipe, which the compiled call no longer holds.
fn collect_tests<'a>(
    expression: &'a Expression<'a>,
    guarded_reads: &[Span],
    into: &mut Vec<&'a Expression<'a>>,
    guarded: &mut Option<Span>,
) {
    match unwrap(expression) {
        Expression::ConditionalExpression(choice)
            if holds_guarded_read(guarded_reads, choice.test.span()) =>
        {
            guarded.get_or_insert(choice.test.span());
        }
        Expression::ConditionalExpression(choice) => {
            into.push(&choice.test);
            collect_tests(&choice.consequent, guarded_reads, into, guarded);
            collect_tests(&choice.alternate, guarded_reads, into, guarded);
        }
        Expression::ObjectExpression(object) => {
            // A spread holds no choice: see `explore`.
            for property in &object.properties {
                if let ObjectPropertyKind::ObjectProperty(property) = property {
                    collect_tests(&property.value, guarded_reads, into, guarded);
                }
            }
        }
        _ => {}
    }
}

/// A decision over the call's tests: what an expression evaluates to on each path through them.
#[derive(Clone)]
enum Tree<L> {
    Leaf(L),
    Node {
        test: usize,
        then: Box<Tree<L>>,
        otherwise: Box<Tree<L>>,
    },
}

impl<L: Clone> Tree<L> {
    fn leaves(&self) -> usize {
        match self {
            Tree::Leaf(_) => 1,
            Tree::Node {
                then, otherwise, ..
            } => then.leaves() + otherwise.leaves(),
        }
    }

    /// The tree on a path that answered `decided`: a test those answers decide takes its answer.
    fn decided(self, decided: &mut Vec<(usize, bool)>, conditions: &[FoldCondition]) -> Tree<L> {
        match self {
            Tree::Leaf(leaf) => Tree::Leaf(leaf),
            Tree::Node {
                test,
                then,
                otherwise,
            } => match answer(decided, test, conditions) {
                Some(true) => then.decided(decided, conditions),
                Some(false) => otherwise.decided(decided, conditions),
                None => {
                    decided.push((test, true));
                    let then = then.decided(decided, conditions);
                    decided.pop();
                    decided.push((test, false));
                    let otherwise = otherwise.decided(decided, conditions);
                    decided.pop();
                    node(test, then, otherwise)
                }
            },
        }
    }
}

impl Tree<Vec<Value>> {
    /// A node as `{ test, then, otherwise }`, and a leaf as `{ styles }`: the call's arguments on
    /// that path, each a style object. Written as text, without a tree of values to write it from.
    fn write_json(&self, out: &mut String) {
        match self {
            Tree::Leaf(styles) => {
                out.push_str("{\"styles\":[");
                for (index, style) in styles.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    out.push_str(&style.to_string());
                }
                out.push_str("]}");
            }
            Tree::Node {
                test,
                then,
                otherwise,
            } => {
                out.push_str("{\"test\":");
                out.push_str(&test.to_string());
                out.push_str(",\"then\":");
                then.write_json(out);
                out.push_str(",\"otherwise\":");
                otherwise.write_json(out);
                out.push('}');
            }
        }
    }
}

fn node<L>(test: usize, then: Tree<L>, otherwise: Tree<L>) -> Tree<L> {
    Tree::Node {
        test,
        then: Box::new(then),
        otherwise: Box::new(otherwise),
    }
}

/// What a path that answered `decided`, in the order it asked, says `test` answers, where an answer
/// decides it (`implied`): the latest first, and none from before a test that could have run
/// something, after which what an earlier answer said of a value may no longer hold.
fn answer(decided: &[(usize, bool)], test: usize, conditions: &[FoldCondition]) -> Option<bool> {
    let query = &conditions[test];
    for &(asked, answered) in decided.iter().rev() {
        let known = &conditions[asked];
        if let Some(answer) = implied(known, answered, query) {
            return Some(answer);
        }
        if !known.inert {
            return None;
        }
    }
    None
}

fn bounded<L: Clone>(tree: &Tree<L>) -> Option<()> {
    (tree.leaves() <= MAX_COMBINATIONS).then_some(())
}

/// Past `MAX_COMBINATIONS`, as `explore` says it: how many choices the call holds is `analyze`'s
/// to count.
fn too_many<'a>(span: Span) -> Unknown<'a> {
    Unknown::choices(span, 0)
}

/// `first`, then `second` on every path through it, each leaf the two combined: the order the call
/// evaluates them in, and so the order the compiled call asks their tests. `second` is copied only
/// where a test of `first` splits the paths it is grafted onto.
fn sequence<A: Clone, B: Clone>(
    first: Tree<A>,
    second: Tree<B>,
    decided: &mut Vec<(usize, bool)>,
    conditions: &[FoldCondition],
    combine: &mut impl FnMut(A, B) -> Option<A>,
) -> Option<Tree<A>> {
    match first {
        Tree::Leaf(leaf) => graft(leaf, second, decided, conditions, combine),
        Tree::Node {
            test,
            then,
            otherwise,
        } => {
            decided.push((test, true));
            let then = sequence(*then, second.clone(), decided, conditions, combine);
            decided.pop();
            decided.push((test, false));
            let otherwise = sequence(*otherwise, second, decided, conditions, combine);
            decided.pop();
            Some(node(test, then?, otherwise?))
        }
    }
}

/// `second` where a path through `first` left `leaf`: a test that path's answers decide takes its
/// answer.
fn graft<A: Clone, B: Clone>(
    leaf: A,
    second: Tree<B>,
    decided: &mut Vec<(usize, bool)>,
    conditions: &[FoldCondition],
    combine: &mut impl FnMut(A, B) -> Option<A>,
) -> Option<Tree<A>> {
    match second {
        Tree::Leaf(value) => combine(leaf, value).map(Tree::Leaf),
        Tree::Node {
            test,
            then,
            otherwise,
        } => match answer(decided, test, conditions) {
            Some(true) => graft(leaf, *then, decided, conditions, combine),
            Some(false) => graft(leaf, *otherwise, decided, conditions, combine),
            None => {
                decided.push((test, true));
                let yes = graft(leaf.clone(), *then, decided, conditions, combine);
                decided.pop();
                decided.push((test, false));
                let no = graft(leaf, *otherwise, decided, conditions, combine);
                decided.pop();
                Some(node(test, yes?, no?))
            }
        },
    }
}

struct Choices<'e, 'a, 'p, 's, 'g> {
    evaluator: &'e mut FileEvaluator<'a, 'p, 's>,
    guarded_reads: &'g [Span],
    /// Each test asked, as written.
    tests: Vec<Span>,
    /// What each of `tests` asks, by index.
    conditions: Vec<FoldCondition>,
}

impl<'a> Choices<'_, 'a, '_, '_, '_> {
    fn test(&mut self, test: &'a Expression<'a>) -> usize {
        self.tests.push(test.span());
        self.conditions
            .push(condition(test, self.evaluator.scoping));
        self.tests.len() - 1
    }

    /// What `expression` evaluates to on each path through the tests it holds: `None` where it is
    /// nullish, which `css()` drops. Otherwise, the first thing on the way that is not known.
    fn explore(
        &mut self,
        expression: &'a Expression<'a>,
    ) -> Result<Tree<Option<Value>>, Unknown<'a>> {
        match unwrap(expression) {
            Expression::ConditionalExpression(choice)
                if !holds_guarded_read(self.guarded_reads, choice.test.span()) =>
            {
                let test = self.test(&choice.test);
                let then = self.explore(&choice.consequent)?;
                let otherwise = self.explore(&choice.alternate)?;
                // An answer asking another, `size === 'sm' ? (size === 'lg' ? …) : …`, which this
                // answer may decide.
                let tree = node(test, then, otherwise).decided(&mut Vec::new(), &self.conditions);
                bounded(&tree).ok_or_else(|| too_many(choice.span))?;
                Ok(tree)
            }
            // Its test reads what the compiler removes, so it compiles only where it is decided.
            Expression::ConditionalExpression(choice) => exact_value(self.evaluator, expression)
                .map(Tree::Leaf)
                .map_err(|_| unknown("test", choice.test.span())),
            Expression::ObjectExpression(object) => {
                let mut built = Tree::Leaf(Map::new());
                for property in &object.properties {
                    built = match property {
                        ObjectPropertyKind::ObjectProperty(property) => {
                            if property.computed {
                                return Err(unknown("key", property.key.span()));
                            }
                            if property.method || property.kind != PropertyKind::Init {
                                return Err(unknown("method", property.span));
                            }
                            let Some(key) = property.key.static_name() else {
                                return Err(unknown("key", property.key.span()));
                            };
                            let key = key.into_owned();
                            if key == "__proto__" {
                                return Err(unknown("proto", property.key.span()));
                            }
                            let value = self.explore(&property.value)?;
                            sequence(
                                built,
                                value,
                                &mut Vec::new(),
                                &self.conditions,
                                &mut |mut map: Map<String, Value>, value| {
                                    match value {
                                        Some(value) => {
                                            map.insert(key.clone(), value);
                                        }
                                        None => {
                                            map.shift_remove(&key);
                                        }
                                    }
                                    Some(map)
                                },
                            )
                            .ok_or_else(|| unknown("value", property.value.span()))?
                        }
                        // Merged where it is written: a key it holds takes the place the key already
                        // had, as an object spread assigns it. It has to be exact: extraction cannot
                        // tell which properties a choice inside one sets, so the stylesheet would hold
                        // no rule for what either answer names.
                        ObjectPropertyKind::SpreadProperty(spread) => {
                            let value = exact_value(self.evaluator, &spread.argument)
                                .map_err(|_| unknown(spread_kind(&spread.argument), spread.span))?;
                            sequence(
                                built,
                                Tree::Leaf(value),
                                &mut Vec::new(),
                                &self.conditions,
                                &mut |mut map: Map<String, Value>, value| {
                                    match value {
                                        None => {}
                                        Some(Value::Object(spread)) => map.extend(spread),
                                        Some(_) => return None,
                                    }
                                    Some(map)
                                },
                            )
                            .ok_or_else(|| unknown("spread", spread.span))?
                        }
                    };
                    bounded(&built).ok_or_else(|| too_many(object.span))?;
                }
                Ok(map_leaves(built, &mut |map| Some(Value::Object(map))))
            }
            _ => exact_value(self.evaluator, expression).map(Tree::Leaf),
        }
    }
}

fn map_leaves<A, B>(tree: Tree<A>, map: &mut impl FnMut(A) -> B) -> Tree<B> {
    match tree {
        Tree::Leaf(leaf) => Tree::Leaf(map(leaf)),
        Tree::Node {
            test,
            then,
            otherwise,
        } => node(test, map_leaves(*then, map), map_leaves(*otherwise, map)),
    }
}

/// What `expression` evaluates to, where that is exact, and otherwise why not.
fn exact_value<'a>(
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    expression: &'a Expression<'a>,
) -> Result<Option<Value>, Unknown<'a>> {
    let mut exactness = Exactness {
        evaluator: &mut *evaluator,
        drops_nullish: true,
    };
    if !exactness.check(expression) {
        return Err(exactness
            .explain(expression)
            .unwrap_or_else(|| unknown("value", expression.span())));
    }
    Ok(evaluator.evaluate(expression).value)
}
