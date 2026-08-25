---
'@bamboocss/node': patch
'@bamboocss/parser': patch
---

Replace quadratic dependency queues and affected-file ordering with cursor walks, constant-time membership, and a stable
priority heap.
