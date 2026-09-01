---
'@bamboocss/core': minor
'@bamboocss/generator': minor
'@bamboocss/types': minor
'@bamboocss/shared': minor
---

Report a declaration in the emitted stylesheet that is not valid CSS for its property.

- New `invalidDeclaration` option — `'off' | 'warn' | 'error'`, default `'warn'` — asked of the finished sheet, after
  every utility transform, mixin, recipe and the reset has had its say. `bgLinear: '65deg'` reaches the sheet as
  `background-image: 65deg`, which parses, so nothing objected; the browser drops it at compute time.
- `error` fails the build with `ERR_BAMBOO_INVALID_DECLARATION`, listing every such declaration in the sheet. `warn`
  reports each one once per process.
- A value reading `var()`, `env()`, `attr()` or `if()` is not checked, since the grammar cannot see what will be
  substituted, and a property the grammar does not know is not reported. A value naming a token that does not exist
  belongs to `unresolvedToken`, whatever that is set to, and is never reported here.
