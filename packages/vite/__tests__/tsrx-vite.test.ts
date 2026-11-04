// @vitest-environment node
// Writes a project under the system temp directory and drives real Vite builds and a dev server
// against it, which happy-dom cannot.

import { compile } from '@tsrx/react'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { codegen, loadConfigAndCreateContext } from '@bamboocss/node'
import { build, createServer, transformWithEsbuild, type Plugin, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { bamboocss } from '../src/plugin'

/**
 * A `.tsrx` project built and served end to end.
 *
 * `tsrxPre` below models the TSRX framework plugins — octane's and `@tsrx/vite-plugin-react`'s —
 * which are `enforce: 'pre'` transforms that run `@tsrx/react`'s `compile` and then a JSX
 * retransform. That is what Bamboo's compiler sees in a real setup. (`@tsrx/vite-plugin-react`
 * itself imports `transformWithOxc`, a Vite 8/rolldown export, so it cannot load under the
 * Vite 7 this package tests against.)
 */
const tsrxPre = (): Plugin => ({
  name: 'tsrx-test-plugin',
  enforce: 'pre',
  async transform(code, id) {
    const file = id.split('?')[0]!
    if (!file.endsWith('.tsrx')) return null
    const { code: tsx, map } = compile(code, file)
    return transformWithEsbuild(tsx, file, { loader: 'tsx', jsx: 'automatic' }, map)
  },
})

let root: string

const write = (file: string, contents: string) => {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-tsrx-')))
  write(
    'bamboo.config.mjs',
    `export default { include: ['src/**/*.{ts,tsrx}'], outdir: 'styled-system', preflight: false }\n`,
  )
  write(
    'src/Card.tsrx',
    `import { css } from '../styled-system/css'\n` +
      `export function Card(props: { items: string[] }) @{\n` +
      `  const label = css({ color: 'red.300' })\n` +
      `  <div className={css({ padding: '4', borderRadius: 'lg' })}>\n` +
      `    @for (const item of props.items; key item) {\n` +
      `      <span className={label}>{item}</span>\n` +
      `    }\n` +
      `  </div>\n` +
      `}\n`,
  )
  write(
    'src/Conditional.tsrx',
    `import { css } from '../styled-system/css'\n` +
      `export function Conditional(props: { on: boolean }) @{\n` +
      `  <>\n` +
      `    @if (props.on) {\n      <i className={css({ color: 'green.300' })} />\n    }` +
      ` @else {\n      <i className={css({ color: 'blue.300' })} />\n    }\n` +
      `  </>\n` +
      `}\n`,
  )
  write(
    'src/module-scope.tsrx',
    `import { css } from '../styled-system/css'\nexport const tone = css({ color: 'red.500' })\n`,
  )
  write('src/Plain.tsrx', `export function Plain() @{\n  <i title="no styles" />\n}\n`)
  write('src/plain-entry.ts', `import 'virtual:bamboo.css'\nexport { Plain } from './Plain.tsrx'\n`)
  write(
    'src/entry.ts',
    `import 'virtual:bamboo.css'\nexport { Card } from './Card.tsrx'\nexport { Conditional } from './Conditional.tsrx'\nexport { tone } from './module-scope.tsrx'\n`,
  )
  // The dev server resolves the compiled module's imports; the temp project has no react, so the
  // jsx runtime and `@tsrx` runtime are pointed at a stub that exports the names compiled code uses.
  write(
    'src/jsx-stub.ts',
    `export const jsx = () => null\nexport const jsxs = jsx\nexport const Fragment = 'fragment'\nexport const map_iterable = () => []\n`,
  )
  const ctx = await loadConfigAndCreateContext({ cwd: root })
  await codegen(ctx)
}, 120_000)

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

const hasRuleFor = (css: string, className: string) => {
  const escaped = className.replaceAll(/[^\w-]/g, (ch) => `\\${ch}`)
  return css.includes(`.${escaped}`) || css.includes(`.${className}`)
}

/**
 * Class tokens the compiled JavaScript carries: folded names are hashed (`AxhTk dJhuAD`), so a
 * string literal of bare identifiers that is not a path or specifier counts.
 */
const classesIn = (js: string) =>
  [...js.matchAll(/[:=]\s*["'`]([\w$.-]+(?:\s[\w$.-]+)*)["'`]/g)]
    .map((match) => match[1]!)
    .flatMap((literal) => literal.split(' '))

const buildEntry = async (entry: string, plugins: Plugin[] = [tsrxPre()]) => {
  const result = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [...plugins, ...bamboocss({ cwd: root, reportSummary: false })],
    build: {
      write: false,
      minify: false,
      lib: { entry: join(root, entry), formats: ['es'], fileName: 'entry' },
      rollupOptions: { external: /^(?:react|@tsrx)/ },
    },
  })) as Rollup.RollupOutput[]

  const output = result[0]!.output
  return {
    css: output.map((o) => ('source' in o && typeof o.source === 'string' ? o.source : '')).join('\n'),
    js: output.map((o) => ('code' in o ? o.code : '')).join('\n'),
  }
}

