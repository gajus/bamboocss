---
'@bamboocss/node': patch
---

Stop rewriting generated artifacts whose contents have not changed.

Codegen wrote every file in the output directory on every build, whether or not a byte had moved. The write itself is
cheap — 54 artifacts and 1.4 MB measure ~6ms, against ~1.3ms to read them back and compare — but the mtime is not.
Everything downstream watches that directory: the dev server's module graph, `tsc --incremental`, any bundler with it in
scope. Each of them was re-doing work for files identical to the ones it had already read, on every build.

Most builds move nothing. `csstype.d.ts` alone is 895 kB copied verbatim from a constant.

An unchanged rebuild now touches **0 of 54** artifacts rather than all of them. Adding one colour token rewrites exactly
the four files that contain it — `styles.css`, `tokens/index.mjs`, `tokens/tokens.d.ts` and `types/prop-type.d.ts` — and
leaves the other fifty alone.

`package.json` keeps its own path: it is merged with what the consumer already declared rather than overwritten, so its
generated contents never equal the file on disk.
