---
'@bamboocss/node': patch
'@bamboocss/shared': patch
'@bamboocss/vite': patch
---

Read an import whose specifier has a comment in front of it, `from /* the recipe */ './recipes'`, in both scans that
decide without parsing whether a module can reach bamboo, and count one spelled with an escape, `'./recipes'`.

- The Vite compiler skipped such a module: the build passed, and a recipe call in it shipped uncompiled, to throw when
  it was loaded, in the client and in SSR.
- Extraction dropped such a file whenever it imported anything else as well, so the classes its call asked for had no
  rule.
- A comment that only wraps after the word "from", or `Array.from(` with a comment before its argument, is still not an
  import, so a module that reaches nothing bamboo is still skipped.
