import { bamboocss } from '@bamboocss/vite'
import { reactRouter } from '@react-router/dev/vite'
import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const require = createRequire(import.meta.url)
const emptyModule = fileURLToPath(new URL('./empty-module.js', import.meta.url))
const cryptoShim = fileURLToPath(new URL('./crypto-shim.ts', import.meta.url))
const moduleShim = fileURLToPath(new URL('./module.shim.ts', import.meta.url))
const osBrowser = require.resolve('os-browserify/browser')
const pathBrowser = require.resolve('path-browserify')
const processBrowser = require.resolve('process/browser')
const utilBrowser = require.resolve('util/')

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
          : /^(?:node:)?(?:fs(?:\/promises)?|perf_hooks|buffer|stream|url|assert|events)$/.test(source)
            ? emptyModule
            : /^(?:node:)?crypto$/.test(source)
              ? cryptoShim
              : /^(?:node:)?os$/.test(source)
                ? osBrowser
                : /^(?:node:)?path$/.test(source)
                  ? pathBrowser
                  : /^(?:node:)?util$/.test(source)
                    ? utilBrowser
                    : /^(?:node:)?process$/.test(source)
                      ? processBrowser
                      : /^(?:node:)?module$/.test(source)
                        ? moduleShim
                        : undefined

    if (!replacement) return
    if (replacement.startsWith('/')) return replacement
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
  ssr: {
    external: [
      '@bamboocss/config',
      '@bamboocss/generator',
      '@bamboocss/logger',
      '@bamboocss/parser',
      '@bamboocss/preset-bamboo',
      '@bamboocss/preset-base',
    ],
  },
})
