---
'@bamboocss/eslint-plugin': patch
---

A name `keyframes()` returns is read as the static value it is. The build evaluates the call and writes the name in its
place, but the rules took a binding to it for a runtime value, so the documented `const fadeIn = keyframes({ … })`
reported three ways:

- `no-dynamic-styling` reported `css({ animationName: fadeIn })` and ``css({ animation: `${fadeIn} 0.2s ease-out` })``.
- `no-property-renaming` reported `animationName: fadeIn` as a renamed prop.
- `require-recipe-class-name`, in `dynamic-only` mode, required a name on a recipe reading one.

A call to bamboo's `keyframes()` counts, and so does a binding the file declares as one. A binding imported from another
module is still read as any other binding is.
