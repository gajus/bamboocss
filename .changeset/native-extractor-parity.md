---
'@bamboocss/node': patch
'@bamboocss/plugin-vue': patch
'@bamboocss/plugin-svelte': patch
---

Stop shipping class names with no rule behind them, and stop failing Vue and Svelte builds on template syntax.

The stylesheet is extracted in Rust, while the class names written into compiled JavaScript came from the TypeScript
evaluator behind the Vite compiler. Wherever the two disagreed about a value, the JavaScript named a class the
stylesheet never emitted, and the build passed with the element rendering unstyled. The Rust evaluator now resolves the
shapes it was missing:

- Enum members, including `const enum`, auto-increment and members that reference earlier members. `declare enum` has no
  runtime object and stays unknown.
- Optional chaining. A nullish receiver short-circuits the rest of the chain to `undefined`, and `(o?.a).b` does not.
- `declare const`, which is now treated as an unknown ambient value rather than a known `undefined`. It was dropped from
  the style object while the call reported as complete.

A written property whose value cannot be read — `css({ color: tone })` — is now reported as `missing-property` for
`css()` and patterns, as it already was for recipes. It used to disappear with no warning.

`plugin-vue` and `plugin-svelte` now build their output from Vue's and Svelte's own parse trees instead of wrapping the
raw template as JSX. Oxc rejected that JSX on the first `{#if}`, `{#each}` or `{{ items[0] }}` and failed the build with
`EXTRACT_FAILED`. `plugin-svelte` now takes `svelte` as an optional peer dependency, and neither plugin depends on
`magic-string` any more.

A method of a local object literal is now called during evaluation — `helpers.size('sm')` where
`const helpers = { size(v) { … } }` — where it used to be unknown to Rust and resolved by TypeScript.
