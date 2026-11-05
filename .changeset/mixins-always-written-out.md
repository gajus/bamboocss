---
'@bamboocss/core': patch
'@bamboocss/vite': patch
---

A mixin compiles to the atoms of the declarations it applies wherever it is applied, alone too, so it ranks against
every other class on the element as those declarations written there would. A mixin that was the whole style kept its
one `mixin_*` class, in the `compositions` layer below every other utility, and lost to any of them its declarations
would rank above:

- `css({ '& input': { mixin: 'small' } })` lost to the input's own `fontSize`. Since 1.56.5 compiles a mixin combined
  with other styles to atoms, that included the input's own mixin: `css({ flex: '1', mixin: 'large' })` on it won over
  the parent's `small`.
- `css({ _hover: { mixin: 'card' } })`, and `css({ mixin: 'card' })` with a `_hover` in `card`, never applied on hover
  over a `color` another class on the element set. The same held at a breakpoint.
- `css({ mixin: 'pad' })` with `paddingTop` in `pad` lost to another class's `padding`, which a longhand outranks.

The compiler no longer emits `mixin_*` classes: `css({ mixin: 'body' })` compiles to the classes of `body`'s
declarations written out. A selector or test matching an element by its `mixin_*` class has to match those instead.
`staticCss` still generates `mixin_*` classes, as before.

A key in a mixin that is not a condition, such as `_hovr`, is now reported by any call applying the mixin, alone too,
and fails the build as it already did wherever the mixin was combined with anything else. The mixin's class wrote the
declaration under no condition at all.
