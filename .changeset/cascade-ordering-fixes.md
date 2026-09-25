---
'@bamboocss/core': patch
---

Fix two cases where a longhand could lose to the shorthand it was written to override.

- **`@starting-style`:** the rule sort treated two at-rules without parameters as each ordered before the other. Which
  of `margin` and `margin-top` came first under `_starting` then depended on which one the build met first.
- **Merging identical declarations:** a declaration could be moved across a shorthand that sets it. Merging
  `.a { top: 0 }` with `.b { inset: 5px; top: 0 }` hoisted `top` above `inset`, so `.b` rendered with `inset`. The merge
  only treated properties as conflicting when their names shared a prefix. It now knows the shorthands whose longhands
  are named differently: `inset`, `gap`, `font`, `grid-area`, `place-*`, `flex`, `background`, and others.

The stylesheets of every sandbox that extracts are byte-identical. Only projects that hit one of these orders change.
