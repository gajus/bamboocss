---
'@bamboocss/dev': patch
'@bamboocss/shared': patch
---

`cssgen`, `analyze`, `debug` and `ship` read every glob they are given, as the main command does. Each took one, so a
list the shell expanded, or two globs written out, built from the first and dropped the rest without a word.
`cssgen tokens` and the other types take no globs beside them, and say so.

A single `-e`/`--exclude` now excludes what it names. One given once arrived as a string and excluded nothing; only two
or more worked.
