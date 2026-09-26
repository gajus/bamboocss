---
'@bamboocss/core': patch
---

Fix a large stylesheet-build slowdown in 1.55.8 and 1.56.0.

The fix in 1.55.8 that keeps every file's declaration order sorted the whole collection of atoms each time a file's
contribution changed. A pass therefore paid for that sort once per file, and the cost grew with the square of the
project. On a 4,665-file app, `cssgen` went from 8.5 s in 1.55.0 to 109 s, and every CI job that starts the Vite plugin
paid the same ~110 s in `buildStart`. The sort now runs once, when the order is next read: `cssgen` on that app takes 6
s.

The layout now depends only on the current files, not on the order they were read in. Before, where two files demand
opposite orders of the same atoms, a watch rebuild could lay out a different sheet from a cold build of the same source.

- Every sandbox's stylesheet is byte-identical to 1.56.0.
- Where files conflict, some atoms can sit in a different order within their sublayer. On that app, the constraints that
  can all be satisfied are contradicted less often than in 1.56.0 (43 of 1,935 against 131).
