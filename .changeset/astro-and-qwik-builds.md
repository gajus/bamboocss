---
'@bamboocss/plugin-astro': minor
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

Fix Astro and Qwik builds.

- **Astro:** `.astro` components failed extraction with `Unexpected token`, which failed every Astro build. The new
  `@bamboocss/plugin-astro` converts them to TSX with Astro's own compiler before extraction, and is auto-injected like
  the Vue and Svelte plugins. `@astrojs/compiler` is an optional peer, which `astro` already installs.
- **Astro:** the prerender build keeps the stylesheet module in a chunk and inlines it into each page, so it emits no
  CSS asset. This no longer fails as a missing stylesheet. A client bundle must still emit the stylesheet as an asset.
- **Qwik:** the client build failed with "an output plugin changed or removed the generated stylesheet" because Qwik
  writes a `q-manifest.json` that quotes each stylesheet's text. Only CSS assets are compared now, so a new asset
  quoting the sheet is not mistaken for a rewrite of it.
