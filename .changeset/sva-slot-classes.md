---
'@bamboocss/types': patch
'@bamboocss/generator': patch
---

An inline `sva()` call is typed as returning a class string for every slot, as a config slot recipe already was.
Compiled, it names each slot's classes, an empty string for a slot with no styles, but its type gave each slot as
`string | undefined`, so every use of one took a `!` or a fallback for an `undefined` that never comes.
