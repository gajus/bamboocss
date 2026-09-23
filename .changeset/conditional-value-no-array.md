---
'@bamboocss/generator': minor
'@bamboocss/eslint-plugin': minor
---

Stop typing arrays as style values, and have `no-dynamic-styling` report them.

Array values are no longer read as one value per breakpoint: the runtime throws `INVALID_STYLE_VALUE` and the compiler
fails the build. `ConditionalValue` still admitted `Array<V | null>`, so `css({ fontWeight: ['bold', 'normal'] })`
type-checked and then broke the build. The generated type is now the value or a condition object, so the mistake shows
up in the editor instead.

`no-dynamic-styling` used to accept an array of literals as static. It now reports any array value with the new `array`
message, which points to the condition-object form: `{ base: 'medium', lg: 'bold' }`.
