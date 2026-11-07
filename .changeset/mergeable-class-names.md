---
'@bamboocss/core': minor
'@bamboocss/generator': minor
'@bamboocss/types': minor
'@bamboocss/shared': minor
'@bamboocss/vite': minor
'@bamboocss/eslint-plugin': minor
'@bamboocss/config': patch
---

Name each utility atom after the property and conditions it sets, so the runtime `cx` merges the classes it joins: where
a class passed in sets what a component's own class sets, under the same conditions, the later one wins, as in
`css(a, b)`, however many components forward the `className` on the way, in development and production alike. Before,
`cx(styles, props.className)` joined the two and the stylesheet's order picked the winner, an order that came from the
first file to use each value, so an unrelated file could change it.

- **Every utility class name changes.** A readable name gains a merge code ahead of it, `_`, six characters and `:`:
  `md:w_480px` becomes `_AQSe3b:md:w_480px`. A hashed name is the same code followed by five characters coding the
  value, thirteen characters rather than about six: `_AQSe3b:h5u26`. `cx` merges only names of that shape, so a class
  written by hand is kept as written. Recipe classes keep their names. Both codes are hashes of what the atom sets, so
  builds made apart, a component library and an app, agree on them, and an app's `cx` merges a library's classes when
  the two share a `prefix`.
- **An important class no longer outlasts a later one for the same property.** `cx` keeps the later, as `css(a, b)`
  does, where both classes used to reach the element and the important one applied. A component that wrote `!` to keep
  its own value over a `className` it is handed loses it to that class.
- **Regenerate `styled-system`** with `bamboo codegen`: its `cx` does the merging.
- **A class name written by hand to match a utility has to spell the code**: markup written as HTML, a name assembled at
  runtime for a class `staticCss` emits, a test or a stylesheet selecting a utility by its name. The code is the same
  for every value of one property under one set of conditions, so a readable name can still be assembled from it.
- **A `toHash` that a `utility:created` hook configures is no longer used**, as a utility class name has the fixed shape
  `cx` reads. The config reports it, and fails under `validation: 'error'`.
- No two properties share a code under no condition or under one condition the presets define, so a project that does
  not nest conditions or define its own cannot meet a collision. One that does fails the build naming the two pairs,
  rather than let `cx` drop one for the other; at 36 bits that is about one project in 34,000 at 2,000 pairs. Two values
  of one property under one set of conditions landing on one hashed name fail the build as any two hashed names always
  have: about one build in 34,000 at 250 such values, one in 2,100 at a thousand.
- `cx` keeps each join it has merged, so a repeated join costs a lookup, about what joining did, and a page pays for a
  merge once.
- `no-unlayered-override` no longer reports a join through Bamboo's `cx`. It still reports every join outside it: a
  template literal, `+`, `clsx` and the like.
