---
'@bamboocss/node': patch
---

Accelerate cold stylesheet extraction with a batched Rust/Oxc kernel while retaining the TypeScript extractor as a
per-file and per-platform fallback.

Vite module folding and incremental resolution continue to use the TypeScript backend. Prebuilt binaries ship inside
`@bamboocss/node` for macOS arm64/x64, glibc Linux arm64/x64, and Windows x64.
