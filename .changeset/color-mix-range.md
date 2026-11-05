---
'@bamboocss/core': patch
'@bamboocss/token-dictionary': patch
---

An opacity modifier outside 0 to 100 is no longer written into a `color-mix()` the browser refuses. `red.500/150` wrote
`color-mix(in srgb, var(--colors-red-500) 150%, transparent)`, which reads a variable and so passed every check the
sheet makes, while the browser dropped it and the color was absent with nothing said.

- In a style, the value is written as it is, `color: red.500/150`, and the sheet reports it as a declaration that is not
  valid CSS, as it reports `red.500/unknown`.
- In a token's value, `token(colors.red.500/150)` fails the build as an invalid color mix, as an unknown opacity already
  did.
- An opacity token holding more than 1 is out of range the same way.
