---
'@bamboocss/generator': minor
'@bamboocss/shared': minor
'@bamboocss/types': minor
'@bamboocss/config': minor
---

Remove the recipe runtime engine that no compiled build could reach, along with `auditSlotScopes`.

The Vite compiler rewrites every recipe call into the classes it selects and erases the recipe, so any other read of a
recipe fails the build. The generated `cva`, `sva` and config recipes still shipped the engine behind those reads:
`resolve`, `raw`, `merge`/`composeRecipes`, `mergeRecipes`, `getCompoundVariantCss`, `variantMap`, `config`,
`getVariantProps`, `classNameMap` and `slotsAffectedBy`. Each generated recipe is now a callable that throws until
compiled, plus `splitVariantProps`, the one member the compiler lowers.

- `recipes/create-recipe.mjs` is no longer generated, and the next `bamboo codegen` removes it from an existing output
  directory.
- `helpers.mjs` exports only what the generated modules import: 30.1 kB down to 23.7 kB.
- `css/cva.mjs` and `css/sva.mjs` drop from about 7.6 kB each to 0.3 kB, and `cva` no longer imports `mergeCss`.
- Config slot recipes no longer expose slot accessors (`recipe.root(props)`, `recipe.icon`). Those were reads of the
  binding and failed the build; `recipe(props).root` is the spelling that compiles.
- `auditSlotScopes` is removed from `styled-system/css`. It took recipe objects as arguments, which is itself a
  `runtime-binding`, so it could not be called from a build that compiled. The compiler emits no `@scope` rules, so it
  had nothing left to report.
- `scopeRoots` is still accepted in a slot recipe config and is marked deprecated, since it has no effect on compiled
  output.

CSS output is unchanged. The compiled bundle is unchanged too: the bundle-size fixture measures 2,151 B before and
after, because the compiler already removed these calls.
