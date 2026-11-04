---
'@bamboocss/vite': patch
'@bamboocss/shared': patch
---

An inline `sva()` written without `slots` compiles, with the slots its styles name. The stylesheet worked them out from
`base`, `variants` and `compoundVariants`, but the compiler took the recipe for a `cva`, so neither its call nor a slot
of it was compiled, and the call left in the bundle threw. Both now read the slots through one `inferSlots`.
