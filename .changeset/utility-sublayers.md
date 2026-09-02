---
'@bamboocss/core': minor
---

Write utilities into cascade sublayers, so precedence no longer depends on source order.

- Each utility rule goes into a sublayer of `utilities` keyed by its selector's specificity, its condition and its
  property's priority, and the layer opens with a statement fixing their order:
  `@layer s010-c0-p1000, s010-c0-p4000, …, important;`. Every `!important` declaration goes into the one sublayer named
  `important`.
- Nothing resolves differently. The flat layer carried precedence in its source order; the sublayers carry the same
  order, with specificity first because layer order outranks it. A cascade model over a corpus that exercises every way
  two declarations can compete pins the winner of every pair, and the sublayers reproduce that ranking without
  exception.
- This is what lets the stylesheet be split per chunk later: chunks load in whichever order a route needs them, and the
  statement decides the order regardless.
- Tooling that matched the flat structure — a selector inside `@layer utilities {` directly — sees the rules one layer
  deeper now.
