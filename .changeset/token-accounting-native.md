---
'@bamboocss/node': patch
'@bamboocss/parser': patch
---

Run token accounting in Rust, so a stylesheet build no longer starts the TypeScript compiler.

Token pruning is on by default, and deciding what to keep walked each file's TypeScript tree. Asking for that tree
started the Go compiler over the whole inventory on every build, even though extraction had already happened in Rust and
needed nothing from it. Accounting now runs in the native extractor, and `readSnapshot` reads the text extraction saw —
the `parser:before` output — instead of a TypeScript source file.

The rules are unchanged and every case in the existing accounting suite passes against the new implementation. Scope is
now decided by Oxc's symbol resolution rather than by range containment over scopes that bind the name, so `token` is
the artifact exactly when it resolves to an import of it.

On `sandbox/vite-ts`, `cssgen` goes from 29.3 ms to 17.6 ms (median of five warm runs, same machine), and the compiler
is never materialized.

Deleting a file under `cssgen --watch` also releases its styles when the compiler never loaded the file. That release
used to happen only because accounting had loaded every file.
