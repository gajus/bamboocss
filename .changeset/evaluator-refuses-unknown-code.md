---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Fail the compile on code the evaluator cannot run, instead of compiling a style call to the wrong classes.

- A style helper whose body uses a `switch`, a loop, `try`, a `throw` that is reached, or a statement run for its
  effect, such as `styles.color = …` or `Object.assign(out, …)`, now makes the call a compile error. These statements
  used to be skipped, so `css(tone('danger'))` compiled to a fall-through value, to an empty class, or to the object as
  it was before a loop or assignment changed it.
- A binding that is reassigned, or written into anywhere in its module (`base.color = …`, `delete base.color`,
  `Object.assign(base, …)`, `fonts.push(…)`), is no longer read as its initializer, so a call that uses it is a compile
  error rather than a class for a value the element never has.
- A bare `return` inside a branch now returns `undefined` instead of continuing to the next statement, and every
  expression of a comma sequence is evaluated, not only the last.

Builds that compiled such calls now fail at the call, naming the file and line. Code that only declares values, branches
with `if` and returns is unaffected.
