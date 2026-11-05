---
'@bamboocss/core': patch
---

A utility whose `transform` returns styles under a condition, `{ _hover: { … } }` or `{ md: { … } }`, writes the
selector or at-rule that condition stands for. The condition's name was written as it was and read as an element, so
`.hs_true _hover` and `.wl_true md` matched nothing, and what the utility set under the condition never applied, with
nothing reported.

- This holds wherever the utility is used: in `css()`, in a recipe, in global css, and under a condition of the style's
  own, `md: { hoverStack: true }`.
- A condition defined as several blocks is written under each, and one that is an at-rule and a selector nests the
  selector inside the at-rule.
- A selector or at-rule the transform spells out, `&:hover` or `@media …`, is written as before.
