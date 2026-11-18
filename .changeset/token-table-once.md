---
'@bamboocss/node': patch
---

The token table crosses into the native engine once per config load, instead of with every module the compiler
transforms. Each call converted every token again, about 0.44 µs a token: 0.2 ms a module with the default preset and
0.8 ms with `preset-atlaskit`'s 1,655 tokens, more than compiling most modules takes, in every build and on every
dev-server transform. A call now costs the same whatever the design system holds: a 1,000-module app builds in 289 ms
where it took 422 with the default preset, and in 318 ms where it took 763 with 1,651 tokens.

- Output is unchanged: the docs site's client and server builds, 676 files, are byte-identical.
