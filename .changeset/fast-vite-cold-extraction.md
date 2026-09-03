---
'@bamboocss/node': patch
---

Skip files that cannot reach a Bamboo entrypoint during a cold `Builder` extraction.

The CLI already used this source scan, but the Builder path used by Vite bypassed it. On a 7,016-file application, Vite
therefore parsed every file through the TypeScript 7 backend while the CLI parsed the 4,377 files that could author
styles. Applying the same selection to both paths reduced a cold Vite extraction from 121,541 ms to 21,832 ms on the
same machine. CSS output is unchanged because the omitted files have no import path to a Bamboo authoring API.
