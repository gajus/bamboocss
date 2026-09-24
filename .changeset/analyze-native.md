---
'@bamboocss/reporter': minor
'@bamboocss/node': patch
'@bamboocss/parser': minor
---

`bamboo analyze` and the MCP usage report now read the build's own extraction.

The report used to extract every file a second time through the TypeScript engine. That engine could disagree with the
Rust extraction the build uses, so the report could describe styles the build never emitted, and running it started the
TypeScript compiler. `Reporter` now takes the build's `parseFile` and `parserOptions` instead of a `project`, and
classification moves from `@bamboocss/parser` into `@bamboocss/reporter`. `Project.classify` is removed.

- Every property of a call now reports its call's source location. Extraction reports one location per call, not per
  property.
- Values nested under conditions in config recipes and global CSS are now counted: `_hover: { color: 'brand' }` in a
  recipe was skipped before. On the fixture preset this raises the reported "hardcoded" counts for `fontSizes` (5 → 7)
  and `colors` (6 → 9).
- Both branches of a statically enumerable ternary at a call site are counted.

The TypeScript-only dependent verification in `Builder` is also removed (the recipe-surface and export-read digests).
Native extraction never produced the records it consulted, so it could not run.
