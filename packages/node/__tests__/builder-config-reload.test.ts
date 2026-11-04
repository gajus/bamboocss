import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import type { LoadConfigResult } from '@bamboocss/types'
import { afterAll, expect, test, vi } from 'vitest'
import { Builder } from '../src/builder'
import { artifactsToRebuild, codegen } from '../src/codegen'
import { loadConfigAndCreateContext } from '../src/config'
import { copyLaidOver } from '../src/config-reload'
import { BambooContext } from '../src/create-context'

const directories: string[] = []
afterAll(() => {
  for (const directory of directories) rmSync(directory, { force: true, recursive: true })
})

const config = (size: string, rest = '') =>
  `import { pluginVue } from ${JSON.stringify(resolve(__dirname, '../../plugin-vue/src/index.ts'))}
export default { plugins: [pluginVue()], preflight: false, include: ['src/**/*.vue'], outdir: 'styled-system', ${rest}theme: { extend: { tokens: { sizes: { probe: { value: '${size}' } } } } } }\n`

/** The config written again, with an mtime later than the last, as an editor's save leaves it. */
const edit = (cwd: string, size: string, rest?: string) => {
  const file = join(cwd, 'bamboo.config.ts')
  writeFileSync(file, config(size, rest))
  const later = Date.now() / 1000 + 5
  utimesSync(file, later, later)
}

const scratch = (name: string) => {
  const directory = mkdtempSync(join(tmpdir(), `bamboo-config-reload-${name}-`))
  directories.push(directory)
  return directory
}

const project = (rest?: string) => {
  const cwd = scratch('project')
  mkdirSync(join(cwd, 'src'))
  writeFileSync(join(cwd, 'bamboo.config.ts'), config('1px', rest))
  writeFileSync(
    join(cwd, 'src/Card.vue'),
    `<script setup lang="ts">\nimport { css } from '../styled-system/css'\n</script>\n<template><div :class="css({ width: '[3.1111px]' })" /></template>\n`,
  )
  return cwd
}

const reload = async (ctx: BambooContext) => {
  let reloaded: LoadConfigResult | undefined
  const affected = await ctx.diff.reloadConfigAndRefreshContext((conf) => {
    reloaded = conf
  })
  expect(affected.hasConfigChanged).toBe(true)
  return { affected, reloaded: reloaded! }
}

/**
 * A config edited while a build watches it is read again as it was read first. The reload used to
 * read the file alone, and the context it built had none of what the integration had added: the
 * automatic Astro and MDX parsers, the explicitly configured Vue parser, and
 * the mark of a dev server's build, which `hash: 'auto'` reads.
 */
test('a config read again keeps what the integration added to it', async () => {
  const cwd = project()
  const builder = new Builder()
  await builder.setup({ cwd, dev: true })
  builder.extract()
  const first = builder.getContextOrThrow()
  expect(builder.toCss()).toContain('3.1111px')

  edit(cwd, '2px')
  await builder.setup({ cwd, dev: true })
  builder.extract()

  const ctx = builder.getContextOrThrow()
  expect(ctx, 'read again').not.toBe(first)
  expect(ctx.tokens.getByName('sizes.probe')?.value).toBe('2px')
  expect(builder.toCss(), 'still read through the Vue parser').toContain('3.1111px')
  expect(ctx.config.dev).toBe(true)
})

/**
 * A watching build reads its config again only once a file it was read from changed, as a dev
 * server does. It read it on every rebuild, and an ES module config is imported anew each time,
 * into a module Node keeps for as long as the build watches.
 */
test('a watching build reads its config again only once it changed', async () => {
  const cwd = project()
  const builder = new Builder()
  await builder.setup({ cwd, watch: true })
  // The first rebuild reads it again, and takes the snapshot the next ones are checked against.
  await builder.setup({ cwd, watch: true })
  const ctx = builder.getContextOrThrow()
  const reloads = vi.spyOn(ctx.diff, 'reloadConfigAndRefreshContext')

  await builder.setup({ cwd, watch: true })
  expect(reloads).not.toHaveBeenCalled()

  // A one-shot build pays for it: it is also the recovery for an edit no snapshot sees.
  await builder.setup({ cwd })
  expect(reloads).toHaveBeenCalledTimes(1)

  edit(cwd, '2px')
  await builder.setup({ cwd, watch: true })
  expect(builder.getContextOrThrow().tokens.getByName('sizes.probe')?.value).toBe('2px')
  // Still a build's context: `hash: 'auto'` reads `dev`, which a watching build is not.
  expect(builder.getContextOrThrow().config.dev).toBeFalsy()
})

