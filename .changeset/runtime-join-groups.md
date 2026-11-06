---
'@bamboocss/vite': patch
---

Keep the atoms a `cx()` joins at runtime from its own compiled calls in one sheet when splitting the stylesheet per
chunk, so a build styles the same split as unsplit. Two runtime recipe lookups in one `cx()`, a lookup beside a
condition, or more condition combinations than the compiler writes out, are compiled one by one and joined rather than
merged, so where two set one property the stylesheet's order decides. Each was written in a class string of its own, so
nothing told the split they meet on one element: one shared with another route stayed in the entry sheet while one only
this route used moved into its own, which the document orders after the entry sheet rather than as the unsplit sheet
does. The compiler now records what each such join puts on one element, and the split keeps a pair that competes
together.
