---
'@bamboocss/shared': patch
'@bamboocss/token-dictionary': patch
---

Keep negative tokens pointing at their variable when its name contains "calc". Negating a token removed every "calc"
from its expression rather than only a nested `calc(`, so under `prefix: 'calcite'` a negative spacing value such as
`marginTop: '-4'` referenced `var(--ite-spacing-4)` — a variable that is never declared, which leaves the margin at its
initial value. A token named, say, `spacing.calculated` was cut the same way.
