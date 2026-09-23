---
'@bamboocss/types': minor
'@bamboocss/generator': minor
---

Declare only the recipe members a compiled build accepts.

The compiler rewrites a recipe call into the classes it selects and erases the recipe, so any other read of the binding
fails the build: `.raw()` with `raw-call`, and `variantMap`, `config`, `merge`, `getVariantProps`, `classNameMap` and
`slotsAffectedBy` with `runtime-binding`. The types still declared all of them, so that code type-checked and failed
only when built.

`cva`, `sva` and generated config recipes are now typed as a callable with `splitVariantProps`, the one member the
compiler lowers, plus slot accessors on scoped slot recipes. Code that reads a removed member gets a type error in the
editor instead of a build failure. The generated runtime is unchanged.

The docs that recommended `.raw()` to merge a recipe with styles now show `cx(recipe(...), css(...))`, which compiles
and lets the later argument win. The `variantMap` Storybook example now lists the options directly.
