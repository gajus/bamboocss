---
'@bamboocss/node': minor
'@bamboocss/types': minor
'@bamboocss/reporter': patch
'@bamboocss/dev': patch
'@bamboocss/vite': patch
---

The TypeScript extraction engine is removed. Extraction and the Vite compiler both run on the Rust engine, so nothing in
a build starts the TypeScript compiler.

`@bamboocss/parser`, `@bamboocss/extractor` and `@bamboocss/ts-ast` are no longer published or depended on. The
stylesheet is byte-identical on every sandbox that extracted before.

- `BambooContext.project` is now a `SourceProject`: disk with caller-supplied bytes layered over it (`addSourceFile`,
  `overlaySource`, `removeSourceFile`, `reloadSourceFile`, `getSourceText`). It holds no AST.
- `ParserResult` moves into `@bamboocss/node` and is exported from it. Result items no longer carry a `box`, and the
  unused `cvaCall` bucket, `merge` and export-read digests are removed. `ResultItem.data` is typed as plain objects.
- Watch rebuilds select dependents from the Rust evaluator's read graph, which also covers a module appearing where an
  import was waiting for it.
- A relative `cwd` passed straight to a `BambooContext` is resolved to an absolute path. It used to make every
  `parseFile` return nothing, with no error.

The Rust engine also covers shapes only the TypeScript engine handled:

- A member-expression JSX tag, such as `<Tabs.Root>`, is matched against a recipe's `jsx` patterns.
- A `.js` or `.jsx` file may contain JSX.
- A config recipe called with a variant it cannot read (`button({ size })`) emits every value that variant can take.
- `css(recipe.raw(), …)` on an inline `cva` recipe reports `unresolved-raw`.
- A nullish declaration is dropped from style data whether it is written `null` or `undefined`, so the two spellings
  name the same inline recipe.
- A name declared twice, which TypeScript reports and a bundler still compiles (two Svelte `<script>` blocks declaring
  one type, say), no longer fails the whole file.

Two behaviours differ from the TypeScript engine:

- A bare `css(…)` that nothing imported from a bamboo entrypoint is not extracted, including one imported from a module
  that does not export it (`import { css } from 'styled-system/jsx'`). The TypeScript engine matched the name alone,
  which emitted rules the Vite compiler never used.
- `.raw` spreads of different patterns are recorded in source order. Where two of their atoms land in the same sublayer,
  their relative order within it can change.
