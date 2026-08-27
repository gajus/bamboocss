---
'@bamboocss/extractor': minor
---

Flatten a spread element inside an array literal, so `slots: [...parts]` resolves.

The array-literal branch of `maybeBoxNode` mapped every element through itself. A `SpreadElement` matches none of the
branches below it, so it came back unresolvable and took one slot in the array:

```ts
const parts = ['positioner', 'content']
sva({ slots: [...parts] }) //-> slots: [undefined]
```

Not a dropped entry but a poisoned one — the array had a length, so it read as a real slot list with a nameless slot in
it, and the names it should have carried were nowhere. This is issue #2671, whose regression test recorded `[undefined]`
in its snapshot rather than the names, so the case was pinned as it stood rather than fixed.

A spread whose expression boxes to an array is now spliced in place, which is what the spelling already means. Object
spread has always been flattened this way in `get-object-literal-expression-prop-pairs`; arrays were the asymmetry.

A spread the extractor cannot resolve to an array is unchanged — it stays a single unresolvable entry, which is what
tells a consumer not to trust the array. `[...anatomy().keys(), 'slots', 'here']` spreads a call result and still
resolves that way.

Note for anyone already writing `slots: [...parts]`: the emitted class name changes, because a recipe's hash covers its
config and the slot list is now the names instead of `[undefined]`. Rule content is unaffected — only the hash segment
moves, `.sva_lfWcAi__root` to `.sva_fiLqSq__root` in the case under test. Those slots produced no styles before, so this
turns a recipe that silently lost them into one that emits them.

Extraction cost is unchanged: 163.63 → 163.86 hz on `extract-speed` (mean 6.111ms → 6.103ms, ±3.3% and ±4.0% rme over 82
samples each), which is inside the noise.
