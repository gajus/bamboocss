# @bamboocss/plugin-mdx

Install this plugin explicitly to extract styles from `.mdx` source files.

```sh
pnpm add -D @bamboocss/plugin-mdx
```

```ts
import { defineConfig } from '@bamboocss/dev'
import { pluginMdx } from '@bamboocss/plugin-mdx'

export default defineConfig({
  plugins: [pluginMdx()],
  include: ['./src/**/*.{ts,tsx,mdx}'],
  outdir: 'styled-system',
})
```

Register `pluginMdx()` after any custom MDX conversion plugins. Content rewritten by an earlier hook is left intact.
