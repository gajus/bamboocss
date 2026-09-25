---
'@bamboocss/node': minor
'@bamboocss/vite': patch
---

Fix Astro and Qwik builds.

- **Astro:** `.astro` components failed extraction with `Unexpected token`, which failed every Astro build. They are now
  converted to TSX with Astro's own compiler before extraction. This is built into `@bamboocss/node`, so there is no
  plugin to install. `@astrojs/compiler` is an optional peer dependency, and `astro` already installs it.
- **Astro:** the prerender build keeps the stylesheet module in a chunk and inlines it into each page, so it emits no
  CSS asset. This no longer fails as a missing stylesheet. A client bundle must still emit the stylesheet as an asset.
- **Qwik:** the client build failed with "an output plugin changed or removed the generated stylesheet" because Qwik
  writes a `q-manifest.json` that quotes each stylesheet's text. Only CSS assets are compared now, so a new asset
  quoting the sheet is not mistaken for a rewrite of it.
