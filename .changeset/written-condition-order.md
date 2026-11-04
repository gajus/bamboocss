---
'@bamboocss/core': patch
---

Two conditions that rank alike, such as `_dark` and `&[data-active]`, are ordered the way each style object writes them,
for each property it writes: the one written later wins. They were ordered by whichever the build met first, so any call
writing both, anywhere, decided for every other. A `css()` call setting `fontWeight` under `&[data-active]` and then
`_dark` made a recipe's `_dark` color win over the `&[data-active]` color written after it, and recipes always lost that
race, being written out after every `css()` call.

- Where two objects write the conditions in opposite orders, for different properties or different values, their rules
  share one sublayer, named for both conditions (`s020-c4c5-p3000`), and each object keeps its order.
- Only the same two declarations written in opposite orders cannot both keep theirs. The build warns, naming the files,
  and the stylesheet keeps one order in every build.
- Nothing changes where every object already agreed with the order the build met the conditions in.
