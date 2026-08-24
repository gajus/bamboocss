// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from 'nuxt/config'
import bamboocss from '@bamboocss/vite'

export default defineNuxtConfig({
  telemetry: false,
  vite: {
    plugins: [bamboocss()],
  },
  css: ['virtual:bamboo.css'],
  compatibilityDate: '2025-04-25',
})
