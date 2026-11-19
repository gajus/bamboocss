---
'@bamboocss/vite': patch
'@bamboocss/node': patch
'@bamboocss/shared': patch
---

Compile recipe calls imported through JavaScript specifiers such as `./styles.js` when they resolve to TypeScript
source. The Vite skip check now uses the same extension substitutions as the extraction scan, so client and SSR bundles
keep the recipe's class strings and CSS.
