---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Compile a finite ternary inside `css()` when its test reads a local `const` initialized by a ternary of literals and
both style branches are known. The compiled call selects between precomputed class strings, including when it composes
with other styles in `cx()`.
