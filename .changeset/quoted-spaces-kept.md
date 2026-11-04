---
'@bamboocss/node': patch
'@bamboocss/core': patch
'@bamboocss/shared': patch
---

The spaces inside a quoted string reach the stylesheet as written, and the compiler names the class the way the
stylesheet does.

- `content: '"a  b"'` shipped as `"a b"`. Extraction collapsed every run of whitespace in a string, quotes included; a
  run outside a quoted string is still one space.
- A value whose spaces survived extraction failed the build. That covers a config recipe's `content: '"x  y"'`, and a
  string built in source. The stylesheet named the class with the spaces, the compiler without them, and the element got
  a class with no rule.
- A tab or a line break inside a quoted string is now written as a space, since a class name can hold neither.
