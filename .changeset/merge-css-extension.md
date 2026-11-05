---
'@bamboocss/generator': patch
---

`css/merge-css.d.mts` imports `../types/index` with its extension under `forceConsistentTypeExtension`, as every other
generated declaration file does. It spelled the import by hand, without one, and failed type-checking with TS2834 under
`moduleResolution: nodenext`.
