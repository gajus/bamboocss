---
'@bamboocss/generator': patch
---

Correct what the generated `cx` declaration tells an editor. It said `cva` and `sva` styles sit in a `recipes` layer, so
a consumer's `css()` passed as a `className` always wins over them. No `recipes` layer is emitted: recipes compile to
the same `utilities` atoms as `css()`, so such a class wins or loses by stylesheet order. It now says what `cx` does: it
merges the Bamboo styles it is given, later arguments winning, and only joins anything else, such as a `className` prop.
An override a caller chooses belongs in a recipe variant.
