---
'@bamboocss/core': patch
---

Lay atoms out so that no file's own declaration order is contradicted by another's.

A shared atom was positioned by the _first_ file to mention it — "first active occurrence" — which discarded what every
later file said about it. A file declaring `base` before `override` had `base` pushed after it whenever some unrelated
file happened to name the override's value first.

That silently disables the override. Both are declarations of the same property at the same specificity under no
condition, so they share a utility sublayer, and inside a sublayer the later rule wins. An element carrying both classes
rendered the base, everywhere that component was used, because of a file it has nothing to do with.

Position is now a topological sort over the constraints: every file contributes the edges between the atoms it declares
in order, and the layout honours all of them at once. Keys that no chain relates keep the position they already had, so
a project whose files never disagree lays out exactly as before.

Only atoms that can actually override one another are chained. Two rules resolve against each other in the browser when
they share a sublayer, which is keyed by specificity, condition and property priority — so an atom under `_disabled` is
never chained against a bare one. Chaining those anyway invents a constraint the cascade does not have, and one such
false edge was enough to drag an unrelated rule out of place.

Two files that genuinely demand opposite orders of the same pair cannot both be satisfied, since there is one rule per
atom. The tie-break decides, and the sheet stays deterministic rather than depending on read order.
