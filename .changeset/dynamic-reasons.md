---
'@bamboocss/vite': patch
'@bamboocss/node': patch
'@bamboocss/eslint-plugin': patch
---

Say why a call is `dynamic`. A `css()`, pattern, `token()` or `keyframes()` call the compiler could not compile printed
`css() — dynamic` and nothing else unless the evaluator had refused code, and then advised `staticCss`, which does not
make a call compile. The line now names what the build cannot know and where:

```text
9: css() — dynamic: `pads[size]` at src/bar.tsx:9:46 reads a property by a key known only at runtime
12: css() — dynamic: its 6 choices give more combinations of answers than one call compiles to
16: css() — dynamic: `h` at src/bar.tsx:16:39 is a parameter, so only the caller knows its value
```

- The reasons are a parameter or a value read off one, a lookup by a key known only at runtime, a spread or computed key
  the build cannot enumerate, a choice inside a spread, inside another value, in a pattern or written with `&&`, a
  choice whose test reads a Bamboo import or a recipe, and more than 32 combinations of choices. Where a read leads to a
  declaration elsewhere in the module, the line points there.
- After the list, the error says once for each reason what to write instead, and no longer mentions `staticCss`.
- A `css()` or pattern argument the build cannot read as a whole, `css(pads[size])` or `css(styles)`, now warns as one
  under a key did; it warned of nothing.
- The warning no longer says the runtime names a class for what the build could not see: there is no such runtime, and
  the call fails to compile. It gives each reason its own fix rather than `staticCss`, and names a property once. A
  recipe's warning says its calls compile without the declaration, where it said the element loses every style and to
  set `className`; the `no-unresolved-styles` lint rule reports the same words.
