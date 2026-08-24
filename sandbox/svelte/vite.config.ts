import bamboocss from '@bamboocss/vite'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit(), bamboocss()],
  server: {
    fs: {
      allow: ['styled-system'],
    },
  },
  resolve: {
    conditions: ['source'],
  },
})
