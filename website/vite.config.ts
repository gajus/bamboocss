import { bamboocss } from '@bamboocss/vite'
import { reactRouter } from '@react-router/dev/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [bamboocss(), reactRouter()],
  resolve: {
    alias: {
      '.velite': fileURLToPath(new URL('./.velite/index.js', import.meta.url)),
    },
    tsconfigPaths: true,
  },
})
