---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Compile a `css()` call holding several choices between known styles, where only one compiled and a second failed the
build as `dynamic`: `css({ color: active ? 'white' : 'gray.700', bg: loud ? 'red.500' : 'transparent' })` compiles to
its tests choosing one class string per combination of answers.

- A choice inside another's answer is asked only where that answer is taken, as the call asked it, and every test runs
  as often as the call ran it. A plain read such as `props.active` written twice is asked once, where every test in the
  call is a plain read.
- Choices compile beside a spread of known styles and after another argument, merged where they are written. A choice
  inside a spread is still `dynamic`: extraction cannot tell which properties either answer sets.
- Past 32 combinations a call is `dynamic`, as a `cx()` is past 32.
