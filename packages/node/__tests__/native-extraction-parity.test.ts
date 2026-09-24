import { fixtureDefaults } from '@bamboocss/fixture'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'
import { Builder } from '../src/builder'
import { BambooContext } from '../src/create-context'

const temporaryDirectories = new Set<string>()
afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { force: true, recursive: true })
})

const createCorpus = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-parity-'))
  temporaryDirectories.add(cwd)
  mkdirSync(join(cwd, 'src'))
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    `export default {
      preflight: false,
      include: ['src/**/*.{ts,tsx}'],
      outdir: 'styled-system',
      theme: {
        extend: {
          recipes: {
            button: {
              className: 'button',
              base: { display: 'inline-flex' },
              variants: { size: { sm: { fontSize: '14px' } } },
            },
          },
        },
      },
      patterns: {
        extend: {
          stack: {
            properties: { gap: { type: 'property', value: 'gap' } },
            transform(props) { return { display: 'flex', flexDirection: 'column', ...props } },
          },
        },
      },
    }\n`,
  )
  const sources = {
    'static.ts': `import { css as c, cva, cx, sva } from '../styled-system/css'
const tone = 'red'
const base = { display: 'flex', padding: { base: '1', md: '2' } }
export const utility = c({ ...base, color: tone, gridTemplateAreas: \`'a'\n  'b'\` })
export const recipe = cva({ base: { borderWidth: '1px' }, variants: { active: { true: { opacity: 1 } } } })
export const slots = sva({ slots: ['root', 'icon'], base: { root: { gap: '2' }, icon: { color: 'blue' } } })
export const joined = cx(utility, c({ margin: 2 }))
`,
    'configured.ts': `import { button } from '../styled-system/recipes'
import { stack } from '../styled-system/patterns'
export const configuredRecipe = button({ size: 'sm' })
export const configuredPattern = stack({ gap: '4' })
`,
    'shared.ts': `export const shared = { backgroundColor: 'purple' }\n`,
    'cross-file.ts': `import { css } from '../styled-system/css'
import { shared } from './shared'
export const crossFile = css(shared)
`,
    'dynamic.ts': `import { css } from '../styled-system/css'
export const dynamic = (color: string) => css({ color })
`,
    'component.tsx': `export const component = <Button size="sm" />\n`,
    'unrelated.ts': `export const value = 42\n`,
  }
  for (const [filename, source] of Object.entries(sources)) writeFileSync(join(cwd, 'src', filename), source)
  return cwd
}

const createDeadCallProject = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-diagnostic-'))
  temporaryDirectories.add(cwd)
  mkdirSync(join(cwd, 'src'))
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    `export default {
      include: ['src/**/*.ts'],
      outdir: 'styled-system',
      patterns: { extend: { stack: { transform: (props) => props } } },
    }\n`,
  )
  writeFileSync(
    join(cwd, 'src/invalid.ts'),
    `import { absent } from '../styled-system/patterns'\nexport const value = absent({ gap: '2' })\n`,
  )
  return cwd
}

const extract = async (cwd: string) => {
  const builder = new Builder()
  await builder.setup({ cwd, atomOrigins: true })
  const parseTypeScript = vi.spyOn(builder.getContextOrThrow().project, 'parseSourceFile')
  builder.extract()
  return {
    css: builder.toCss(),
    origins: builder.getAtomOrigins(),
    typescriptFiles: parseTypeScript.mock.calls.map(([file]) => file),
  }
}

const extractFailure = async (cwd: string) => {
  const builder = new Builder()
  await builder.setup({ cwd })
  const parseTypeScript = vi.spyOn(builder.getContextOrThrow().project, 'parseSourceFile')
  let message = ''
  try {
    builder.extract()
  } catch (error) {
    message = (error as Error).message
  }
  return { message, typescriptFiles: parseTypeScript.mock.calls.map(([file]) => file) }
}

test('the native-only corpus preserves styles and source origins without TypeScript extraction', async () => {
  const result = await extract(createCorpus())

  expect(result.css).toMatch(/background-color:\s*purple/)
  expect(result.css).toMatch(/display:\s*inline-flex/)
  expect(result.css).toMatch(/flex-direction:\s*column/)
  expect(result.origins.size).toBeGreaterThan(0)
  expect([...result.origins.values()].some((origin) => origin.filePath.endsWith('cross-file.ts'))).toBe(true)
  expect(result.typescriptFiles).toEqual([])
})

test('parser hooks can introduce Bamboo calls and receive native results', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-parser-hook-'))
  temporaryDirectories.add(cwd)
  mkdirSync(join(cwd, 'src'))
  const sourceFile = join(cwd, 'src/component.custom')
  writeFileSync(sourceFile, 'custom component source')
  const after = vi.fn()
  const ctx = new BambooContext({
    ...fixtureDefaults,
    config: { ...fixtureDefaults.config, cwd, include: ['src/**/*.custom'] },
    hooks: {
      'parser:before': ({ content }) =>
        content === 'custom component source'
          ? `import { css } from 'styled-system/css'\ncss({ color: 'red' })`
          : undefined,
      'parser:after': after,
    },
  })

  const parsed = ctx.parseFiles()
  expect(parsed.files).toEqual([sourceFile])
  expect([...parsed.results[0].css]).toMatchObject([{ data: [{ color: 'red' }] }])
  expect(parsed.results[0].origins).toBe(false)
  expect(after).toHaveBeenCalledWith({ filePath: sourceFile, result: parsed.results[0] })
  expect(ctx.project.hasMaterializedCompiler()).toBe(false)
})

