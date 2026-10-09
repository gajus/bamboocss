---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Say why the compiler refused a call: what the code does that it will not run, and where.

- A call that fails to compile because a helper's body uses a statement the compiler does not run now names the helper,
  the statement and its location, which may be in another file:
  ``css() — dynamic: `tone` uses a `switch` statement at src/theme.ts:4:3, which the compiler does not run``.
- A call that reads a binding written after its declaration names the binding and the write:
  ``css() — dynamic: `base` is written after its declaration, by `base.color = 'blue.300'` at src/a.ts:3:1, so it no longer holds the value it was declared with``.
- A helper statement run only for its effect is quoted:
  ``css() — dynamic: `tone` runs `styles.color = 'red.300'` for its effect at src/theme.ts:4:3, which the compiler does not run``.
- `reportSkipped` lists the same reasons.
