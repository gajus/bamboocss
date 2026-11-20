---
'@bamboocss/eslint-plugin': patch
---

`no-dynamic-styling` no longer reports a choice between values written out where the compiler compiles one,
`css({ padding: compact ? '2' : '4' })`, nor a negative number or a literal under a TypeScript `as`. Where the build
compiles no choice, the rule still reports it.

- A second choice in the same `css()` call is reported, and so is one beside a spread or a second argument, with what to
  write instead: a `css()` call of its own, which `cx()` composes.
- A choice whose test reads a Bamboo import or a recipe is reported: the test is copied into the compiled call, which
  holds neither.
- A choice in a pattern, a recipe or `css.raw()` is still a dynamic value.
