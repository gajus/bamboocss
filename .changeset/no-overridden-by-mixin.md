---
'@bamboocss/eslint-plugin': minor
---

Add `no-overridden-by-mixin`, in `recommended` as a warning: a property written before a mixin in the same object that
the mixin sets too is replaced by it, and does nothing. `css({ fontWeight: '300', mixin: 'text-xl/regular' })` compiles
to the mixin's weight, and nothing said so; with keys sorted alphabetically, `mixin` comes after nearly every property
written to adjust it.

- The mixin is read from the theme as the build writes it out, mixins it applies included. A shorthand and its longhand
  are one property, a value chosen per condition is judged one condition at a time, and an important value the mixin
  does not make important is kept, so it is not reported.
- `--fix` writes the mixin first in its object, which makes each property it overrode win. It leaves the object alone
  where a spread or a computed key comes before the mixin, or a comment lies between the mixin and the key before it.
