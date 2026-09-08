---
'@bamboocss/vite': patch
---

Report a `cx()` that joins compiled atoms with an opaque class under its own diagnostic reason.

Such a call was counted as a plain `dynamic` skip, which is also what an unanalyzable `css()` argument produces — so
`reportSkipped` and the build summary could not tell the two apart. They are now separated as `opaque-composition`.

This does not change what compiles. The call still passes the build, for the reason it always has: forwarding a
`className` prop is how components are written, and there is usually no other shape available. Only calls that mix both
halves are classified this way; a `cx()` whose arguments are all opaque stays `dynamic`.
