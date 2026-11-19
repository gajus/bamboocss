// @vitest-environment node
// Loads a `bamboo.config.mjs` written outside the project and imports the bundle a build produced,
// neither of which happy-dom can resolve; a build does both in Node, which is what this pins.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { codegen, loadConfigAndCreateContext } from '@bamboocss/node'
import { build, type Plugin, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { bamboocss } from '../src/plugin'

/**
 * A recipe imported by package name from a workspace design system folds wherever it is called.
 *
 * The compiler skips a module that reaches nothing bamboo, and a package import reaches bamboo
 * when the project holds that package's files. Compiling the design system's source removes its
 * recipe definitions, so a caller skipped by mistake ships a call to nothing and throws as the
 * bundle loads. This builds a real project through Vite's resolver, which is where the skip went
 * wrong twice: a caller another plugin rewrote first was skipped, and asking the bundler where a
 * type-only import of a package with no JavaScript resolves failed the build.
 */
let root: string

const write = (file: string, contents: string) => {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

beforeAll(async () => {
  // Outside the checkout, so the native resolver cannot meet it from an unrelated test, and by
  // its real path, which Windows spells long only through `realpathSync.native`.
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-compile-scope-build-')))
  write(
    'bamboo.config.mjs',
    `export default { include: ['./src/**/*.ts', './packages/ds/src/**/*.ts'], outdir: 'styled-system', preflight: false }\n`,
  )
  // A workspace package `include` reaches, linked into `node_modules` as a package manager does.
  write('packages/ds/package.json', JSON.stringify({ name: '@acme/ds', type: 'module', exports: './src/index.ts' }))
  write(
    'packages/ds/src/index.ts',
    `import { cva } from '../../../styled-system/css'\n` +
      `export const button = cva({ base: { color: 'red' }, ` +
      `variants: { size: { sm: { padding: '[1.1111px]' }, md: { padding: '[2.2222px]' } } } })\n`,
  )
  mkdirSync(join(root, 'node_modules/@acme'), { recursive: true })
  // A junction, which Windows creates without elevated rights.
  symlinkSync(join(root, 'packages/ds'), join(root, 'node_modules/@acme/ds'), 'junction')
  // No JavaScript at all, as `type-fest` has none: Vite throws resolving it.
  write(
    'node_modules/types-only/package.json',
    JSON.stringify({ name: 'types-only', exports: { '.': { types: './index.d.ts' } } }),
  )
  write('node_modules/types-only/index.d.ts', `export type Simplify<T> = { [K in keyof T]: T[K] }\n`)

  write('src/held.ts', `import { button } from '@acme/ds'\nexport const held = button({ size: 'sm' })\n`)
  write('src/rewritten.ts', `import { button } from '@acme/ds'\nexport const rewritten = button({ size: 'md' })\n`)
  write(
    'src/styles.ts',
    `import { cva } from '../styled-system/css/index.js'\n` + `export const badge = cva({ base: { color: 'red' } })\n`,
  )
  write('src/js-consumer.ts', `import { badge } from './styles.js'\nexport const className = badge({})\n`)
  write('src/js-entry.ts', `import 'virtual:bamboo.css'\nexport { className } from './js-consumer'\n`)
  write(
    'src/types.ts',
    `import type { Simplify } from 'types-only'\n` +
      `export type Shape = Simplify<{ a: 1 }>\n` +
      `export type Expression = import('types-only').Simplify<{ b: 2 }>\n` +
      `export const one = 1\n`,
  )
  write(
    'src/entry.ts',
    `import 'virtual:bamboo.css'\n` +
      `export { held } from './held'\nexport { rewritten } from './rewritten'\nexport { one } from './types'\n`,
  )
  write(
    'outside/entry.ts',
    `import 'virtual:bamboo.css'\nimport { button } from '@acme/ds'\nexport const outside = button({ size: 'sm' })\n`,
  )

  const ctx = await loadConfigAndCreateContext({ cwd: root })
  await codegen(ctx)
}, 120_000)

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

/** Rewrites a module before bamboo sees it, as plugin-react's babel pass does when listed first. */
const rewriteFirst: Plugin = {
  name: 'rewrite-first',
  enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('/src/rewritten.ts')) return { code: `/* rewritten */\n${code}`, map: null }
  },
}

const buildEntry = async (entry: string, ssr = false) => {
  const result = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [rewriteFirst, bamboocss({ cwd: root, reportSummary: false })],
    build: {
      write: false,
      minify: false,
      ssr,
      ssrEmitAssets: ssr,
      lib: { entry: join(root, entry), formats: ['es'], fileName: 'scope' },
    },
  })) as Rollup.RollupOutput[]

  const output = result[0]!.output
  const css = output.map((o) => ('source' in o && typeof o.source === 'string' ? o.source : '')).join('\n')
  const js = output.map((o) => ('code' in o ? o.code : '')).join('\n')
  return { css, js }
}

const hasRuleFor = (css: string, className: string) => {
  const escaped = className.replaceAll(/[^\w-]/g, (ch) => `\\${ch}`)
  return css.includes(`.${escaped}`) || css.includes(`.${className}`)
}

describe('a workspace recipe imported by package name', () => {
  test('folds for a held caller and a rewritten one, beside a type-only import of a package with no JavaScript', async () => {
    const { css, js } = await buildEntry('src/entry.ts')
    // Loading the bundle runs both calls, and one left calling a recipe the compiled design
    // system no longer defines throws here.
    const bundle = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)) as {
      held: unknown
      one: unknown
      rewritten: unknown
    }

    for (const className of [bundle.held, bundle.rewritten]) {
      expect(typeof className).toBe('string')
      for (const atom of String(className).split(' ')) expect(hasRuleFor(css, atom), atom).toBe(true)
    }
    expect(bundle.one).toBe(1)
  }, 60_000)

  test('is refused outside `include` rather than shipped calling a recipe that no longer exists', async () => {
    await expect(buildEntry('outside/entry.ts')).rejects.toThrow(/outside the CSS extraction graph/)
  }, 60_000)
})

test.each([
  ['client', false],
  ['SSR', true],
])(
  'folds a recipe imported through its emitted .js specifier in a %s build',
  async (_environment, ssr) => {
    const { css, js } = await buildEntry('src/js-entry.ts', ssr)
    const { className } = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)) as {
      className: string
    }

    expect(className).toBeTruthy()
    expect(hasRuleFor(css, className)).toBe(true)
  },
  60_000,
)
