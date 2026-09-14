import { defineConfig } from 'vite'
import { UserConfig } from 'vite'
import { UserConfig as TestUserConfig } from 'vitest'

const typecheck = Boolean(process.env.TYPECHECK)

const options: TestUserConfig = {
  react: {
    test: {
      include: ['**/__tests__/*.{test,spec}.{j,t}s?(x)'],
      environment: 'happy-dom',
      typecheck: {
        enabled: typecheck,
        include: ['**/__tests__/*.{test,spec}.{j,t}s?(x)'],
      },
    },
  },
  'strict-property-values': {
    test: {
      include: ['**/__tests__/scenarios/strict-property-values.{test,spec}.{j,t}s?(x)'],
      typecheck: {
        enabled: typecheck,
        include: ['**/__tests__/scenarios/strict-property-values.{test,spec}.{j,t}s?(x)'],
      },
    },
  },
  strict: {
    test: {
      include: ['**/__tests__/scenarios/strict.{test,spec}.{j,t}s?(x)'],
      typecheck: { enabled: typecheck, include: ['**/__tests__/scenarios/strict.{test,spec}.{j,t}s?(x)'] },
    },
  },
  'format-names': {
    test: {
      environment: 'happy-dom',
      include: ['**/__tests__/scenarios/format-names.{test,spec}.{j,t}s?(x)'],
      typecheck: { enabled: typecheck, include: ['**/__tests__/scenarios/format-names.{test,spec}.{j,t}s?(x)'] },
    },
  },
} as Record<string, UserConfig>

const mode = process.env.MODE ?? 'react'
console.log({ mode })
export default defineConfig(options[mode])
