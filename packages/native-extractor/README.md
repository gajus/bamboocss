# @bamboocss/native-extractor

Rust/Oxc extraction engine used by Bamboo. It parses a source inventory behind one N-API call, statically evaluates
Bamboo calls and their local/cross-file value graph, and returns compact encoder data rather than native AST nodes.

The engine handles local constants and helpers, imports and re-exports, tsconfig path mappings, package import maps,
recipes, patterns, tokens, `css.raw()`, conditionals, spreads, and JSX recipe props. Parser diagnostics fail the build;
dynamic values are omitted with the same unresolved-style reporting used by Bamboo's encoder. Parser hooks still run at
the JavaScript boundary before and after native analysis.

`@bamboocss/node` contains required prebuilt binaries for macOS, Linux with glibc, Linux with musl and Windows, each on
arm64 and x64. The release workflow builds the Linux ones with cargo-zigbuild, so the glibc binaries need no glibc newer
than 2.17 (`sh scripts/build.sh --release --target x86_64-unknown-linux-gnu.2.17`). A missing or unsupported binary is
an extraction error; there is no TypeScript extraction fallback or environment-variable opt-out.

## Development

```sh
pnpm --filter=@bamboocss/native-extractor build-fast
pnpm test packages/native-extractor
```

`analyzeMany()` is the production boundary. Keep ASTs and expression graphs in Rust and return only compact calls,
diagnostics, source locations, and resolution read sets.
