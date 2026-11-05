---
'@bamboocss/shared': patch
'@bamboocss/core': patch
'@bamboocss/vite': patch
---

A shorthand and the property it stands for in one style object, `bg` and `background`, merge as two declarations of one
CSS rule: the later wins unless the earlier is important and the later is not. `css({ bg: 'red!', background: 'blue' })`
compiled to `bg_blue`, dropping the important red, in the stylesheet and in the class the compiler wrote.

- Either order keeps the important value, and so does a later value under conditions, which takes it as its base.
- Otherwise nothing changes: the later still wins, and a later value under conditions still replaces an earlier plain
  one, as it does through `css(a, b)` and a mixin.
- The generated runtime merge behind `css.raw()` keeps the later value, as before. What it returns is never named at
  runtime, and merging the other way would bring the important parser, 3 KB gzipped, into every bundle that merges
  styles.
