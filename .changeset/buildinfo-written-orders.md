---
'@bamboocss/core': patch
'@bamboocss/types': patch
---

A build info file written by `bamboo ship` carries the order its style objects wrote conditions that rank alike in, such
as `_dark` and `&[data-active]`, and a build restoring it keeps that order. It carried only the atoms, so the restoring
build ordered them by whichever it met first: a file of the consuming project writing both conditions for another
property decided which of the library's own declarations won.

A file written before this loads as it did, and a file without such orders is unchanged.
