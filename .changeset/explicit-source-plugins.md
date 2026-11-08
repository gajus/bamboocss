---
'@bamboocss/node': major
'@bamboocss/plugin-astro': minor
'@bamboocss/plugin-mdx': minor
---

BREAKING: Astro, MDX, Vue and Svelte source extraction now requires explicit plugin installation and configuration.
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

Astro and MDX support moves out of `@bamboocss/node` into new optional plugin packages. Install
`@bamboocss/plugin-astro` and configure `plugins: [pluginAstro()]`, importing `pluginAstro` from that package. Astro
compiler peers now belong to the Astro plugin, so projects that do not use it no longer receive them through Node.

For MDX, install `@bamboocss/plugin-mdx` and configure `plugins: [pluginMdx()]`, importing `pluginMdx` from that
package. Put it after custom MDX conversion plugins to preserve their output. Add `.astro` and `.mdx` paths to `include`
where needed. No source-format plugins are automatically injected.

The Node package exposes `@bamboocss/node/syntax` for checking converted TSX with the extraction parser; the Astro
plugin uses it to preserve its compiler fallback checks.
