# Disallow a property a mixin written after it in the same object overrides (`@bamboocss/no-overridden-by-mixin`)

⚠️ This rule _warns_ in the following configs: 🌐 `all`, ✅ `recommended`.

🔧 This rule is automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/latest/use/command-line-interface#--fix).

<!-- end auto-generated rule header -->

A mixin means what writing its declarations in its place means, so a property written before it that it sets too is
replaced, as it is by any key written after it. The property does nothing, and nothing else says so:

```ts
// text-xl/regular: { value: { fontSize: '20px', fontWeight: '400' } }
css({ fontWeight: '300', mixin: 'text-xl/regular' }) // fontWeight 400; the 300 is dropped
```

Keys sorted alphabetically put `mixin` after nearly every property beside it, so in a codebase that sorts them, every
property written to adjust a mixin is one of these.

## What it checks

Each object holding a `mixin` key in a style, in `css()`, a pattern and a recipe's base, variants and compound variants,
and nested under a condition. A property written before the mixin is reported when the mixin sets it under the same
conditions, which the build reads from the theme:

- a shorthand and its longhand are one property, so `p` beside a mixin setting `padding` is reported;
- a value chosen per condition is judged one condition at a time, so `fontSize: { lg: '3rem' }` is reported where the
  mixin sets `fontSize` at `lg`, and not where it sets it only at its base;
- an important value is kept against one written after it that is not, as in CSS, so it is not reported unless the
  mixin's value is important too;
- a mixin chosen per condition, `mixin: { base: 'body', md: 'lead' }`, overrides what each writes under its condition.

A mixin named by something other than a string literal, and one the theme does not define, is not read.

## How to fix it

Write the mixin first, and what adjusts it after it:

```ts
css({ mixin: 'text-xl/regular', fontWeight: '300' }) // fontWeight 300
```

`--fix` does that, moving the mixin to the front of its object. It leaves an object alone where a spread or a computed
key comes before the mixin, since the mixin would then precede keys nobody has read, and where a comment lies between
the mixin and the key before it.

A rule sorting keys alphabetically will move the mixin back. Give `mixin` a group of its own at the front, as
`perfectionist/sort-objects` does with its `customGroups` and `groups` options.

## When not to use it

When a property beside a mixin is meant to be dropped, which a property written to do nothing seldom is.
