---
'@bamboocss/core': patch
---

A rule whose selector uses `:nth-child(An+B of S)` or `:nth-last-child(An+B of S)` is ranked with the selectors `S`
names, as browsers count it. `&:nth-child(2 of .x.y)` has specificity (0,4,0) and was put in the sublayer for (0,2,0),
so a rule such as `&.p.q`, at (0,3,0), won wherever both applied.
