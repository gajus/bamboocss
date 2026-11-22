---
'@bamboocss/generator': patch
'@bamboocss/vite': patch
---

Decide a recipe call's variants apart where each styles declarations of its own: `button({ size, tone, shape })`, with
`size` setting the padding, `tone` the color and `shape` the radius, compiles to a table per variant joined into the
same class string, where one table held every combination. Variants decided apart do not count toward one another's
`maxRecipeStates`, so a recipe with many such variants compiles where it failed the build.

- Variants are still decided together where they write the same property or into the same condition, where both override
  the base, or where a compound variant names them. A call composed with other styles in a `cx()` is decided whole.
- A call with 64 states or fewer keeps one table, which is quicker to read than segments joined on every call.
- A slot recipe's whole object is a lookup per slot, so each slot's table holds only the variants that style it.
