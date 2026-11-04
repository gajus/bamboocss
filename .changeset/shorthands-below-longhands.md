---
'@bamboocss/shared': patch
---

A shorthand ranks below every longhand it sets, so the longhand wins whichever of the two the stylesheet holds later.
`whiteSpace` sets `whiteSpaceCollapse` and `textWrapMode`, and `borderBlockColor` sets the start and end colors, yet
each ranked with them. Atoms of one rank share a cascade sublayer, where nothing but arrival order separates them, so
`css({ whiteSpace: 'nowrap' })` beat `css({ textWrapMode: 'wrap' })` on one element whenever it arrived later.

The same went for `borderBlockStyle`, `borderBlockWidth` and `borderSpacing`; for `textBox`, `positionTry`,
`cornerShape` and its sides, `marker`, `interestDelay` and `timelineTrigger`, which were not ranked at all; for the
legacy `pageBreakAfter`, `pageBreakBefore` and `pageBreakInside`; for the aliases `wordWrap`, `gridRowGap`,
`gridColumnGap`, `WebkitAppearance` and `WebkitUserSelect`, and the `WebkitMask` and `WebkitBorderBefore` spellings; and
for `grid` against `gridTemplate`, whose properties it sets. `mask` now ranks below `maskPosition`, which Chrome expands
into `-webkit-mask-position-x` and `-y`, and `gridTemplateAreas`, a longhand, ranks as one.

What sets what is Chrome's answer, read from a real browser. A test holds every shorthand `css()` takes to it, and to
ranking below any shorthand nested in it. Rules for those 43 properties move to the sublayer of their new rank, and a
preflight with a parent `scope` writes its `-webkit-appearance` rule earlier, on elements nothing else there styles.
