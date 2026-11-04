---
'@bamboocss/core': patch
---

A declaration written later in the same style object no longer replaces an important one unless it is important too, as
CSS does not within one rule.

- `{ color: 'red !important', mixin: 'body' }` took the mixin's color in `css()`, in recipes and in `global.css`. It
  keeps red, and a mixin's own important value survives a property written after it.
- In `global.css`, and in a recipe written to its own layer, `{ display: 'block !important', stack: true }` wrote
  `display: flex` where the `stack` utility writes `display`. It keeps the block.
- A later important value still replaces an earlier one, and composing two style objects, `css(a, b)`, still lets the
  later one's value win.
