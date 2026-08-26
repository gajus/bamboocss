---
'@bamboocss/node': minor
---

Sort the source glob, so extraction order does not depend on the filesystem.

`fast-glob` returns `readdir` order, which is not the same on every machine. That order is not cosmetic: it is the order
atoms enter the stylesheet, and stylesheet order is what settles a conflict between two classes that land on one element
— `cx` concatenates them and the browser picks by position, not by the order they were passed.

Unsorted, two checkouts of the same commit could build sheets that disagree about whether `px_4` or `px_2` wins, with
nothing raised to say so. It also left the emitted bytes irreproducible, which is what content-hashed asset names are
derived from.

Sorted by code unit rather than `localeCompare`, whose answer depends on the host's locale — the same class of
machine-dependence.

A project whose filesystem already returned an ordered glob sees no change. One whose did not may see rules move within
the sheet; the set of rules and the class names are unaffected.
