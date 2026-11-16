import bamboocss from '@bamboocss/vite'
import solid from '@solidjs/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [bamboocss(), solid()],
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
  resolve: {
    conditions: ['source'],
  },
})
