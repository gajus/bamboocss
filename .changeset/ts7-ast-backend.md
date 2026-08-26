---
'@bamboocss/ts-ast': minor
---

Add the TypeScript 7 AST backend bamboo will extract through.

Extraction is the largest phase of a build and the AST layer is roughly 40% of it, so which layer bamboo builds on is
the lever on build time. ts-morph allocates a wrapper object per node as you walk, and that allocation — not the parse —
is what it charges for. TypeScript 7 parses in a Go process and hands back lazy views over a binary buffer, so the cost
disappears rather than moving.

Measured on 2,000 files of 10 `css()` calls each, building a program and walking every node, which is what a CLI build
and every CI run pay:

| backend                    | mean   |
| -------------------------- | ------ |
| ts-morph (today)           | 502 ms |
| TypeScript 7 (Go compiler) | 178 ms |

**2.82x**, with both walks reaching an identical 534,000 nodes. The existing `parser/__tests__/ast-backend.bench.ts`
reports 1.78x for the same swap because it times the walk with a program already built — the steady state a watching dev
server sees. This package's benchmark includes building the program, where TypeScript 7 wins by more.

Nothing wraps a node. The predicates are rebound from `unstable/ast/is` under the spelling the extractor already uses,
and everything else is a function over a node, so the views pass through untouched and the win survives.

Two differences from ts-morph come from the compiler living in another process, and both are handled:

- **There is no standalone parse.** No `ts.createSourceFile(text)`, no in-memory filesystem. Everything goes through a
  project rooted at a `tsconfig.json`, and a file's content is supplied by delegating the filesystem — which bamboo
  already does, since its runtime has always read through `runtime.fs` rather than `node:fs`.
- **A snapshot is a point in time.** Reading text that is not on disk — a module Vite has transformed, a `<script>`
  block lifted from a `.vue` file — goes through `withText`, which layers one file's content over a snapshot for the
  duration of a callback and then drops it.

The parity suite checks this backend against ts-morph on the same source rather than against hardcoded expectations:
identical node counts, identical `pos`/`end` offsets, the same imports, call expressions, string literals and property
names, working parent pointers, and that `withText` both applies and releases its override.

This package is not yet wired into the extractor. It is the backend; moving the call sites onto it is separate.
