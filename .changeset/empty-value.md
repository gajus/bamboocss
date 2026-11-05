---
'@bamboocss/core': patch
'@bamboocss/vite': patch
---

A declaration whose value is an empty string, such as `content: ''`, is reported by the call it is written in, as
`empty-value`, with what to write instead. CSS has no empty value: the stylesheet drops the declaration, so the class
the compiler named for it, `content_`, had no rule, and the build failed on that as a mismatch between the compiler and
the stylesheet, calling it a Bamboo bug and suggesting a workaround that only applies to single-file components.

- An empty `content`, nearly always meant as the empty string a `::before` or `::after` needs to render, is reported
  with `content: '""'`, which is how that is written.
- Any other empty value is reported as meaning no declaration at all: leave the property out, or write `undefined` where
  it is chosen.
- The stylesheet no longer reads an empty or blank value back as `0`. `content: ''` was written as `content: 0` under
  `.content_0`, and `width: ''` as `width: var(--sizes-0)`, rules nothing named.
