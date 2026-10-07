---
'@bamboocss/vite': patch
---

Keep breakpoint precedence in per-route stylesheets when the CSS minifier removes the sublayer order statement.

- LightningCSS, which is Vite 8's default CSS minifier and what `pluginLightningcss()` runs, folds the `@layer` order
  statement into the order of the blocks. `splitCss` relied on that statement to keep the utility sublayers in order
  across the entry sheet and each route's sheet, so a lower breakpoint used only by a lazily loaded route could beat a
  higher one kept in the entry, in production builds only.
- The split now rebuilds the statement from the order of the blocks and writes it into the entry sheet as well as every
  route sheet. Sheets whose statement survived (esbuild, or no minification) are emitted byte-for-byte as before.
