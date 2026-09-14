---
'@bamboocss/token-dictionary': patch
---

Fix two ways an opacity modifier broke the token that used it.

- A semantic token whose `base` mixed a color, such as
  `{ base: 'token(colors.black/87)', _dark: 'token(colors.white)' }`, lost its `_dark` value: no `.dark` block was
  emitted for it.
- A value that combined a modifier reference with any other reference failed the build with `Invalid color mix` — for
  example `0 0 0 1px token(colors.bg), 0 0 0 3px token(colors.red/50)`, or relative color syntax such as
  `rgb(from token(colors.red) r g b / 50%)`, whose slash is no modifier at all. Only references that carry a modifier
  are mixed now.
