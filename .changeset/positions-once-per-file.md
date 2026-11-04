---
'@bamboocss/node': patch
---

Extraction finds where a call is in its file with one pass over the file, rather than one per call. A call's line,
column and UTF-16 offsets each walked the file from its start, so extracting a module took as long as its calls times
its length: a module of 1,000 calls took 120 ms, and takes 2.2 ms. The 500 small modules the extraction benchmark parses
take 4.5 ms rather than 5.0 ms. Token accounting placed each token reference it declines the same way, and the evaluator
each helper it refuses.
