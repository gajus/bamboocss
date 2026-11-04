---
'@bamboocss/config': patch
'@bamboocss/token-dictionary': patch
---

A color written out inside `token()` is taken for itself, not for a token, in a token's value and in a style value
alike.

- `token(#000/64)` resolved to `color-mix(in srgb, #000 64%, transparent)`, yet validation reported a missing token
  `#000`, which fails the config under `validation: 'error'`, and the build's unresolved-token report flagged it too.
- `token(rgb(0 0 0)/64)` passed validation and reached the css as written: its parentheses kept it from being read as a
  reference. It is now mixed like any other color, and so is one whose own alpha holds a slash,
  `token(rgb(0 0 0 / 50%)/64)`.
- `token(#000)` with no opacity became `var(--\#000)` in a token's value, a variable nothing declares. It is `#000`, as
  it already was in a style value.
