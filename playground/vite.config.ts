import { bamboocss } from '@bamboocss/vite'
import { reactRouter } from '@react-router/dev/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const emptyModule = fileURLToPath(new URL('./empty-module.js', import.meta.url))
const moduleShim = fileURLToPath(new URL('./module.shim.ts', import.meta.url))

const browserAliases = (): Plugin => ({
  name: 'playground-browser-aliases',
  enforce: 'pre',
  resolveId(source, importer, options) {
    if (options.ssr) return

    const replacement =
      source === '@vue/compiler-sfc'
        ? '@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js'
        : source === 'lightningcss'
          ? 'lightningcss-wasm'
          : /^(?:node:)?(?:fs(?:\/promises)?|perf_hooks|crypto|buffer|stream|url|assert|events)$/.test(source)
            ? emptyModule
            : source === 'node:os' || source === 'os'
              ? 'os-browserify/browser'
              : source === 'node:path' || source === 'path'
                ? 'path-browserify'
                : source === 'node:util' || source === 'util'
                  ? 'util'
                  : source === 'node:process' || source === 'process'
                    ? 'process/browser'
                    : source === 'module'
                      ? moduleShim
                      : undefined

    if (!replacement) return
    if (replacement === emptyModule || replacement === moduleShim) return replacement
    return this.resolve(replacement, importer, { ...options, skipSelf: true })
  },
})

export default defineConfig({
  plugins: [browserAliases(), bamboocss(), reactRouter()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
