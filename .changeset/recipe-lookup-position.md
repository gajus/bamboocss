---
'@bamboocss/generator': patch
'@bamboocss/vite': patch
---

A recipe call whose variants are chosen at runtime selects what the same call written with literals selects.

- A slot read off a slot recipe, `field({ tone, size }).root`, returned the wrong class for most selections where an
  earlier variant styles nothing in that slot: the lookup decided `size` by the value of `tone`. A variant that matters
  only beside another, through a compound variant, did the same to the variants after it.
- `badge(props)` with `props` undefined selects the defaults, as `badge()` does, where it threw.
