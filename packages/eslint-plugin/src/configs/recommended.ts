import type { Linter } from 'eslint'

/** The rules meant for any project. */
export const recommendedRules = {
  'bamboo/file-not-included': 'error',
  'bamboo/no-config-function-in-source': 'error',
  'bamboo/no-debug': 'warn',
  'bamboo/no-deprecated-tokens': 'warn',
  'bamboo/no-dynamic-styling': 'warn',
  'bamboo/no-hardcoded-color': 'warn',
  'bamboo/no-invalid-nesting': 'error',
  'bamboo/no-invalid-token-paths': 'error',
  'bamboo/no-property-renaming': 'warn',
  'bamboo/no-unlayered-override': 'warn',
  'bamboo/no-unresolved-styles': 'warn',
  'bamboo/require-recipe-class-name': ['warn', { mode: 'dynamic-only' }],
  'bamboo/no-unsafe-token-fn-usage': 'warn',
} satisfies Linter.RulesRecord
