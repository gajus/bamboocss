---
'@bamboocss/generator': patch
---

Fold `light-dark()` at a token's color component instead of its whole value.

`light-dark()` is a `<color>` function — `light-dark(<color>, <color>)` — so it cannot carry a shadow, a border
shorthand or a length. The fold applied to any token with a `base`/`_osDark` pair regardless of category, so those
tokens emitted CSS the browser drops on the floor without a word:
`--shadows-sm: light-dark(0 1px 2px red, 0 1px 2px black)` computed `box-shadow: none`, and
`--sizes-gutter: light-dark(4px, 8px)` computed `0px`. Only colors ever worked.

The two arms are now compared component by component and only the parts that differ are folded, which keeps the geometry
outside the function where it parses:

```css
--shadows-sm: 0 1px 2px light-dark(red, black), 0 2px 4px light-dark(blue, white);
--borders-subtle: 1px solid light-dark(red, black);
```

That also folds a comma-separated list, which folding whole never could — the arity problem disappears when the commas
stay in the value. Multi-part elevation tokens, the shape a realistic shadow scale actually takes, fold for the first
time.

A part is only folded when it is provably a color: a hex, a color function, a color keyword, or a `var()` naming a token
from the `colors` category. Anything else keeps its `@media (prefers-color-scheme: dark)` block, as do arms whose list
or component counts disagree. A `colors` token still folds whole, so a raw `var()` pointed at a property bamboo never
emitted is unaffected.

This matters beyond the dropped declarations: a sheet that folded its colors and left its shadows on the media query
gave a `color-scheme: dark` subtree toggle half a theme, with the shadows still following the OS preference.
