---
'@bamboocss/node': patch
---

`bamboo --watch` and `cssgen -o` no longer rewrite a stylesheet that comes out the same. Both wrote it on every rebuild,
so an edit that moved no style touched a file a dev server or a bundler watches, and each did its work over for it. The
stylesheet `bamboo` and `cssgen` write without `-o` was already left alone.
