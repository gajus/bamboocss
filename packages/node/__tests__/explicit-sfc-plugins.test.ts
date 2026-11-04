import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import type { LoadConfigResult } from '@bamboocss/types'
import { loadConfigAndCreateContext } from '../src/config'
import { BambooContext } from '../src/create-context'

const directories: string[] = []
afterAll(() => {
  for (const directory of directories) rmSync(directory, { force: true, recursive: true })
})

const project = (framework?: 'vue' | 'svelte') => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-explicit-sfc-'))
  directories.push(cwd)
  mkdirSync(join(cwd, 'src'))
  const factory = framework === 'vue' ? 'pluginVue' : 'pluginSvelte'
  const pluginPath = framework && resolve(__dirname, `../../plugin-${framework}/src/index.ts`)
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    `${framework ? `import { ${factory} } from ${JSON.stringify(pluginPath)}` : ''}
export default {
  preflight: false,
  prefix: 'initial',
  include: ['src/**/*'],
  plugins: [${framework ? `${factory}(),` : ''} {
    name: 'probe',
    hooks: { 'parser:before': ({ content }) => content + '\\n// probe' },
  }],
}`,
  )
  return cwd
}

const sources = {
  vue: `<script setup>import { css } from '../styled-system/css'</script><template><div :class="css({ color: 'red' })" /></template>`,
  svelte: `<script>import { css } from '../styled-system/css'</script><div class={css({ color: 'red' })} />`,
}

const transform = (ctx: BambooContext, framework: keyof typeof sources) =>
  ctx.hooks['parser:before']!({
    filePath: join(ctx.config.cwd, `src/Card.${framework}`),
    content: sources[framework],
    configure() {},
  })!

test('unconfigured SFC plugins are not injected and do not transform source', async () => {
  const ctx = await loadConfigAndCreateContext({ cwd: project() })
  expect(ctx.config.plugins?.map((plugin) => plugin.name)).toEqual([
    '@bamboocss/node:astro',
    'probe',
    '@bamboocss/node:mdx',
  ])
  for (const framework of ['vue', 'svelte'] as const) {
    expect(transform(ctx, framework)).toBe(sources[framework] + '\n// probe')
  }
})

test.each(['vue', 'svelte'] as const)(
  'explicit %s registration survives repeated reloads without duplicate hooks',
  async (framework) => {
    const cwd = project(framework)
    let ctx = await loadConfigAndCreateContext({ cwd })
    for (let round = 0; round < 3; round++) {
      expect(ctx.config.plugins?.map((plugin) => plugin.name)).toEqual([
        '@bamboocss/node:astro',
        `@bamboocss/plugin-${framework}`,
        'probe',
        '@bamboocss/node:mdx',
      ])
      const transformed = transform(ctx, framework)
      expect(transformed).toContain("css({ color: 'red' })")
      expect(transformed).not.toContain('<script')
      expect(transformed.match(/\/\/ probe/g)).toHaveLength(1)
      if (round === 2) break
      writeFileSync(
        join(cwd, 'bamboo.config.ts'),
        readFileSync(join(cwd, 'bamboo.config.ts'), 'utf8').replace(/prefix: '[^']*'/, `prefix: 'reload-${round}'`),
      )
      let reloaded: LoadConfigResult | undefined
      await ctx.diff.reloadConfigAndRefreshContext((conf) => {
        reloaded = conf
      })
      expect(reloaded).toBeDefined()
      ctx = new BambooContext(reloaded!)
    }
  },
)
