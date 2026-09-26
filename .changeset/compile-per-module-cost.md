---
'@bamboocss/node': patch
---

Stop the Vite compiler from redoing project-wide work for every module it compiles.

A production build of a 7,500-file app timed out at 30 minutes in 1.56.x, and 99% of that was the compiler. Two costs
scaled with the size of the project instead of the module:

- **Auxiliary files re-read on every transform.** Every project carries a `parser:before` hook, because the framework
  converters are built in. So each compiled module read and hooked every local import target outside `include`: 3,615
  files per module on that app. These are now prepared once per inventory and reused until the file changes.
- **The imported-recipe lookup walked the whole import graph.** To learn whether an import is a recipe, the compiler
  searched the imported module's re-exports, and in doing so followed every import that module made, recursively. For a
  component file that is most of the app. It now follows only imports the module actually re-exports. One component file
  went from 3 s to 75 ms.

On that app the compiler's share of `vite build` drops from over 25 minutes to about 14 s.
