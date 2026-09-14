---
'@bamboocss/shared': patch
'@bamboocss/vite': patch
---

Merge a top-level `base` into the rest of a `css()` call instead of letting it replace the blocks they share.
`css({ _hover: { color: 'red.300' } }, { base: { _hover: { bg: 'blue.500' } } })` compiled to `hover:bg_blue.500` alone:
the `_hover` block in `base` replaced the one beside it, so the red declaration's class was never put on the element,
although its rule was still emitted into the stylesheet. Both classes are now named, and a declaration repeated in
`base` still wins.
