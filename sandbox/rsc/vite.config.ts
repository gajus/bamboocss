import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bamboocss from '@bamboocss/vite'
import rsc from '@vitejs/plugin-rsc'
import { defineConfig } from 'vite'

/**
 * React Server Components through `@vitejs/plugin-rsc`, which builds three environments —
 * `rsc`, `client` and `ssr` — from one Vite run. Most components here render only on the
 * server, so most of the stylesheet is reached by an environment other than the one that
 * emits it. That is the shape Bamboo's cross-environment pruning exists for.
 */
const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Explicit paths throughout, so a test driving this config from the repository root builds
  // the same project as `vite build` run from here.
  plugins: [bamboocss({ cwd: root }), rsc()],
  environments: {
    rsc: { build: { rollupOptions: { input: { index: join(root, 'src/framework/entry.rsc.tsx') } } } },
    ssr: { build: { rollupOptions: { input: { index: join(root, 'src/framework/entry.ssr.tsx') } } } },
    client: { build: { rollupOptions: { input: { index: join(root, 'src/framework/entry.browser.tsx') } } } },
  },
})
