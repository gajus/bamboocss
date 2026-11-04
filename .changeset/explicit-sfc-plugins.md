---
'@bamboocss/node': major
---

BREAKING: Vue and Svelte source extraction now requires explicit plugin installation and configuration.
`@bamboocss/node` no longer depends on or automatically registers `@bamboocss/plugin-vue` and
`@bamboocss/plugin-svelte`.

For Vue and Nuxt, install `@bamboocss/plugin-vue` as a dev dependency and add it to `bamboo.config.ts`:

```ts
import { defineConfig } from '@bamboocss/dev'
import { pluginVue } from '@bamboocss/plugin-vue'

export default defineConfig({
  plugins: [pluginVue()],
})
```

For Svelte, install `@bamboocss/plugin-svelte` as a dev dependency and configure `plugins: [pluginSvelte()]`, importing
`pluginSvelte` from `@bamboocss/plugin-svelte`. Keep the relevant `.vue` or `.svelte` paths in `include`. The
framework's Vite plugin is separate from these Bamboo extraction plugins.

Automatic Astro and MDX support is unchanged.