// No watcher journals the files a `dependencies` glob gains in a build, as a dev server's does, so
// a watching build globs again: a token file added is read with the next rebuild.
test('a watching build reads its config again when a `dependencies` glob gains a member', async () => {
  const cwd = scratch('members')
  mkdirSync(join(cwd, 'src'))
  mkdirSync(join(cwd, 'tokens'))
  writeFileSync(join(cwd, 'tokens/a.json'), `{ "value": "1px" }`)
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    [
      `import { readdirSync, readFileSync } from 'node:fs'`,
      `import { join } from 'node:path'`,
      `const dir = join(__dirname, 'tokens')`,
      `const sizes = Object.fromEntries(readdirSync(dir).map((name) => [name.replace('.json', ''), JSON.parse(readFileSync(join(dir, name), 'utf8'))]))`,
      `export default { preflight: false, include: ['src/**/*.vue'], outdir: 'styled-system', dependencies: ['tokens/*.json'], theme: { extend: { tokens: { sizes } } } }`,
    ].join('\n'),
  )
  const builder = new Builder()
  await builder.setup({ cwd, watch: true })
  await builder.setup({ cwd, watch: true })
  expect(builder.getContextOrThrow().tokens.getByName('sizes.b')).toBeUndefined()

  writeFileSync(join(cwd, 'tokens/b.json'), `{ "value": "2px" }`)
  await builder.setup({ cwd, watch: true })

  expect(builder.getContextOrThrow().tokens.getByName('sizes.b')?.value).toBe('2px')
  // A glob spells a path with forward slashes, on Windows too.
  const slashed = (path: string) => path.replaceAll('\\', '/')
  expect(builder.getContextOrThrow().explicitDeps.map(slashed)).toContain(slashed(join(cwd, 'tokens/b.json')))
})

// A plugin's `config:change` is handed the config as it reads after the edit. The Builder called
// the hook of the context from before it, with the config the edit replaced.
test('a config read again is handed to the plugins it now has', async () => {
  const plugin = `plugins: [{ name: 'probe', hooks: { 'config:change': ({ config }) => { (globalThis as any).__bambooProbeSeen = config.theme.tokens.sizes.probe.value } } }], `
  const cwd = project(plugin)
  const builder = new Builder()
  await builder.setup({ cwd, dev: true })

  edit(cwd, '2px', plugin)
  await builder.setup({ cwd, dev: true })

  expect((globalThis as any).__bambooProbeSeen).toBe('2px')
  delete (globalThis as any).__bambooProbeSeen
})

// And the config an integration lays over the file's, as it was laid over: a change made to it in
// place since, as a hook handed it might make, is not laid over the next.
test('a config read again keeps what was laid over it', async () => {
  const cwd = project()
  const ctx = await loadConfigAndCreateContext({ config: { include: ['src/**/*.vue'], prefix: 'laid' }, cwd })
  expect(ctx.config.prefix).toBe('laid')
  ctx.config.include.push('src/**/*.tsx')

  edit(cwd, '2px')
  const { reloaded } = await reload(ctx)

  expect(reloaded.config.prefix).toBe('laid')
  expect(reloaded.config.include).toEqual(['src/**/*.vue'])
  expect(reloaded.config.cwd).toBe(cwd)
})

// From where it was read first, wherever the process has moved since: a preset named as a package
// is resolved from there.
test('a config read again is read from where it was read first', async () => {
  const cwd = project(`presets: ['probe-preset'], `)
  const preset = join(cwd, 'node_modules/probe-preset')
  mkdirSync(preset, { recursive: true })
  writeFileSync(join(preset, 'package.json'), JSON.stringify({ name: 'probe-preset', main: 'index.js' }))
  writeFileSync(
    join(preset, 'index.js'),
    `module.exports = { theme: { extend: { tokens: { sizes: { preset: { value: '9px' } } } } } }\n`,
  )

  const at = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  try {
    const ctx = await loadConfigAndCreateContext()
    expect(ctx.tokens.getByName('sizes.preset')?.value).toBe('9px')

    at.mockReturnValue(scratch('elsewhere'))
    edit(cwd, '2px', `presets: ['probe-preset'], `)
    const { reloaded } = await reload(ctx)

    expect(new BambooContext(reloaded).tokens.getByName('sizes.preset')?.value).toBe('9px')
  } finally {
    at.mockRestore()
  }
})

