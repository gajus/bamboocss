# @bamboocss/native-extractor

Rust/Oxc extraction kernel used by Bamboo's cold stylesheet pass. It parses a complete source inventory behind one N-API
call and returns compact call data rather than exposing native AST nodes to JavaScript.

Bamboo accepts native output only when the file is complete and safe for stylesheet generation. Unsupported syntax,
cross-file values, parser hooks, JSX extraction, unavailable native binaries, and parser diagnostics automatically use
the TypeScript extractor. Vite continues to use TypeScript for per-module folding and incremental resolution metadata.

`@bamboocss/node` contains prebuilt binaries for macOS (arm64 and x64), glibc Linux (arm64 and x64), and Windows x64.
Other platforms retain Bamboo's TypeScript path. Set `BAMBOO_DISABLE_NATIVE_EXTRACTION=1` to force that fallback for
troubleshooting or differential validation.

## Development

```sh
pnpm --filter=@bamboocss/native-extractor build-fast
pnpm test packages/native-extractor
```

`analyzeMany()` is the production boundary. `complete: false` and `safe: false` are mandatory fail-open signals and must
never be overridden by a caller.
