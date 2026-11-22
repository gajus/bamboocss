//! The finite choices in an otherwise exact `css()` call.

use std::collections::HashMap;

use oxc_ast::ast::{Argument, Expression, ObjectPropertyKind, PropertyKind};
use oxc_span::{GetSpan, Span};
use serde_json::{Map, Value};

use crate::{evaluator::FileEvaluator, offsets::Utf16};

use super::{Exactness, holds_guarded_read, model::FoldStyleChoice, unwrap};

/// The most combinations of answers one call is compiled to, as `MAX_CX_COMBINATIONS` bounds a
/// `cx()`: each is written out whole, so what the call compiles to doubles with each independent
/// choice. Past this the call is dynamic.
const MAX_COMBINATIONS: usize = 32;

/// What the call's arguments style on each path through its tests, and the tests, which the fold
/// copies into what it writes: a ternary per test, asked where the call was and only on the path
/// that reaches it, choosing between class strings.
///
/// A test can be anything a copied condition can be — `compact`, `props.size === 'sm'` — reading
/// neither a Bamboo import nor a recipe: `guarded_reads`, sorted by start. Each answer, and every
/// other value in the arguments, has to be exact. An exact spread is merged where it is written, and
/// a second argument after the first, as `css()` merges them. Where every test is a plain read, one
/// written twice is asked once, as reading it again would answer the same.
pub(super) fn analyze<'a>(
    evaluator: &mut FileEvaluator<'a, '_, '_>,
    arguments: &'a [Argument<'a>],
    utf16: &Utf16,
    guarded_reads: &[Span],
) -> Option<FoldStyleChoice> {
    let expressions = arguments
        .iter()
        .map(Argument::as_expression)
        .collect::<Option<Vec<_>>>()?;

    let mut written = Vec::new();
    for expression in &expressions {
        collect_tests(expression, guarded_reads, &mut written);
    }
    if written.is_empty() {
        return None;
    }
    // A test that could run something may change what a later read answers, so a read is asked
    // once only where no test can.
    let once = written.iter().all(|test| plain_read(test).is_some());

    let mut choices = Choices {
        evaluator,
        guarded_reads,
        once,
        tests: Vec::new(),
        by_read: HashMap::new(),
    };
    let mut call = Tree::Leaf(Vec::new());
    for expression in expressions {
        let argument = choices.explore(expression)?;
        call = sequence(
            call,
            argument,
            &mut Vec::new(),
            &mut |mut styles: Vec<Value>, value| {
                match value {
                    // `css()` drops a nullish argument.
                    None => {}
                    Some(object @ Value::Object(_)) => styles.push(object),
                    Some(_) => return None,
                }
                Some(styles)
            },
        )?;
        bounded(&call)?;
    }

    let mut tree = String::new();
    call.write_json(&mut tree);
    Some(FoldStyleChoice {
        tests: choices.tests.iter().map(|test| utf16.span(*test)).collect(),
        tree,
    })
}

/// `active` or `props.size`: a read with nothing to run.
fn plain_read(expression: &Expression<'_>) -> Option<String> {
    match unwrap(expression) {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        Expression::StaticMemberExpression(member) if !member.optional => {
            plain_read(&member.object).map(|object| format!("{object}.{}", member.property.name))
        }
        _ => None,
    }
}

