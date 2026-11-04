---
'@bamboocss/core': patch
---

`global.css` reads a nested key named like a property as the selector it is when it holds styles.
`'.prose': { p: { color: 'red' } }` wrote `.prose { color: red }`, reading `p` as the padding shorthand, and under an
`@media` it wrote the declaration with no selector at all. It now writes `.prose p { color: red }`. `filter`, `font` and
`mask` name elements as well as properties, and are read the same way. A property holding conditions,
`p: { base: '2', md: '4' }`, is still that property.

- A breakpoint or another at-rule condition at the top, `md: { body: { … } }`, is the at-rule it stands for, as
  `'@media (width >= 48rem)': { body: { … } }` already was. It was written as a selector named `md`.
- What still cannot mean what it says is reported the way the config is: a warning, and an error under
  `validation: 'error'`. That is a condition at the top that applies to an element, `_dark: { body: { … } }`, which is
  written as a selector named `_dark`; a key read as an element no document has, `_hovr` or `has`; and a declaration
  with no selector above it.
