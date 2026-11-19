---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Compile a ternary inside `css()` whatever its test reads when both styles are known:
`css({ padding: compact ? '2' : '4' })` with `compact` a prop compiles to `compact` choosing between two class strings,
asked where the call was, once. The test used to have to read a local `const` initialized by a ternary of literals, and
anything else failed the build as `dynamic`.

- The test may read anything but a Bamboo import or a recipe, which the compiler removes, and may not hold a call it
  compiles on its own.
- A call holds one choice. Give a second its own `css()` call: `cx()` composes them into every combination, asking each
  test only where the call would have.
