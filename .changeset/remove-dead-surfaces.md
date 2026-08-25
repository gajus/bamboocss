---
'@bamboocss/node': minor
'@bamboocss/generator': minor
'@bamboocss/core': patch
'@bamboocss/shared': patch
---

Remove obsolete PostCSS injection APIs and generated runtime modules. Compiled stylesheet assembly now emits recipe
declarations directly as shared utility atoms instead of creating named recipe layers and deleting them afterward.