/// Every test `explore` meets, in the order it meets them.
fn collect_tests<'a>(
    expression: &'a Expression<'a>,
    guarded_reads: &[Span],
    into: &mut Vec<&'a Expression<'a>>,
) {
    match unwrap(expression) {
        Expression::ConditionalExpression(choice)
            if !holds_guarded_read(guarded_reads, choice.test.span()) =>
        {
            into.push(&choice.test);
            collect_tests(&choice.consequent, guarded_reads, into);
            collect_tests(&choice.alternate, guarded_reads, into);
        }
        Expression::ObjectExpression(object) => {
            // A spread holds no choice: see `explore`.
            for property in &object.properties {
                if let ObjectPropertyKind::ObjectProperty(property) = property {
                    collect_tests(&property.value, guarded_reads, into);
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

    /// The tree on a path that answered `decided`: a test asked again takes the answer it was given.
    fn decided(self, decided: &mut Vec<(usize, bool)>) -> Tree<L> {
        match self {
            Tree::Leaf(leaf) => Tree::Leaf(leaf),
            Tree::Node {
                test,
                then,
                otherwise,
            } => match answer(decided, test) {
                Some(true) => then.decided(decided),
                Some(false) => otherwise.decided(decided),
                None => {
                    decided.push((test, true));
                    let then = then.decided(decided);
                    decided.pop();
                    decided.push((test, false));
                    let otherwise = otherwise.decided(decided);
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

fn answer(decided: &[(usize, bool)], test: usize) -> Option<bool> {
    decided
        .iter()
        .find(|(asked, _)| *asked == test)
        .map(|(_, answered)| *answered)
}

fn bounded<L: Clone>(tree: &Tree<L>) -> Option<()> {
    (tree.leaves() <= MAX_COMBINATIONS).then_some(())
}

/// `first`, then `second` on every path through it, each leaf the two combined: the order the call
/// evaluates them in, and so the order the compiled call asks their tests. `second` is copied only
/// where a test of `first` splits the paths it is grafted onto.
fn sequence<A: Clone, B: Clone>(
    first: Tree<A>,
    second: Tree<B>,
    decided: &mut Vec<(usize, bool)>,
    combine: &mut impl FnMut(A, B) -> Option<A>,
) -> Option<Tree<A>> {
    match first {
        Tree::Leaf(leaf) => graft(leaf, second, decided, combine),
        Tree::Node {
            test,
            then,
            otherwise,
        } => {
            decided.push((test, true));
            let then = sequence(*then, second.clone(), decided, combine);
            decided.pop();
            decided.push((test, false));
            let otherwise = sequence(*otherwise, second, decided, combine);
            decided.pop();
            Some(node(test, then?, otherwise?))
        }
    }
}

/// `second` where a path through `first` left `leaf`: a test that path answered takes its answer.
fn graft<A: Clone, B: Clone>(
    leaf: A,
    second: Tree<B>,
    decided: &mut Vec<(usize, bool)>,
    combine: &mut impl FnMut(A, B) -> Option<A>,
) -> Option<Tree<A>> {
    match second {
        Tree::Leaf(value) => combine(leaf, value).map(Tree::Leaf),
        Tree::Node {
            test,
            then,
            otherwise,
        } => match answer(decided, test) {
            Some(true) => graft(leaf, *then, decided, combine),
            Some(false) => graft(leaf, *otherwise, decided, combine),
            None => {
                decided.push((test, true));
                let yes = graft(leaf.clone(), *then, decided, combine);
                decided.pop();
                decided.push((test, false));
                let no = graft(leaf, *otherwise, decided, combine);
                decided.pop();
                Some(node(test, yes?, no?))
            }
        },
    }
}

struct Choices<'e, 'a, 'p, 's, 'g> {
    evaluator: &'e mut FileEvaluator<'a, 'p, 's>,
    guarded_reads: &'g [Span],
    /// Every test is a plain read, so one written twice is asked once.
    once: bool,
    /// Each test asked, as written.
    tests: Vec<Span>,
    /// A plain read → the test it was first asked as, when `once`.
    by_read: HashMap<String, usize>,
}

impl<'a> Choices<'_, 'a, '_, '_, '_> {
    fn test(&mut self, test: &'a Expression<'a>) -> usize {
        if self.once
            && let Some(read) = plain_read(test)
        {
            if let Some(&known) = self.by_read.get(&read) {
                return known;
            }
            self.by_read.insert(read, self.tests.len());
        }
        self.tests.push(test.span());
        self.tests.len() - 1
    }

    /// What `expression` evaluates to on each path through the tests it holds: `None` where it is
    /// nullish, which `css()` drops.
    fn explore(&mut self, expression: &'a Expression<'a>) -> Option<Tree<Option<Value>>> {
        match unwrap(expression) {
            Expression::ConditionalExpression(choice)
                if !holds_guarded_read(self.guarded_reads, choice.test.span()) =>
            {
                let test = self.test(&choice.test);
                let then = self.explore(&choice.consequent)?;
                let otherwise = self.explore(&choice.alternate)?;
                let tree = node(test, then, otherwise);
                // A test asked twice can only be one a read written twice shares.
                let tree = if self.once {
                    tree.decided(&mut Vec::new())
                } else {
                    tree
                };
                bounded(&tree)?;
                Some(tree)
            }
            Expression::ObjectExpression(object) => {
                let mut built = Tree::Leaf(Map::new());
                for property in &object.properties {
                    built = match property {
                        ObjectPropertyKind::ObjectProperty(property) => {
                            if property.computed
                                || property.method
                                || property.kind != PropertyKind::Init
                            {
                                return None;
                            }
                            let key = property.key.static_name()?.into_owned();
                            if key == "__proto__" {
                                return None;
                            }
                            let value = self.explore(&property.value)?;
                            sequence(
                                built,
                                value,
                                &mut Vec::new(),
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
                            )?
                        }
                        // Merged where it is written: a key it holds takes the place the key already
                        // had, as an object spread assigns it. It has to be exact: extraction cannot
                        // tell which properties a choice inside one sets, so the stylesheet would hold
                        // no rule for what either answer names.
                        ObjectPropertyKind::SpreadProperty(spread) => {
                            let value = Tree::Leaf(exact_value(self.evaluator, &spread.argument)?);
                            sequence(
                                built,
                                value,
                                &mut Vec::new(),
                                &mut |mut map: Map<String, Value>, value| {
                                    match value {
                                        None => {}
                                        Some(Value::Object(spread)) => map.extend(spread),
                                        Some(_) => return None,
                                    }
                                    Some(map)
                                },
                            )?
                        }
                    };
                    bounded(&built)?;
                }
                Some(map_leaves(built, &mut |map| Some(Value::Object(map))))
            }
            _ => Some(Tree::Leaf(exact_value(self.evaluator, expression)?)),
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
