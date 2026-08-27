---
'@bamboocss/ts-ast': patch
---

Remember a module resolution instead of re-deriving it for every importer.

Resolution walks candidates: every extension in turn, every `paths` target, every ancestor `node_modules`, each one a
`stat`. That walk was repeated in full for each importer that named the same specifier, and a project's files
overwhelmingly import the same handful of modules.

Measured on a 400-file build across 20 directories, the resolver was asked 446 times for **48 distinct answers** — a
9.3x repeat ratio — and its `stat` probes fell from **4,920 to 312**, a 93.7% reduction. Wall time on that build went
696ms to 559ms in the same process, though that half is machine-dependent and the probe count is the number worth
holding to.

The memo is keyed on the importer's _directory_ rather than the importer, because that is all resolution reads of it, so
files sharing a directory share the answer.

Its lifetime is the resolver's, which is already exactly right: a resolver is built once per `Project` and dropped
whenever the file tree changes. `resetResolutionState` says so directly — it drops the resolver only when the set of
files could have changed, and records that dropping it more eagerly measured +50% on a module with eight relative
imports. So this inherits an invalidation contract rather than inventing one, and a file written later still satisfies a
specifier that previously failed.

`paths` and `baseUrl` arrive per call and are part of the answer, so a change to either empties the memo rather than
being folded into every key. That is what keeps an alias table swap from being served from the previous one.

The remembered result is shared rather than copied. Its `failedLookups` and `affectingFiles` are read by the parser and
never mutated — `getLocalFailedLookupCandidates` takes them as `readonly` and builds its own array.

Resolution answers are unchanged, so no CSS moves. The repeat behaviour is pinned by tests that count probes rather than
time them, for the reason `shared/__tests__/memo.test.ts` counts serializations: a wall-clock threshold fails on a busy
machine instead of on a regression. `cross-file-cost` is neutral across the change (its control moved 3.4%, further than
either case), which is expected — it runs an in-memory project that never repeats a disk walk.
