---
'@bamboocss/vite': patch
---

Say so when a class the build finds without a rule had its rule moved into a chunk's own sheet by the per-chunk split. A
framework that copies an entry sheet into another output without its chunk sheets, as `@vitejs/plugin-rsc` did for a
server component loaded with `import()`, failed the build with a report blaming a theme value nothing resolves, such as
a `mixin` the theme does not define. The report now names the chunk and the environment that split the sheet, and says
the sheet checked is a copy of its entry sheet without those rules.
