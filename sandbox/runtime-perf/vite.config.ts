import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import bamboocss from '@bamboocss/vite'

const ANALYZE = !!process.env.ANALYZE

// https://vitejs.dev/config/
export default defineConfig({
  // Integration tests construct the Bamboo plugin with fixture-specific options.
  plugins: [react(), ...(process.env.VITEST ? [] : [bamboocss()])],
  build: {
    sourcemap: ANALYZE,
  },
  resolve: {
    conditions: ['source'],
  },
})
