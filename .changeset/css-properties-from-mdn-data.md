---
'@bamboocss/is-valid-prop': patch
'@bamboocss/generator': patch
---

`css()` takes `textAutospace`, `objectViewBox`, `fontWidth`, `speakAs`, `viewTransitionClass`, `rubyOverhang`,
`scrollInitialTarget` and `strokeColor`. Each was a type error, TS2353, though csstype typed it: `SystemProperties`
takes its members from the css properties `@bamboocss/is-valid-prop` lists, and that list had been generated from an
older mdn-data than the one installed, with nothing to regenerate it.

The package's build now generates the list, from mdn-data 2.27.1 — the release css-tree reads for the build's grammar
check, so the two know the same properties — and CI fails when a build rewrites the committed copy. That adds 41
properties csstype does not type yet, among them `readingFlow`, `readingOrder` and the `corner-*-shape` longhands. They
take any value, which the grammar check judges at build time; indexed into csstype's types, their names would have been
an error in a project with `skipLibCheck` off.

The list also decides what counts as a css property where styles are filtered, so all 49 now reach the stylesheet from
there too. A pattern's style props dropped them — `flex({ textAutospace: 'normal' })` emitted no `text-autospace` — and
a global style dropped a condition object under one, `{ '.a': { readingFlow: { base: 'normal', md: 'grid-rows' } } }`,
whole.
