---
'@bamboocss/vite': patch
---

Compose a `cx()` the compiler can see the way the runtime `cx` merges, by property and conditions, the later argument
winning. It composed like `css(a, b)`, which merges objects: a later `{ padding: '3' }` replaced an earlier
`{ padding: { base: '2', md: '4' } }` outright and dropped the `md` padding, which the runtime `cx` keeps when the same
class arrives as a `className`, so one call rendered differently depending on whether the compiler could see its
arguments. `{ md: { padding: '4' } }` beside `{ padding: { md: '5' } }` compiled to both classes, and now to the later.

- A recipe lookup the compiler answers beside other `cx()` arguments merges with them the same way.
- A key that is neither a property nor a condition is reported in every argument, also where a later argument sets the
  same property and the object merge used to drop it unread.
