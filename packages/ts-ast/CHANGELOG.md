# @bamboocss/ts-ast

## 1.51.2

### Patch Changes

- b8236e1: Report a dead compiler process once, instead of once per file.

  Every file is parsed through a single TypeScript 7 process, so a process that ends mid-build — killed by the kernel on
  a machine that ran out of memory, or ended by its own panic — makes every remaining file fail with the same
  `EPIPE: broken pipe, write`. Extraction caught that per file and carried on, so one event became thousands of
  `Failed to parse` lines naming thousands of files that were fine, with the line that explained them buried somewhere
  above.
  - A channel error is now translated into a `CompilerGoneError` that says the compiler is gone, reports its exit status
    when Node has collected one, and points at the two things that end it: a panic trace on the inherited stderr, or the
    OOM killer when there is no trace.
  - The failure is latched, so a project that loses its compiler on file 40 does not go on writing to a closed pipe for
    the remaining 4,000.
  - `parseFile` no longer records it in `parseFailures`. That map is a list of files to fix and is cleared only by a
    file parsing successfully, so a compiler death recorded there named the whole inventory and went on naming it after
    the compiler had been replaced.

## 1.51.1

### Patch Changes

- 52e0a17: Remember a module resolution instead of re-deriving it for every importer.

  Resolution walks candidates: every extension in turn, every `paths` target, every ancestor `node_modules`, each one a
  `stat`. That walk was repeated in full for each importer that named the same specifier, and a project's files
  overwhelmingly import the same handful of modules.

  Measured on a 400-file build across 20 directories, the resolver was asked 446 times for **48 distinct answers** — a
  9.3x repeat ratio — and its `stat` probes fell from **4,920 to 312**, a 93.7% reduction. Wall time on that build went
  696ms to 559ms in the same process, though that half is machine-dependent and the probe count is the number worth
  holding to.

  The memo is keyed on the importer's _directory_ rather than the importer, because that is all resolution reads of it,
  so files sharing a directory share the answer.

  Its lifetime is the resolver's, which is already exactly right: a resolver is built once per `Project` and dropped
  whenever the file tree changes. `resetResolutionState` says so directly — it drops the resolver only when the set of
  files could have changed, and records that dropping it more eagerly measured +50% on a module with eight relative
  imports. So this inherits an invalidation contract rather than inventing one, and a file written later still satisfies
  a specifier that previously failed.

  `paths` and `baseUrl` arrive per call and are part of the answer, so a change to either empties the memo rather than
  being folded into every key. That is what keeps an alias table swap from being served from the previous one.

  The remembered result is shared rather than copied. Its `failedLookups` and `affectingFiles` are read by the parser
  and never mutated — `getLocalFailedLookupCandidates` takes them as `readonly` and builds its own array.

  Resolution answers are unchanged, so no CSS moves. The repeat behaviour is pinned by tests that count probes rather
  than time them, for the reason `shared/__tests__/memo.test.ts` counts serializations: a wall-clock threshold fails on
  a busy machine instead of on a regression. `cross-file-cost` is neutral across the change (its control moved 3.4%,
  further than either case), which is expected — it runs an in-memory project that never repeats a disk walk.

## 1.51.0

## 1.50.1

## 1.50.0

### Minor Changes

- cc61685: Add the TypeScript 7 AST backend bamboo will extract through.

  Extraction is the largest phase of a build and the AST layer is roughly 40% of it, so which layer bamboo builds on is
  the lever on build time. ts-morph allocates a wrapper object per node as you walk, and that allocation — not the parse
  — is what it charges for. TypeScript 7 parses in a Go process and hands back lazy views over a binary buffer, so the
  cost disappears rather than moving.

  Measured on 2,000 files of 10 `css()` calls each, building a program and walking every node, which is what a CLI build
  and every CI run pay:

  | backend                    | mean   |
  | -------------------------- | ------ |
  | ts-morph (today)           | 482 ms |
  | TypeScript 7 (Go compiler) | 206 ms |

  **2.34x**, with both walks reaching an identical 534,000 nodes, and both paying to install the files first.
  `parser/__tests__/ast-backend.bench.ts` reports 1.93x for the same swap because it times the walk with a program
  already built — the steady state a watching dev server sees. This package's benchmark includes building the program,
  where TypeScript 7 wins by more.

  Nothing wraps a node. The predicates are rebound from `unstable/ast/is` under the spelling the extractor already uses,
  and everything else is a function over a node, so the views pass through untouched and the win survives.

  Two differences from ts-morph come from the compiler living in another process, and both are handled:
  - **There is no standalone parse.** No `ts.createSourceFile(text)`, no in-memory filesystem. Everything goes through a
    project rooted at a `tsconfig.json`, and a file's content is supplied by delegating the filesystem — which bamboo
    already does, since its runtime has always read through `runtime.fs` rather than `node:fs`.
  - **A snapshot is a point in time.** Reading text that is not on disk — a module Vite has transformed, a `<script>`
    block lifted from a `.vue` file — means installing it into the project's overlay, which the delegate consults ahead
    of the disk, and telling the compiler the file moved.

  The parity suite checks this backend against ts-morph on the same source rather than against hardcoded expectations:
  identical node counts, identical `pos`/`end` offsets, the same imports, call expressions, string literals and property
  names, and working parent pointers.

