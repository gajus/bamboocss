---
'@bamboocss/core': patch
---

Write a token's value instead of a reference to it where the token is only the CSS value its name spells and no
condition or theme gives it another. `padding: '0'` compiled to `var(--spacing-0)` because `0` names a spacing token,
and the stylesheet declared that variable for it; it now compiles to `0rem`, the value the reference resolved to. The
same goes for `border: 'none'` (`borders.none`) and `background: 'transparent'` (`colors.transparent`), and for any
token of yours whose value its name spells, such as `colors.canvas: 'canvas'`. Across the CSS-in-JS benchmark's pages
this takes 3% off the stylesheet, and the browser no longer substitutes a variable for every element these declarations
style.

Class names do not change, and neither does a token with a value of its own: `padding: '4'` is still `var(--spacing-4)`,
`lineHeight: 'none'` is still `var(--line-heights-none)`, and a token a semantic condition or a `theme.variants` entry
overrides keeps its reference, which is how the other value applies. A stylesheet of your own that redefines one of
these variables at runtime, such as `--spacing-0`, no longer reaches the declarations that wrote the value.
