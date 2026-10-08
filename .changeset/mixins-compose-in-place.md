---
'@bamboocss/core': patch
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Make a mixin combined with other styles mean what writing its declarations in its place means.

- The compiler kept an applied mixin as its one class in the `compositions` layer, below every other utility, so any
  other utility on the element won: a recipe variant's mixin lost to the base, a compound variant's lost to a plain
  variant, a mixin written after a property lost to it, and a mixin's own `_hover` never applied over a `color` set
  beside it. Merging styles also treated `mixin` as one key, so `cx(css({ mixin: 'a' }), css({ mixin: 'b' }))` dropped
  everything `a` set that `b` does not.
- A mixin combined with anything else now compiles to the atoms of the declarations it applies, merged in place: a
  property after it wins, one before it loses, and its conditions rank as conditions. A mixin that is the whole style
  still compiles to its one `mixin_*` class.
- The stylesheet interns a mixin's declarations wherever one is applied, so every class the compiler emits has a rule,
  and pruning drops whichever form no output uses.
