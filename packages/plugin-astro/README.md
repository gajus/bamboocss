# @bamboocss/plugin-astro

Install this plugin explicitly to extract styles from `.astro` source files.

```sh
pnpm add -D @bamboocss/plugin-astro
```

```ts
import { defineConfig } from '@bamboocss/dev'
import { pluginAstro } from '@bamboocss/plugin-astro'

export default defineConfig({
  plugins: [pluginAstro()],
  include: ['./src/**/*.{ts,tsx,astro}'],
  outdir: 'styled-system',
})
```

Astro projects must also have `@astrojs/compiler-rs` (Astro 7) or `@astrojs/compiler` (Astro 6 and earlier) installed.