test('excluded dependencies use virtual runtime bytes without materializing TypeScript', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-virtual-dependency-'))
  temporaryDirectories.add(cwd)
  mkdirSync(join(cwd, 'src'))
  mkdirSync(join(cwd, 'generated'))
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    `export default { include: ['src/**/*.ts'], outdir: 'styled-system', preflight: false }\n`,
  )
  writeFileSync(
    join(cwd, 'src/style.ts'),
    `import { css } from '../styled-system/css'\nimport { shared } from '../generated/shared.js'\ncss(shared)\n`,
  )
  const dependency = join(cwd, 'generated/shared.ts')
  writeFileSync(dependency, `export const shared = { background: '#00f' }\n`)

  const builder = new Builder()
  await builder.setup({ cwd })
  const ctx = builder.getContextOrThrow()
  expect(ctx.project.hasMaterializedCompiler()).toBe(false)
  const readFileSync = ctx.runtime.fs.readFileSync
  ctx.runtime = {
    ...ctx.runtime,
    fs: {
      ...ctx.runtime.fs,
      readFileSync: (filePath: string) =>
        filePath === dependency ? `export const shared = { background: '#f00' }\n` : readFileSync(filePath),
    },
  }

  builder.extract()
  expect(ctx.project.hasMaterializedCompiler()).toBe(false)
  expect(builder.toCss()).toMatch(/background:\s*#f00/)
  expect(builder.toCss()).not.toMatch(/background:\s*#00f/)
})

test('an unknown generated entrypoint reports the native diagnostic without TypeScript extraction', async () => {
  const result = await extractFailure(createDeadCallProject())

  expect(result.message).toContain('`absent` is not a pattern')
  expect(result.message).toContain('src/invalid.ts')
  expect(result.typescriptFiles).toEqual([])
})

/**
 * Vue and Svelte files reach Rust as the output of their auto-injected `parser:before`
 * plugins. That output used to be the raw template wrapped as JSX, which Oxc rejected on the
 * first `{#if}` or `{{ items[0] }}` — failing the whole build with `EXTRACT_FAILED`, while the
 * TypeScript parser the plugins were tested against recovered silently.
 */
test('Vue and Svelte templates with block syntax extract through the native engine', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-sfc-'))
  temporaryDirectories.add(cwd)
  mkdirSync(join(cwd, 'src'))
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    `export default { preflight: false, include: ['src/**/*.{vue,svelte}'], outdir: 'styled-system' }\n`,
  )
  writeFileSync(
    join(cwd, 'src/List.svelte'),
    `<script lang="ts">
  import { css } from '../styled-system/css'
  export let items: string[] = []
</script>
{#if items.length > 1}
  <ul>
    {#each items as item, i (item)}
      <li class={css({ width: '[2.1111px]' })}>{i}: {item}</li>
    {/each}
  </ul>
{:else}
  <p class="empty {css({ width: '[2.2222px]' })}">none</p>
{/if}
`,
  )
  writeFileSync(
    join(cwd, 'src/List.vue'),
    `<script setup lang="ts">
import { css } from '../styled-system/css'
const items = ['a']
</script>
<template>
  <ul v-if="items.length > 1">
    <li v-for="item in items" :key="item" :class="css({ width: '[2.3333px]' })">{{ items[0] }}</li>
  </ul>
  <Slotted v-slot="{ row }"><span :class="[css({ width: '[2.4444px]' }), row]" /></Slotted>
</template>
`,
  )

  const result = await extract(cwd)

  for (const width of ['2.1111px', '2.2222px', '2.3333px', '2.4444px']) {
    expect(result.css).toContain(width)
  }
  expect(result.typescriptFiles).toEqual([])
})

/**
 * A whole stylesheet build — extraction and token pruning, which runs by default — without the
 * TypeScript compiler starting.
 *
 * Token accounting walked the TypeScript tree, so `toCss()` read `project.getSourceFile` for
 * every file mentioning a token, and that started the Go compiler over the whole inventory on
 * every build even though Rust had already done the extraction. The accounting is Rust's now.
 */
test('token pruning runs without materializing the TypeScript compiler', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-token-accounting-'))
  temporaryDirectories.add(cwd)
  mkdirSync(join(cwd, 'src'))
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    `export default {
      include: ['src/**/*.ts'],
      outdir: 'styled-system',
      preflight: false,
      theme: { tokens: { colors: { kept: { value: '#0a0' }, dropped: { value: '#a00' } } } },
    }\n`,
  )
  writeFileSync(
    join(cwd, 'src/style.ts'),
    `import { css } from '../styled-system/css'
import { token } from '../styled-system/tokens'
export const a = css({ color: 'red' })
export const b = token('colors.kept')
`,
  )

  const builder = new Builder()
  await builder.setup({ cwd })
  const ctx = builder.getContextOrThrow()
  builder.extract()
  const css = builder.toCss()

  expect(ctx.project.hasMaterializedCompiler()).toBe(false)
  // And the accounting answered: the token asked for is kept, the other one is pruned.
  expect(css).toContain('--colors-kept')
  expect(css).not.toContain('--colors-dropped')
})
