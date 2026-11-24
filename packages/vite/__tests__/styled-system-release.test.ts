// @vitest-environment node
// Loads a `bamboo.config.mjs` written outside the project and imports the bundle a build produced,
// neither of which happy-dom can resolve; a build does both in Node, which is what this pins.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { codegen, loadConfigAndCreateContext } from '@bamboocss/node'
import { compiledHelperName } from '@bamboocss/shared'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { bamboocss } from '../src/plugin'

/**
 * A recipe call the compiler writes reaches the helpers of the `styled-system` its import
 * resolves to, and one another release generated is refused.
 *
 * The plugin writes the project's own `styled-system` before anything imports it, so a compiled
 * call meets a runtime of another release only in one it did not write. A workspace design system
 * holding its own is that: the app compiles its recipe, and the call imports `cvaMap` from beside
 * the recipe's declaration. The table format `cvaMap` reads changed three times in two days, and
 * a `cvaMap` from before read a table written after as selecting nothing, so the element lost its
 * recipe's classes with nothing said. Named for the release, the helper is not there to import.
 */
let root: string

const write = (file: string, contents: string) => {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

/** The design system's own `styled-system`, which the app's plugin does not write. */
const OWN_RUNTIME = 'packages/ds/styled-system'

/** What a helper's name ends in for this release, and for one before it. */
const RELEASE = compiledHelperName('cvaMap').slice('cvaMap'.length)
const OTHER_RELEASE = '$bamboo_1_0_0'

beforeAll(async () => {
  // Outside the checkout, so the native resolver cannot meet it from an unrelated test, and by
  // its real path, which Windows spells long only through `realpathSync.native`.
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-styled-system-release-')))
  write(
    'bamboo.config.mjs',
    `export default { include: ['./src/**/*.ts', './packages/ds/src/**/*.ts'], outdir: 'styled-system', preflight: false }\n`,
  )
  write('packages/ds/package.json', JSON.stringify({ name: '@acme/ds', type: 'module', exports: './src/index.ts' }))
  write(
    'packages/ds/src/index.ts',
    `import { cva } from '../styled-system/css'\n` +
      `export const button = cva({ base: { color: 'red' }, ` +
      `variants: { size: { sm: { padding: '[1.1111px]' }, md: { padding: '[2.2222px]' } } } })\n`,
  )
  mkdirSync(join(root, 'node_modules/@acme'), { recursive: true })
  // A junction, which Windows creates without elevated rights.
  symlinkSync(join(root, 'packages/ds'), join(root, 'node_modules/@acme/ds'), 'junction')
  // A size only known at runtime, so the call compiles to a `cvaMap` lookup.
  write(
    'src/entry.ts',
    `import 'virtual:bamboo.css'\nimport { button } from '@acme/ds'\nexport const className = (size) => button({ size })\n`,
  )

  const ctx = await loadConfigAndCreateContext({ cwd: root })
  await codegen(ctx)
}, 120_000)

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

/**
 * Give the design system a `styled-system` generated as a `bamboo codegen` of `release` writes
 * one: this release's output, its helpers named for that release.
 */
const generateOwnRuntime = (release: string) => {
  rmSync(join(root, OWN_RUNTIME), { recursive: true, force: true })
  cpSync(join(root, 'styled-system'), join(root, OWN_RUNTIME), { recursive: true })
  for (const file of ['css/cx.mjs', 'css/index.mjs']) {
    const path = join(root, OWN_RUNTIME, file)
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(RELEASE, release))
  }
}

const buildEntry = async () => {
  const result = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [bamboocss({ cwd: root, reportSummary: false })],
    build: {
      write: false,
      minify: false,
      lib: { entry: join(root, 'src/entry.ts'), formats: ['es'], fileName: 'release' },
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

describe('a recipe call compiled against the styled-system its import reaches', () => {
  test('selects its classes from one this release generated', async () => {
    generateOwnRuntime(RELEASE)

    const { css, js } = await buildEntry()
    const { className } = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)) as {
      className: (size: string) => string
    }

    // A table read in another format selects nothing, which is the empty string.
    for (const size of ['sm', 'md']) {
      const selected = className(size)
      expect(selected).toBeTruthy()
      for (const atom of selected.split(' ')) expect(hasRuleFor(css, atom), atom).toBe(true)
    }
    expect(className('sm')).not.toBe(className('md'))
  }, 60_000)

  test('is refused for one another release generated, naming the helper and where it was looked for', async () => {
    generateOwnRuntime(OTHER_RELEASE)

    const missing = compiledHelperName('cvaMap').replaceAll('$', '\\$')
    await expect(buildEntry()).rejects.toThrow(
      new RegExp(
        `"${missing}" is not exported by "[^"]*packages[\\\\/]ds[\\\\/]styled-system[\\\\/]css[\\\\/]index\\.mjs"`,
      ),
    )
  }, 60_000)
})
