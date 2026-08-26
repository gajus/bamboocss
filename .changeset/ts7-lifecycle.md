---
'@bamboocss/ts-ast': minor
---

Add the source-file lifecycle, over a compiler that owns its tree in another process.

Every consumer of the parser's project speaks the same four calls — `createSourceFile`, `reloadSourceFile`,
`removeSourceFile`, `addSourceFile` — so implementing them here is what lets the sixteen call sites in the CLI, the
builder, `generate` and the Vite plugin stay exactly as they are.

ts-morph could be handed a string because its filesystem lived in this process. TypeScript 7's Go compiler reads through
a delegate, so these become snapshot updates: say what moved, and let the other process re-read. That is a different
failure mode — the call can succeed while the program still holds the previous bytes — so each one is tested by reading
a value back out of the tree rather than by trusting that it returned.

`addSourceFile` is the one that needed design, because it installs content for a path that may have nothing behind it.
It writes to a per-project overlay that the filesystem delegate consults before bamboo's runtime and before the disk.
That ordering is the point: an overlay entry has to win over a real file under the same path, which is exactly the
bundler case — Vite hands over a module with JSX already lowered, so the bytes on disk are not the bytes to parse.

Two details that are easy to get wrong and are pinned by tests:

- **Directory listings include overlay entries.** The Go process builds its file set by enumerating what `include`
  resolves to, so a path that only answers `fileExists` is never asked for. Without this an auxiliary source — a block a
  framework plugin lifted out of a single-file component — is readable and still absent from the program.
- **Re-adding identical text is a no-op.** The transform path adds every module before parsing it, and on a 6,307-file
  build 6,001 of those were byte-identical to what the project already held. Charging a snapshot update for each would
  make the bundler pay a re-read per module per build.

`reloadSourceFile` and `removeSourceFile` drop any overlay for the path first, since both mean the installed content is
no longer the truth.
