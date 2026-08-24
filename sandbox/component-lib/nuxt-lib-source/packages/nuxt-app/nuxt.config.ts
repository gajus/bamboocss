// https://nuxt.com/docs/api/configuration/nuxt-config
import bamboocss from '@bamboocss/vite'
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  telemetry: false,
  alias: {
    '@sandbox-nuxt-lib-source/styled-system': fileURLToPath(
      new URL('../css-lib/@sandbox-nuxt-lib-source/styled-system', import.meta.url),
    ),
  },
  vite: {
    plugins: [bamboocss()],
  },
  css: ['virtual:bamboo.css'],
})
