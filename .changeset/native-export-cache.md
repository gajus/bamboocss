---
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Cache cross-file values between Vite transforms.

Each transform used to re-read and re-parse every module a value or recipe was resolved through. A module importing from
a 50-module barrel took 11.7 ms per transform, and it paid that again on every re-transform after an edit. Resolved
exports and imported recipes are now remembered across transforms. An entry is used only while every file it read still
has the same content, including files that did not exist yet. On that barrel a transform now takes 0.5 ms.