describe('a .tsrx project', () => {
  test('builds: every class in the JavaScript has a rule, with its declarations', async () => {
    const { css, js } = await buildEntry('src/entry.ts')

    expect(css).toContain('padding:')
    expect(css).toContain('border-radius:')
    expect(css).toMatch(/color: var\(--colors-[\w.-]+\)/)

    // Four folded call sites — label, div, and both `@if` branches — plus the module-scope one.
    const classes = classesIn(js)
    expect(classes.length).toBeGreaterThanOrEqual(5)
    expect(js).not.toContain('css(')
    const missing = classes.filter((className) => !hasRuleFor(css, className))
    expect(missing).toEqual([])
  }, 120_000)

  test('builds an `@{ }` component that calls no style function', async () => {
    const { js } = await buildEntry('src/plain-entry.ts')
    expect(js).toContain('Plain')
  }, 120_000)

  // The TSRX framework plugin is `enforce: 'pre'` and must run before `bamboocss()`. When it is
  // absent the compiler meets raw TSRX, which it cannot parse — the error has to say that, not
  // merely that parsing failed. In a build the transform declines after logging it and esbuild's
  // own parse error is what fails the build; in dev the error reaches the request.
  test('fails clearly when raw TSRX reaches the compiler', async () => {
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      plugins: [...bamboocss({ cwd: root, reportSummary: false })],
      server: { middlewareMode: true, hmr: false },
    })
    try {
      await expect(server.environments.client.transformRequest('/src/Card.tsrx')).rejects.toThrowError(
        /reached the compiler as raw TSRX/,
      )
      await expect(server.environments.client.transformRequest('/src/Card.tsrx')).rejects.toThrowError(
        /before `bamboocss\(\)`/,
      )
    } finally {
      await server.close()
    }
  }, 120_000)

  test('serves the stylesheet in dev, and reflects a .tsrx edit', async () => {
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      css: { postcss: { plugins: [] } },
      plugins: [tsrxPre(), ...bamboocss({ cwd: root, reportSummary: false })],
      resolve: {
        alias: [
          { find: /^react\/jsx-(?:dev-)?runtime$/, replacement: join(root, 'src/jsx-stub.ts') },
          { find: /^@tsrx\/.*$/, replacement: join(root, 'src/jsx-stub.ts') },
        ],
      },
      server: { middlewareMode: true, hmr: false },
    })
    // The served module is the sheet as a JS string literal, so `\.` arrives as `\\.` — undo
    // the one escaping a string literal adds before matching selectors against it.
    const sheet = async () =>
      ((await server.environments.client.transformRequest('virtual:bamboo.css'))?.code ?? '').replaceAll('\\\\', '\\')

    try {
      const transformed = await server.environments.client.transformRequest('/src/Card.tsrx')
      expect(transformed?.code ?? '').toContain('p_4')

      const before = await sheet()
      for (const className of ['p_4', 'bdr_lg', 'c_red.300']) {
        expect(hasRuleFor(before, className), className).toBe(true)
      }

      // A new call inside an `@if` branch of the `@{ }` body.
      write(
        'src/Card.tsrx',
        `import { css } from '../styled-system/css'\n` +
          `export function Card(props: { items: string[]; on?: boolean }) @{\n` +
          `  const label = css({ color: 'red.300' })\n` +
          `  <div className={css({ padding: '4', borderRadius: 'lg' })}>\n` +
          `    @for (const item of props.items; key item) {\n` +
          `      <span className={label}>{item}</span>\n` +
          `    }\n` +
          `    @if (props.on) {\n      <i className={css({ color: 'yellow.300' })} />\n    }\n` +
          `  </div>\n` +
          `}\n`,
      )
      // The watcher's own event, so the whole invalidation path runs. Dispatched asynchronously
      // and not awaitable, hence the poll: a stale read just polls again.
      server.watcher.emit('change', join(root, 'src/Card.tsrx'))

      const deadline = Date.now() + 10_000
      let css = ''
      let recompiled = ''
      do {
        await new Promise((resolve) => setTimeout(resolve, 50))
        css = await sheet()
        recompiled = (await server.environments.client.transformRequest('/src/Card.tsrx'))?.code ?? ''
      } while (!(hasRuleFor(css, 'c_yellow.300') && recompiled.includes('c_yellow.300')) && Date.now() < deadline)

      // Both halves of the update: the sheet carries the new rule and the re-compiled module
      // names a class for it.
      expect(hasRuleFor(css, 'c_yellow.300'), 'the edit never reached the stylesheet').toBe(true)
      for (const className of classesIn(recompiled)) {
        expect(hasRuleFor(css, className), className).toBe(true)
      }
    } finally {
      await server.close()
    }
  }, 120_000)
})
