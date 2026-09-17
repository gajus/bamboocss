---
'@bamboocss/core': patch
'@bamboocss/vite': patch
---

Decide atom order by the source inventory rather than by the order modules are transformed in, and keep two atoms that
can compete in the same stylesheet.

Utilities are written into cascade sublayers keyed by specificity, condition and property priority, so rules that differ
in any of those resolve by their sublayer. Rules that agree on all three share one sublayer, and inside a sublayer the
winner is still the later rule — `cx(css({ color }), css({ color }))` is exactly that shape. Two things could therefore
change which declaration won:

- **Transform order.** File owners took their order from a counter bumped on arrival. The extraction lane is reconciled
  against a deterministic inventory, but a bundler transform is not: it arrives in module-graph order, which differs
  between a client and an SSR environment of one app. The two environments emitted the same atoms in different orders,
  so a variant that won in the server's sheet lost in the client's and rendered unstyled before hydration. Owner rank is
  now a property of the file, shared by both lanes that read it, and `reconcileFileOwnerOrder` applies an inventory's
  order to every lane rather than to the one reporting it.
- **The per-chunk split.** An atom exclusive to a lazily loaded chunk moves into that chunk's stylesheet. The entry and
  chunk sheets have no defined order relative to each other, so moving one member of a same-sublayer pair left the
  winner to whichever sheet the browser parsed first, which varies with caching and preload. The split now holds back an
  atom when some element carries it together with another atom in the same sublayer that would not travel with it. Atoms
  that never co-occur, and co-occurring atoms whose sublayers already order them, still split as before.

Nothing about the precedence contract changes: the cascade-oracle snapshot is untouched, and the emitted sheet is
byte-identical for any single-environment build. What changes is that two builds of one project now agree.