/** A codegen under `bamboo codegen --watch --clean`, and the rebuild after an edit to its config. */
const cleanRebuild = async (cwd: string, rest?: string) => {
  let ctx = await loadConfigAndCreateContext({ config: { clean: true }, cwd })
  await codegen(ctx)
  expect(existsSync(join(cwd, 'styled-system/css/index.mjs'))).toBe(true)

  edit(cwd, '2px', rest)
  const { affected, reloaded } = await reload(ctx)
  ctx = new BambooContext(reloaded)
  expect(ctx.config.clean).toBe(true)
  await codegen(ctx, artifactsToRebuild(affected))
}

// `clean` empties the directory before a run that writes every artifact. A rebuild after an edit
// writes only what the edit changed, and emptying first left nothing else.
test('a rebuild after a config edit leaves what the edit did not change', async () => {
  const cwd = project()
  await cleanRebuild(cwd)

  expect(existsSync(join(cwd, 'styled-system/css/index.mjs')), 'left where it was').toBe(true)
  expect(readFileSync(join(cwd, 'styled-system/tokens/index.mjs'), 'utf8')).toContain('2px')
})

// Unless the edit changed what every artifact is written from. Rebuilt from those it matched,
// `helpers` and `css/index` — which no option names — stayed under the old extension.
test('a rebuild after an edit that changes every artifact writes them all', async () => {
  const cwd = project()
  await cleanRebuild(cwd, `outExtension: 'js', `)

  expect(existsSync(join(cwd, 'styled-system/helpers.js'))).toBe(true)
  expect(existsSync(join(cwd, 'styled-system/css/index.js'))).toBe(true)
  expect(existsSync(join(cwd, 'styled-system/css/index.mjs')), 'emptied first').toBe(false)
})

test('what was laid over is copied as it was defined', () => {
  const hook = () => undefined
  const instance = new (class Plugin {
    hooks = {}
  })()
  const shared = { value: '1px' }
  const tag = Symbol('tag')
  let reads = 0
  const conditions = new Map([['dark', '.dark &']])
  const globs = new (class Globs extends Array<string> {})()
  const laidOver: Record<PropertyKey, any> = {
    include: ['src/**/*.tsx'],
    hooks: { 'config:resolved': hook },
    instance,
    conditions,
    globs,
    exclude: Object.freeze(['src/legacy/**']),
    tokens: { a: shared, b: shared },
    foreign: runInNewContext(`({ theme: { tokens: {} } })`),
    [tag]: 'tagged',
    get lazy() {
      reads++
      return 'read'
    },
  }
  laidOver.self = laidOver

  const copy = copyLaidOver(laidOver)

  expect(copy.include).not.toBe(laidOver.include)
  expect(copy.include).toEqual(['src/**/*.tsx'])
  expect(copy.hooks['config:resolved'], 'a function is the same').toBe(hook)
  expect(copy.instance, 'as is an instance').toBe(instance)
  expect(copy.conditions, 'and a map').toBe(conditions)
  expect(copy.globs, 'and an array of a class of its own').toBe(globs)
  expect(copy.exclude).not.toBe(laidOver.exclude)
  expect(Object.isFrozen(copy.exclude), 'frozen stays frozen').toBe(true)
  expect(copy.tokens.a, 'copied once').toBe(copy.tokens.b)
  expect(copy.tokens.a).not.toBe(shared)
  expect(copy.foreign.theme, 'plain in another realm').not.toBe(laidOver.foreign.theme)
  expect(copy[tag]).toBe('tagged')
  expect(reads, 'a getter is not called').toBe(0)
  expect(copy.lazy).toBe('read')
  expect(copy.self, 'refers to its copy').toBe(copy)
})
