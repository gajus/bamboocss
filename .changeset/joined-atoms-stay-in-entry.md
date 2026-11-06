---
'@bamboocss/vite': patch
---

Keep the atoms a `cx()` joins with a class passed in at runtime in the entry sheet when splitting the stylesheet per
chunk, so what an element ends up with no longer depends on which route the visitor opened first.
`cx(styles, className)` compiles to a join of the component's atoms with whatever is passed in, and nothing at build
time says what that is. Where the component sat in a chunk two routes load with `import()`, and both its atom and a
route's override were used by one chunk each, the two were written into two lazily loaded sheets in one sublayer, where
source order decides. Each lazy sheet joins the document the first time its chunk loads, so opening one route first gave
the component's value and opening the other first gave the override, and a reload changed which. From the entry sheet,
every lazily loaded sheet comes after those atoms.

- Such atoms are no longer downloaded with their chunk, which makes the entry sheet larger by those atoms.
- A class joined some other way, through a template literal or `clsx`, is a join the build does not see, and can still
  resolve differently depending on which route loaded first.
