---
'@bamboocss/core': patch
---

A utility whose `values` callback returns nothing keeps the value as written. `theme('spacing')` returns nothing in a
theme with no spacing tokens, and indexing that threw on the first use of the utility; a callback returning `null`
failed the whole config. preset-base's `translateZ` returns just that, so `css({ translateZ: '4px' })` threw in a
project with no spacing tokens.
