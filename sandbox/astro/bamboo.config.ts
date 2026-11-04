import { defineConfig } from '@bamboocss/dev'
import { pluginAstro } from '@bamboocss/plugin-astro'

export default defineConfig({
  plugins: [pluginAstro()],
  preflight: true,
  include: ['./src/**/*.{astro,tsx}'],
  outdir: 'styled-system',
})
