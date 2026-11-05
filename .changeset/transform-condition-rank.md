---
'@bamboocss/core': patch
'@bamboocss/types': patch
---

A condition a utility's transform writes ranks as that condition does written in a style. An at-rule ranked as no
condition, so a transform returning `{ md: { width: '100%' } }` sat beside a plain `width` of the same specificity and
lost to it at `md` on any element that had both, whichever was written first.

- A condition named, `md`, `_hover` or one of several blocks, ranks in the same sublayer as the condition written in a
  style.
- An at-rule spelled out, `'@media (width >= 48rem)'`, ranks as that at-rule written as a condition.
- A selector spelled out, such as `focusRing`'s `&:is(:focus, [data-focus])`, still ranks by its specificity alone, so
  no preset utility's output changes.
