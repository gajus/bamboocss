---
'@bamboocss/node': patch
---

The source glob enters each real folder once, however many symbolic links lead to it. In a pnpm workspace, where each
package's `node_modules` links its siblings, an include such as `../**/src/*.ts` went down every sequence of links: 8
packages took a minute and returned their 8 files 109,600 times. It now takes a few milliseconds and returns each once.

- Folders reached directly are read first, so a file is found where it really is rather than through a link to it.
- A link to a folder read already is read as empty, as a loop's is. A link leading anywhere else is followed as before.
- Two links in one pattern to one folder outside the walk find its files through the first. Two patterns, such as
  `src/**` and `vendor/**`, still find them through each.
