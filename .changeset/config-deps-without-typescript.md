---
'@bamboocss/config': patch
'@bamboocss/vite': patch
---

Start `vite dev` without loading TypeScript. To find what the config imports, so that editing one restarts the server,
the plugin asked the TypeScript compiler to resolve each package the config names, and loading the compiler was a third
of a small app's start: 236ms became 159ms, and a 1,000-module app's 359ms became 280ms.

- A package import is resolved as the config bundle resolves it, through `exports` with esbuild's conditions, then
  `module` and `main`, and `#` imports through `imports`. It is followed only into TypeScript source, a workspace
  package whose `main` or `exports` name `src/index.ts`, as before. A build or an installed package is declared once the
  config has loaded, from the files its bundle read.
- Declaration files are no longer followed. They are never what the config runs, and `@bamboocss/dev` alone led to two
  of them. Where a package gave its types and its source different files, the types were followed and the source was
  not.
- `@bamboocss/config` no longer depends on TypeScript (24 MB installed), and its declarations no longer import types
  from it.
