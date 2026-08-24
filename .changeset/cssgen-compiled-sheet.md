---
'@bamboocss/node': minor
'@bamboocss/generator': minor
'@bamboocss/dev': minor
---

`bamboo cssgen` (and the CLI `bamboo` command) emit the same compiled stylesheet Vite serves.

Observed recipes are interned as shared utility atoms and the recipe layer is omitted, so a `cva()` or config-recipe
selection has the same class names in a cssgen sheet as in a Vite build. The previous split is why a consumer had to
avoid `cva` when the sheet came from cssgen.

`cssgen --splitting` still writes per-layer files; it no longer writes per-recipe files, because those rules are not in
the compiled sheet. A later compiled run deletes `styles/recipes/` and `styles/recipes.css` left by an earlier one.
