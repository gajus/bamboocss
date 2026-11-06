import tsParser from '@typescript-eslint/parser'
import { type ESLint, Linter } from 'eslint'
import { defineConfig } from 'eslint/config'
import { LegacyESLint } from 'eslint/use-at-your-own-risk'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import bamboo from '../src'
import { recommendedRules } from '../src/configs/recommended'

/**
 * The configs as ESLint reads them.
 *
 * `configs.recommended` was an `.eslintrc` object — its parser named by a string, its plugins by
 * name — which flat config, ESLint's only config since 10, refuses outright.
 */
const code = `import { css } from './bamboo/css'\nexport const styles = css({ marginLeft: '4', debug: true })\n`

describe('configs', () => {
  test.each(['flat/recommended', 'flat/all'] as const)('%s is a flat config ESLint runs', (name) => {
    const linter = new Linter({ configType: 'flat' })

    const messages = linter.verify(
      code,
      [{ files: ['**/*.ts'], languageOptions: { parser: tsParser } }, bamboo.configs[name]],
      'styles.ts',
    )

    expect(messages.filter((message) => message.fatal)).toEqual([])
    expect(messages.map((message) => message.ruleId)).toContain('bamboo/no-debug')
  })

  test.each(['recommended', 'all'] as const)('%s is an .eslintrc config ESLint runs', async (name) => {
    const eslint = new LegacyESLint({ useEslintrc: false, overrideConfig: bamboo.configs[name], plugins: { bamboo } })

    const [result] = await eslint.lintText(code, { filePath: 'styles.ts' })

    expect(result!.messages.filter((message) => message.fatal)).toEqual([])
    expect(result!.messages.map((message) => message.ruleId)).toContain('bamboo/no-debug')
  })

  // `meta.namespace` is what `defineConfig` renames the configs' `bamboo/` rules from, for a plugin
  // registered under another name.
  test.each(['bamboo', 'styles'])('extend through defineConfig, registered as %s', (key) => {
    const linter = new Linter({ configType: 'flat' })

    const messages = linter.verify(
      code,
      defineConfig(
        { files: ['**/*.ts'], languageOptions: { parser: tsParser } },
        { plugins: { [key]: bamboo }, extends: [`${key}/flat/recommended`] },
      ),
      'styles.ts',
    )

    expect(messages.map((message) => message.ruleId)).toContain(`${key}/no-debug`)
  })

  // The flat configs apply to every file; a CSS or JSON one, linted as its own language, is no
  // JavaScript program for the rules to walk.
  test.each(Object.keys(bamboo.rules))('%s stands aside in a file that is not JavaScript', (name) => {
    const rule = bamboo.rules[name as keyof typeof bamboo.rules]

    expect(rule.create({ sourceCode: { ast: { type: 'Document' } } } as never)).toEqual({})
  })

  test('turn on the same rules flat and in .eslintrc', () => {
    expect(bamboo.configs['flat/recommended'].rules).toEqual(bamboo.configs.recommended.rules)
    expect(bamboo.configs['flat/all'].rules).toEqual(bamboo.configs.all.rules)
  })

  // An error where what the build emits would be wrong; every other rule warns.
  test('all turns every rule on but the opposite of one it keeps and those deprecated, three of them as errors', () => {
    const rules = bamboo.configs['flat/all'].rules ?? {}

    expect(Object.keys(rules).sort()).toEqual(
      Object.entries(bamboo.rules)
        .filter(([rule, { meta }]) => rule !== 'prefer-shorthand-properties' && !meta?.deprecated)
        .map(([rule]) => `bamboo/${rule}`)
        .sort(),
    )
    expect(Object.keys(rules)).not.toContain('bamboo/no-overridden-by-mixin')
    expect(Object.keys(rules).filter((rule) => rules[rule] === 'error')).toEqual([
      'bamboo/file-not-included',
      'bamboo/no-config-function-in-source',
      'bamboo/no-invalid-token-paths',
    ])
  })

  // `--fix` reruns until nothing changes. With `prefer-shorthand-properties` on beside
  // `prefer-longhand-properties`, each undid the other's renames, and the run ended on whichever
  // spelling its last pass wrote: `ml` came back `marginLeft`, `paddingInline` came back `px`.
  test('all settles a property on its longhand under --fix', () => {
    const linter = new Linter({ configType: 'flat' })
    const source = `import { css } from './bamboo/css'\nexport const styles = css({ ml: '4', paddingInline: '2' })\n`

    const { messages, output } = linter.verifyAndFix(
      source,
      [{ files: ['**/*.ts'], languageOptions: { parser: tsParser } }, bamboo.configs['flat/all']],
      'styles.ts',
    )

    expect(output).toContain(`css({ marginLeft: '4', paddingInline: '2' })`)
    expect(messages.map((message) => message.ruleId)).not.toContain('bamboo/prefer-longhand-properties')
  })

  // The guide's table is written by hand, so it is held to the plugin here.
  test('are what the linting guide lists', () => {
    const guide = readFileSync(join(import.meta.dirname, '../../../website/content/docs/guides/linting.mdx'), 'utf8')
    const rows = [...guide.matchAll(/^\| \[`([a-z-]+)`\][^|]*\|[^|]*\|\s*(✅)?\s*\|$/gm)]

    expect(rows.map(([, rule]) => rule).sort()).toEqual(Object.keys(bamboo.rules).sort())
    expect(
      rows
        .filter(([, , mark]) => mark)
        .map(([, rule]) => `bamboo/${rule}`)
        .sort(),
    ).toEqual(Object.keys(recommendedRules).sort())
  })
})

// The flat configs carry the plugin itself, so each build has to hand out the same one.
test('each build gives the same plugin', async () => {
  const cjs = createRequire(import.meta.url)('../dist/index.cjs')
  // Not a literal to the type check, which CI runs after `build-fast` writes no declarations; the
  // assertion is stripped before Vitest reads the import.
  const { default: esm } = await import('../dist/index.mjs' as string)

  expect(cjs.default ?? cjs).toBe(esm)
  expect(esm).toBe(bamboo)
})

// What `pnpm typecheck` holds a flat config written in TypeScript to: the plugin and its configs
// are what ESLint's own types call a plugin and a config.
export const plugin: ESLint.Plugin = bamboo
export const flat: Linter.Config[] = [
  bamboo.configs['flat/recommended'],
  bamboo.configs['flat/all'],
  { plugins: { bamboo }, rules: { 'bamboo/no-debug': 'error' } },
]
export const legacy: Linter.LegacyConfig[] = [bamboo.configs.recommended, bamboo.configs.all]
