---
'@bamboocss/vite': minor
---

Prune the stylesheet against every build environment, not only the one that emits it.

- A run that announces its environments — `builder` in the Vite config, which every framework building more than one
  sets — now prunes the stylesheet against what it knows when it is emitted, and prunes it again from source once the
  last environment has written its output. When that restores a rule, the final bytes go under a new name and every
  written reference moves with them, across environments, along with any copy of the sheet another output carries.
- A class only the server graph reaches keeps its rule, so a styled component that renders only on the server, or a
  React Server Component, no longer fails the build or needs `pruneCss: false`.
- The sheet is pruned in a `pre`-ordered `generateBundle` hook, before any other plugin reads its name. A framework that
  records asset names in its own hook records the final one; `@vitejs/plugin-rsc` did not, and every server-rendered
  page linked a stylesheet that no longer existed.
- An in-memory build, and a run that builds environments one at a time without announcing them, prune as before; the
  guard that fails a later environment naming a pruned class now explains how to announce the run.
