---
'@bamboocss/vite': patch
'@bamboocss/node': patch
'@bamboocss/plugin-svelte': patch
---

Fail the build when the compiler emits a class whose call the stylesheet pass never saw, instead of shipping the class
with no rule.

- The compiler reads a module as Vite hands it over; the stylesheet pass reads the source, and a single-file component
  through a conversion of it. A call the conversion missed compiled to a class nothing styled, with no error. The build
  now names the class and the file whose call produced it. Classes passed through `cx()` as written are not Bamboo's and
  are not checked.
- Fixed the two conversions that missed calls: a Svelte `{@const cls = css({ … })}`, and an Astro client `<script>`,
  which Astro bundles as a module of its own.
