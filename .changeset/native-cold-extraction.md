---
'@bamboocss/node': minor
---

Migrate stylesheet extraction to a native Rust/Oxc evaluator.

Extraction now handles local and cross-file values, helpers, re-exports, path and package aliases, recipes, patterns,
tokens, JSX recipe props, parser hooks, diagnostics, source origins, and incremental dependency invalidation without a
TypeScript extraction fallback. Prebuilt binaries ship inside `@bamboocss/node` for macOS arm64/x64, glibc Linux
arm64/x64, and Windows x64.
