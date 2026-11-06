---
'@bamboocss/core': minor
'@bamboocss/generator': minor
'@bamboocss/eslint-plugin': minor
---

Make a mixin the base of the style it is applied in: its declarations come first, and the style's own properties
override them wherever the `mixin` key is written, so `css({ fontWeight: '300', mixin: 'text-xl/regular' })` gives 300,
as `css({ mixin: 'text-xl/regular', fontWeight: '300' })` does. Since 1.56.5 a mixin applied where its key was written,
and keys sorted by name put `mixin` among the properties adjusting it, so every property sorted before it that the mixin
set too did nothing.

- Such a property now wins over the mixin, as it did before 1.56.5, which changes what it compiles to. Where the mixin's
  value is the one wanted, remove the property.
- A spread's properties are the style's own, so `css({ ...shared, mixin: 'card' })` no longer applies `card` over
  `shared`. Write `css(shared, { mixin: 'card' })`.
- Several mixins apply in the order listed, a later one over an earlier one: `mixin: ['card', 'compact']`, or a list
  chosen per condition, `mixin: { base: 'body', md: ['lead', 'muted'] }`. `no-dynamic-styling` accepts a list of static
  names.
- `no-overridden-by-mixin`, added in 1.61.0, is deprecated: nothing it reported can happen any more. It reports nothing
  and is out of `recommended` and `all`, so a config naming it still loads; remove it from yours.
- `globalCss`, a recipe's own classes and a mixin's own class apply a mixin the same way. They placed it where their
  sort put it, so `{ mixin: 'card', padding: '1px' }` there kept the card's padding however it was written, and a list
  was written as declarations named `0` and `1`.
