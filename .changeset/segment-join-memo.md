---
'@bamboocss/node': patch
'@bamboocss/shared': patch
'@bamboocss/vite': patch
---

Return the same class string again for a selection a recipe compiled in segments has made before. Joining the segments
built a new string on every call, and a `cx()` the call was passed to, as in `cx(button(props), className)`, could only
find a string it had not seen in its cache by hashing it whole. On the docs site's button that call takes 87 ns where it
took 472 ns.

- Segments are read by `cvaJoin`, a helper of their own beside `cvaMap`. Memoized in a branch of `cvaMap`, the join was
  inlined wherever `cvaMap` was, and a table's lookup ran about 25% slower once segments had run. An app with no recipe
  compiled in segments ships about 9 B more gzipped; one with them, about 181 B.
- A lookup table in a module where a statement comes before the first import is a hoisted `var` that the first call to
  read it assigns, where it was built in the call on every one: such a call on the docs site's button takes 53 ns where
  it took 277 ns.
