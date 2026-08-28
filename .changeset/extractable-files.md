---
'@bamboocss/node': minor
'@bamboocss/parser': patch
---

Only parse the files that could hold a bamboo call.

A file contributes to the stylesheet by _calling_ something bamboo owns — `css`, a recipe, a pattern, `token`. Each of
those arrives as a binding, and a binding arrives through an import: either straight from an entrypoint, or from a local
module that got it from one. A file with no such chain cannot hold a call, whatever else is in it — and every file
`include` matched was being handed to the compiler and parsed regardless.

An extraction pass now begins with a text-level scan of the inventory: mark every file naming an entrypoint, record
where each file's other imports point, then walk those edges backwards. A file outside the result is still _reachable_ —
cross-file composition installs whatever a qualifying file imports — so this narrows what is parsed, not what the
project can see.

Measured on a real application of 6,425 files: 4,091 can reach an entrypoint and 2,334 provably cannot. Not parsing the
latter took the pass from **88.9s to 30.2s**, with byte-identical CSS. The scan costs 335ms, because it reads text and
never parses.

Every uncertainty keeps the file, because the failure this must not have is silent: a file that cannot be read, a source
whose imports could not be scanned, an aliased specifier that resolves to nothing. `BAMBOO_DEBUG=file:extract` reports
how many files were selected and how many were not.
