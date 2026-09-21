---
'@bamboocss/vite': patch
---

Stop Rolldown logging a bundle-assignment warning on every build.

After pruning renames the stylesheet, the asset is also re-keyed in the bundle so a plugin that looks it up by its new
name finds it — `@vitejs/plugin-rsc` does exactly that. Rolldown does not support the assignment: it ignores it and logs
`[plugin bamboocss:css-early] Error: This plugin assigns to bundle variable … This will be ignored` once per build. The
message says `Error`, names Bamboo, and describes a write that was already being discarded, so it read as a Bamboo
failure in the build output of every Vite 8 project.

It cannot be caught — the bundler logs it rather than throwing — so the assignment is now skipped on a bundler that
would refuse it. Nothing is lost: the rename still reaches disk through the asset's `fileName`, and every recorded
reference was already carried across separately.

Detected from `build.rolldownOptions` on the resolved config rather than from `rolldownVersion` on an imported `vite`.
This package declares `vite` as a peer, so importing it resolves to Bamboo's own copy — which in a pnpm project is a
different Vite from the one running the build, and answered the question wrongly.
