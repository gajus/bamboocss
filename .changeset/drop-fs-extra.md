---
'@bamboocss/node': patch
---

Drop `fs-extra`: `node:fs` does every file operation the runtime used it for, so a build no longer loads it and the
packages it depends on, and loading the engine in a fresh process takes about 80 ms where it took 85. `bamboo debug`
writes its files twenty at a time, as codegen does, because `node:fs` fails a write that runs out of file handles where
`fs-extra` queued it and tried again.