- c1870de: Open the compiler on bamboo's own config, and install a project's inventory in one call.

  Two costs, both paid per `Project`, and bamboo builds one per context.

  **The program.** Opening the user's `tsconfig.json` builds the program it describes: every file its `include` reaches,
  every `@types` package, the standard library, and the transitive closure of every import. bamboo reads none of that.
  It never asks a type question — `no-language-service` pins that — and it resolves modules itself, so the compiler is
  here to parse the files it is handed and nothing else.

  So it is opened on a config bamboo writes to its own virtual disk: `files` naming exactly the installed set,
  `noResolve` so imports do not drag more in, and `noLib` with `types: []` for the library a checker would read.
  Measured on one file inside this repository:

  | opened on                   | compiler RSS |
  | --------------------------- | ------------ |
  | the repository's `tsconfig` | 2023 MB      |
  | bamboo's synthesized config | 19 MB        |

  The same tree is parsed either way. `openFiles` is deliberately not used for this: it is the LSP's way in, and it
  searches ancestor directories for a tsconfig containing the file — inside any real checkout it finds the user's, and
  loads that whole project again.

  **The round trips.** Membership is that config's `files` list, so installing a source is an edit to it. Announced one
  file at a time, a 2,000-file project is 2,000 round trips each carrying a list one entry longer than the last —
  quadratic, and paid on every cold build. It measured **65x slower than ts-morph** before this. `addSourceFiles` takes
  the inventory in one call, and single edits defer until something reads, so a bulk install is a single update:

  | 2,000 files, build a program and walk every node | mean   |
  | ------------------------------------------------ | ------ |
  | ts-morph                                         | 482 ms |
  | TypeScript 7, one install at a time              | 36.9 s |
  | TypeScript 7, batched                            | 206 ms |

  Also here: a `Project` owns a compiler process and nothing was closing them. `dispose()` closes one, an abandoned
  candidate closes itself, and a project that becomes unreachable is closed by a `FinalizationRegistry` — with a
  process-exit hook for whatever is still open when the run ends.

- 0c1a53a: Add the source-file lifecycle, over a compiler that owns its tree in another process.

  Every consumer of the parser's project speaks the same four calls — `createSourceFile`, `reloadSourceFile`,
  `removeSourceFile`, `addSourceFile` — so implementing them here is what lets the sixteen call sites in the CLI, the
  builder, `generate` and the Vite plugin stay exactly as they are.

  ts-morph could be handed a string because its filesystem lived in this process. TypeScript 7's Go compiler reads
  through a delegate, so these become snapshot updates: say what moved, and let the other process re-read. That is a
  different failure mode — the call can succeed while the program still holds the previous bytes — so each one is tested
  by reading a value back out of the tree rather than by trusting that it returned.

  `addSourceFile` is the one that needed design, because it installs content for a path that may have nothing behind it.
  It writes to a per-project overlay that the filesystem delegate consults before bamboo's runtime and before the disk.
  That ordering is the point: an overlay entry has to win over a real file under the same path, which is exactly the
  bundler case — Vite hands over a module with JSX already lowered, so the bytes on disk are not the bytes to parse.

  Two details that are easy to get wrong and are pinned by tests:
  - **Directory listings include overlay entries.** The Go process builds its file set by enumerating what `include`
    resolves to, so a path that only answers `fileExists` is never asked for. Without this an auxiliary source — a block
    a framework plugin lifted out of a single-file component — is readable and still absent from the program.
  - **Re-adding identical text is a no-op.** The transform path adds every module before parsing it, and on a 6,307-file
    build 6,001 of those were byte-identical to what the project already held. Charging a snapshot update for each would
    make the bundler pay a re-read per module per build.

  `reloadSourceFile` and `removeSourceFile` drop any overlay for the path first, since both mean the installed content
  is no longer the truth.

- 64a9b2f: Add module resolution, since TypeScript 7 does not expose any.

  The Go compiler resolves internally to build its program and hands back neither the resolved graph nor the probes it
  tried. `Program` offers `getSourceFile`, `getSourceFileNames` and per-file metadata, and nothing that answers "what
  did specifier X in file Y resolve to". So resolution becomes bamboo's.

  The path is the easy half. The probes are the half that matters: `failedLookups` is what decides whether an unresolved
  specifier is _local_, and therefore whether a file written later can satisfy it. A resolver that returns the right
  path and the wrong probe list passes every obvious test and then stops the dev server noticing that a new file
  completed a broken import — silently, because the import was already broken.

  Split by specifier shape, because the halves need different things:
  - **Relative, absolute, and `paths`/`baseUrl`-mapped** specifiers enumerate their candidates here. That is exact:
    every candidate not found is a path that would resolve if written, which is precisely the list the local-specifier
    test wants. Extensions are offered in TypeScript's order, `.ts` before `.js`, so an import never lands on a build
    artifact when both are present.
  - **Bare** specifiers go to `oxc-resolver`, which implements Node's algorithm including `exports`/`imports` and
    reports the `package.json` that decided the resolution — the `affectingFiles` a watch rebuild has to invalidate on.

  Reads go through the same `FileSystemDelegate` as the AST backend, so a synthesized source resolves like a real one,
  and `undefined` falls through to the disk.

  Tested against `ts.resolveModuleName` on a fixture rather than against fixed expectations: siblings,
  directory-through-index, parent segments, `paths` substitution and `baseUrl`, plus the probe list for specifiers that
  resolve to nothing.
