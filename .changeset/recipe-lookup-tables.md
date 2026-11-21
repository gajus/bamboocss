---
'@bamboocss/generator': patch
'@bamboocss/vite': patch
---

Declare a recipe lookup's table once at the top of the module, where it was built again inside the call on every render:
`badge({ tone })` now reads its table rather than allocating one. Calls that select alike share a table, and a slot
recipe's call still returns an object of its own.

- A table stays in its call where a statement comes before the module's first import, since that statement would run
  before anything declared there.
