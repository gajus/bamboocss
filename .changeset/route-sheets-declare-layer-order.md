---
'@bamboocss/vite': patch
---

Keep every utility above preflight and global styles when a per-route stylesheet loads before the entry stylesheet.

- Layers rank by when the document first declares them. A route sheet held only the `utilities` layer, so when a server
  rendered its link first, or a cache delivered it first, `utilities` was declared before `reset`, `base` and `tokens`
  and ranked below them: the global `* { margin: 0 }` beat every margin utility on the page.
- Each route sheet now opens with the entry sheet's layer order, `@layer reset,base,tokens,utilities;` (35 bytes),
  rebuilt from the order of the blocks where LightningCSS, Vite 8's default CSS minifier, folded the statement away. The
  entry sheet is unchanged.
