---
'@bamboocss/core': patch
---

Fold a declaration's value to one spelling before hashing it, so two spellings are one atom.

A declaration's class name comes from `Utility.transform`, which canonicalises the value first — `#ffffff` and `#fff`
both ship as `.c_\#fff`. The atom's identity, though, is the encoder's hash, and that was taken from the value as
written. The two spellings were therefore two atoms resolving to a single rule, and whichever was decoded last decided
where that rule sat. The file that declared it had no say.

That is what broke `cx(base, variant)` in `css-in-js-bench`: the button's base wrote `#ffffff` while other case files
wrote `#fff`, so the base's rule was positioned by an unrelated file and landed after the variants meant to override it,
leaving the buttons unstyled before hydration. Both colours are plain `color` atoms of equal specificity, so they share
a utility sublayer where the later rule wins.

`canonical-value.ts` already existed for exactly this — its own documentation describes the duplicate-atom problem — and
was simply applied on the class-name path but not on the hashing path. It now runs on both, using the same function, so
the hash and the class name agree by construction.

Recipe variant keys are deliberately excluded. A variant value is a key of the `variants` object rather than a CSS
value, and it is looked up as written by both the decoder and the generated runtime; folding `1.0` to `1` there would
drop the rule while the runtime still asked for `--size_1.0`.

Emitted CSS is unchanged except that redundant atoms disappear: the declaration and class name were already canonical,
so only the internal hash catches up. Projects that spell a value more than one way will see a slightly smaller sheet.
