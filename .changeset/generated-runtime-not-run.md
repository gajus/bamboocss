---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Extraction no longer runs what bamboo generates for `css()`, `cx()`, `cva()`, `sva()`, a recipe or a pattern when it
evaluates a value holding a call to one. None of them can give the build a value, yet every call parsed its module
afresh. Once a project has a recipe, extraction evaluates every JSX attribute, `className={css(…)}` among them, and that
was most of its time: a 1,000-module app whose components make those calls in JSX builds in 392 ms where it took 1,306,
and the docs site extracts in 12–18 ms where it took 104.

- A call the compiler cannot compile because a style reads such a call's result, as `css(flex({ gap: '2' }))` does, now
  says so at that call: "`flex({ gap: '2' })` at src/card.ts:7:22 is a call the compiler replaces, so what it returns is
  not known at build time". It pointed at the `throw` in the generated helpers for `css()` and a pattern, and gave no
  reason for a recipe.
- Output is unchanged: the docs site's client and server builds, 676 files, are byte-identical.
