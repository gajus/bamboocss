---
'@bamboocss/token-dictionary': minor
---

Fail the build when two tokens hash to the same css variable, instead of silently dropping one.

The companion to the class-name collision, and the worse half of it. Under `hash.cssVar` a custom property's name is a
32-bit hash of the token path, so distinct tokens can land on the same property. Only one definition then survived in
`:root`, and every token that lost took the winner's value:

```css
:root {
  --kQArEY: 222px;
} /* spacing.t125265 won */
.crrYtT {
  width: var(--kQArEY);
} /* sizes.t36050 was declared 111px, renders 222px */
```

A class-name collision affects the elements carrying that class. This one follows the token to every reference in the
build, so a colour or a spacing step reads as a value that appears nowhere near its definition, with nothing reported.

Now it throws, naming both token paths rather than only the property they share.

Only reachable under `hash: true` or `hash: { cssVar: true }`. Unhashed variable names carry the token path, so they are
unique by construction.

Note that `prefix` does not resolve a collision, and the hint says so: it is applied _after_ hashing —
`['-', prefix, toHash(path)]` — so both names carry it and both still collide. Renaming either token is what moves one
of them off it.
