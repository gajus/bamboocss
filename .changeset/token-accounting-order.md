---
'@bamboocss/node': patch
---

Ask the cheap question before the expensive one in token accounting.

Token accounting asked the compiler for a file's syntactic diagnostics — a round trip — before testing whether the file
mentions `token` at all. Both branches under that check return without recording anything for a file that cannot name
the artifact, so the request could not change the outcome for any of them.

On one real application 195 of 6,868 files spell `token`; the other 6,673 were each paying for a request whose answer
was discarded. Reordering the two drops the requests by 95% with identical CSS out.
