---
'@bamboocss/eslint-plugin': patch
---

`no-dynamic-styling` no longer reports a second choice in one `css()` call, one inside another's answers, or one beside
a spread or after another argument, which the compiler now compiles. It reports a call past 32 combinations once, where
its first choice is written, with a recipe as what to write instead, and still reports a choice beside a computed key, a
method or a spread of a choice, and one in a call spreading its arguments.
