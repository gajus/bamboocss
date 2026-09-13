---
'@bamboocss/types': patch
'@bamboocss/config': patch
---

Point `@bamboocss/types` at the declarations it ships. Since the move to tsdown, `main` and the `types` and `default`
conditions named `dist/index.d.cts`, but this package is not built by tsdown: its build copies each source file to
`dist/*.d.ts`, so no published tarball has contained the file its entry named.

TypeScript could not resolve `@bamboocss/types` in an installed project, under `bundler` and `NodeNext` alike. With
`skipLibCheck` on, nothing reported it: every type that other packages' declarations import from it became `any`, so
`defineConfig({ outdir: 42 })` type-checked cleanly. With it off, the failure surfaced as
`Cannot find module '@bamboocss/types'` inside `@bamboocss/dev`.

`@bamboocss/config` built its own declarations against the same entry, and two return types came out naming a type they
never imported: `loadConfig` now returns the `LoadConfigResult` from `@bamboocss/types`, and `mergeHooks` returns
`Partial<BambooHooks>`, as their sources do.
