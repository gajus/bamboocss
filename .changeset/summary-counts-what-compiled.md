---
'@bamboocss/vite': patch
---

Stop the build's coverage summary counting as declined what never was. A call compiled with the call around it, a
function that only shares a name with one of Bamboo's, and a `cx()` joining a class the build cannot read were all
counted as declined, against a share of calls compiled. A project where every call that can compile does read like one
where some had failed: the docs site printed
`Compiled 208/237 (88%) … declined: overlapping=13 opaque-composition=13 dynamic=3`.

- A call nested in one that compiled counts as compiled, and a function that only shares a name is not counted.
- `cx()` calls that join classes at runtime are named apart. The docs site now prints
  `Compiled 221 calls across 49/60 files; 16 cx() calls join classes at runtime: opaque-composition=13 dynamic=3`.
- The share is gone. A call that cannot compile fails the build before the summary prints, so it could only ever read
  100%.
