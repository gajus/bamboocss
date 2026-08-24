import solidJs from '@astrojs/solid-js'
import bamboocss from '@bamboocss/vite'
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
  integrations: [solidJs()],
  vite: {
    plugins: [bamboocss()],
    resolve: {
      conditions: ['source'],
    },
  },
})
