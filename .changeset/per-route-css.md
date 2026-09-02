---
'@bamboocss/vite': minor
---

Give each lazily loaded chunk a stylesheet of the utilities only it uses.

- An atom only one lazily loaded chunk's modules emit is moved out of the entry sheet into a sheet of that chunk's own,
  attached where Vite's own plumbing reads it: the manifest lists it under the chunk, the preload helper fetches it
  before the chunk runs, and a framework that copies a build's stylesheets by the names its chunks recorded copies it
  too. An atom two chunks share, one the entry reaches, or one `staticCss` asked for stays in the entry sheet, so
  nothing is downloaded twice.
- Precedence is unaffected: it lives in the cascade sublayers, and every chunk sheet repeats the sublayer order
  statement. Builds only, and only where Vite's `build.cssCodeSplit` is on. `splitCss: false` keeps one sheet.
