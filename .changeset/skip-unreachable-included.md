---
'@bamboocss/vite': patch
---

Skip compiling an included module that names no bamboo entrypoint and imports nothing the project holds, as a module
outside `include` already was. Parsing one finds no call to fold, and it cost about 0.6 ms a module per build
environment, 1.5 ms once the module imported packages: a 1,000-module app whose modules mostly hold no styles builds in
a quarter of the time.

- A package import counts when the project holds that package's files, so a workspace design system imported as
  `@acme/ds`, whose source `include` reaches, still has its callers compiled. That now holds for a caller another plugin
  rewrote first, as `@vitejs/plugin-react`'s babel pass does when listed ahead of `bamboocss()`, which shipped calling a
  recipe that no longer existed; and for one outside `include`, which the build now reports instead.
- Output is unchanged: the docs site's client and server builds, 676 files, are byte-identical.
