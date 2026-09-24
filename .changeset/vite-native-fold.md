---
'@bamboocss/vite': minor
'@bamboocss/node': patch
---

The Vite compiler now runs on the Rust extraction engine, so a transform never starts the TypeScript compiler.

Each module is analyzed in one native call that returns its calls, their values, and what may safely replace them.
JavaScript still decides class names, recipe tables, `cx` composition and the rewrite. On the benchmark modules a
transform takes 0.3–0.7 ms instead of 5–14 ms, and the stylesheet and the compiler now read cross-file values through
the same evaluator, so they cannot disagree.

- Some shapes now compile that the TypeScript engine declined: a destructured value with no default
  (`const { tone } = source`), an imported `css.raw` object spread inside a nested selector, and an argument computed by
  a function written and called in place (`css((() => ({ … }))())`).
- A recipe imported through a barrel now records only the modules on its re-export route as dependencies, rather than
  every module the lookup opened. Editing an unrelated component in the same barrel no longer re-transforms its
  consumers.
- `token(path, fallback)` now judges only the path by its value. The fallback is still required to be inert, and a path
  naming no token is reported as `unresolved-token` rather than `dynamic`.
- A recipe whose config cannot be compiled, such as one using a retired `{token}` reference, now fails the module rather
  than being erased silently.
- Export-read verification is removed. Deciding whether an edit changed a dependent's output now always re-folds it,
  which native analysis makes cheap.
