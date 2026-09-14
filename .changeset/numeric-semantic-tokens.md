---
'@bamboocss/token-dictionary': patch
---

Declare semantic tokens whose value is a number. `zIndex: { layer: { value: 10 } }` declared no variable at all, and
`opacity: { overlay: { value: { base: 0, _open: 1 } } }` declared only its `_open` value, because a base of `0` was
dropped as empty. Plain tokens already accepted numbers, and semantic tokens now do too.
