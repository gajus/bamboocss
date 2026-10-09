---
'@bamboocss/vite': patch
---

Fail the build on a nested key that is neither a property nor a condition, instead of compiling it to a class no rule
matches.

- `css({ _hovr: { color: 'red.300' } })` compiled to `_hovr:c_red.300`, while the stylesheet dropped the key and wrote
  the `color` with no condition at all, so the element went unstyled and nothing said so. The call is now reported where
  it is written, with what the key was probably meant to be:
  ``css() — unknown-condition: `_hovr` is not a condition; did you mean `_hover`?``.
- A selector written without `&` is reported the same way, with the key it needs: `svg` → `'& svg'`, `has: { svg: … }` →
  `'&:has(svg)'`, `:hover` → `'&:hover'`.
- In a recipe, the declaration holding the key reports it, and so does any call compiling the variant it is in.
