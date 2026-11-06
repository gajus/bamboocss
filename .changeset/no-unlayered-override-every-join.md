---
'@bamboocss/eslint-plugin': minor
---

Report every join of a `css()` class with one the file cannot see in `no-unlayered-override`, not only a call named
`cx`: `cx` and `css` imported under other names, `clsx`, `classnames`, `classNames` and a `cn` wrapper, a template
literal, `+` and an array's `join()`. A join outside `cx()` is one the build cannot see, so when the Vite plugin splits
the stylesheet per route it cannot keep the component's atoms in the entry sheet, and which class applies can change
with the route the visitor opened first.

- The message no longer suggests `css(base, props.css)`, which the compiler cannot compile for an arbitrary runtime
  object, or a `cva` in the `recipes` layer, which is not emitted. It suggests a recipe variant for an override the
  caller chooses, and `cx()` over style calls for styles the file owns.
