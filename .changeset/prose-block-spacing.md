---
'@bamboocss/preset-bamboo': patch
---

Give unstyled direct children in `prose()` the default block gap, with lower precedence than element and component
styles. Keep `.lead` and first-child margins ahead of the default paragraph gap, and respect `notProse` on opted-out
blocks.
