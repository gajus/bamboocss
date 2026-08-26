---
'@bamboocss/ts-ast': minor
---

Add module resolution, since TypeScript 7 does not expose any.

The Go compiler resolves internally to build its program and hands back neither the resolved graph nor the probes it
tried. `Program` offers `getSourceFile`, `getSourceFileNames` and per-file metadata, and nothing that answers "what did
specifier X in file Y resolve to". So resolution becomes bamboo's.

The path is the easy half. The probes are the half that matters: `failedLookups` is what decides whether an unresolved
specifier is _local_, and therefore whether a file written later can satisfy it. A resolver that returns the right path
and the wrong probe list passes every obvious test and then stops the dev server noticing that a new file completed a
broken import — silently, because the import was already broken.

Split by specifier shape, because the halves need different things:

- **Relative, absolute, and `paths`/`baseUrl`-mapped** specifiers enumerate their candidates here. That is exact: every
  candidate not found is a path that would resolve if written, which is precisely the list the local-specifier test
  wants. Extensions are offered in TypeScript's order, `.ts` before `.js`, so an import never lands on a build artifact
  when both are present.
- **Bare** specifiers go to `oxc-resolver`, which implements Node's algorithm including `exports`/`imports` and reports
  the `package.json` that decided the resolution — the `affectingFiles` a watch rebuild has to invalidate on.

Reads go through the same `FileSystemDelegate` as the AST backend, so a synthesized source resolves like a real one, and
`undefined` falls through to the disk.

Tested against `ts.resolveModuleName` on a fixture rather than against fixed expectations: siblings,
directory-through-index, parent segments, `paths` substitution and `baseUrl`, plus the probe list for specifiers that
resolve to nothing.
