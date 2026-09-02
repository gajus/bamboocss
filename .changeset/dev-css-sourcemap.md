---
'@bamboocss/vite': minor
'@bamboocss/core': minor
'@bamboocss/generator': minor
'@bamboocss/node': minor
'@bamboocss/parser': patch
'@bamboocss/ts-ast': patch
---

Serve the development stylesheet with a source map to each rule's first call site.

- With Vite's `css.devSourcemap` on, the dev server's `virtual:bamboo.css` carries a map from every rule to the `css()`,
  pattern, `cva()` or `sva()` call that first wrote its atom, so DevTools names the file and line beside a rule instead
  of the virtual module. Vite reads the sources in and inlines the map, as it does for any stylesheet's.
- The extraction pass records each atom's first call site only when asked — `StyleEncoder.recordOrigins`, set through
  `Builder.setup({ atomOrigins: true })` — and reads them back with `getAtomOrigins()`, by class name. Nothing is
  recorded otherwise, and builds are unaffected.
- Config recipes, `staticCss` and `globalCss` have no call site and stay unattributed, as does a file a `parser:before`
  hook rewrote.
- `getLineAndColumnAtPos` in `@bamboocss/ts-ast` now computes a file's line starts once and searches them, instead of
  slicing and splitting the text up to every offset.
