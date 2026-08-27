---
'@bamboocss/parser': patch
---

Install a file's resolved imports in one call, not one round trip each.

Every module the import walk resolves outside the bulk-installed inventory was installed on its own. Each install moves
the project's membership, which rewrites the synthesized tsconfig's whole `files` list and tells the compiler its config
changed — so the compiler re-derived its program once per import, over a list one entry longer each time. That is
quadratic in the number of resolved modules, and it is paid on every cold build.

It lands hardest on a monorepo. `node_modules` is excluded from the walk, but a workspace sibling resolves to a real
path inside the checkout, so every cross-package import names a module the app's own `include` never covered.

`resolveSpecifier` is now split: it resolves a specifier and reports what it _would_ install, and
`ensureResolutionFacts` collects those across one importer and installs them together. On a fixture of 40 entries
importing 15 modules each from 600 workspace siblings, the walk went from 2,700ms to 363ms — and against a control that
installs nothing, the install cost itself collapsed from ~2,270ms to noise. Directly measured, bulk against
one-at-a-time on 2,000 modules is 92ms against 27.4s.

`resolution-install.bench.ts` covers the path, with a control that does the identical extraction without installing
anything.
