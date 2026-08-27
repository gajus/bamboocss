---
'@bamboocss/extractor': minor
'@bamboocss/parser': minor
'@bamboocss/node': minor
'@bamboocss/vite': minor
---

Extract through the TypeScript 7 backend, and stop shipping ts-morph.

Every AST call site in the extractor, parser, node runtime and Vite plugin now reads through `@bamboocss/ts-ast`.
`ts-morph` is no longer a dependency of any of them, so it is no longer installed into a consumer's tree — it survives
only as a dev dependency of the two benchmarks that compare the backends.

Emitted CSS is unchanged. The codegen scenarios regenerate to a byte-identical tree — 248 files, same hash — which is
the property that mattered most: this is a change of how bamboo reads source, not of what it decides.

The swap is mostly mechanical, and the parts that are not are where ts-morph's API meant something the compiler's does
not. Each of these was a silent wrong answer rather than a crash:

- **`getLiteralText()` returned the cooked value, not the source span.** Read as source, a quoted key keeps its quotes
  and `` `1px ${token(…)}` `` reaches the stylesheet with its backticks intact.
- **`getNameNode()` on an import specifier is the _imported_ name**, where TypeScript puts that under `propertyName` and
  the local binding under `name`. Reading `name` resolves an aliased import against its alias, finds no such export, and
  drops the styles it named.
- **`getProperty()` covered type literals too**, whose members live under `members` rather than `properties`. Without it
  a `declare const tokens: { readonly shadows: … }` resolves to nothing, and a lookup miss poisons the whole literal —
  every property after the first quoted key disappeared with it.
- **`isNamespaceExport()` meant both `export *` and `export * as ns`.** Seeing only the first lets a module that
  re-exports the runtime be compiled away.
- **`parseDiagnostics` was a property on the source file.** TypeScript 7's nodes are views over a buffer another process
  owns and carry no such property, so the guard the token accounting uses to decline a file it cannot parse read as
  "parsed cleanly" — and pruned tokens that were live.
- **A hole in an array binding pattern** was its own node in TypeScript 6 and is a nameless `BindingElement` now, so
  `([, value]) => …` stopped evaluating and a `clsx`-style helper silently contributed no classes.

Two things the compiler does not do at all, and now bamboo does:

- **Module resolution reads through the project.** A file the bundler handed over as text exists only in the overlay,
  and a resolver that reads past it to the disk cannot place a relative import at all.
- **`.vue`, `.svelte` and `.astro` are parsed under an alias.** TypeScript 7 decides script kind from the extension and
  refuses what it does not recognise, whatever text is supplied — so a single-file component, whose script block a
  `parser:before` hook has already turned into TSX, is held under a name the compiler accepts and reported under its
  own.
