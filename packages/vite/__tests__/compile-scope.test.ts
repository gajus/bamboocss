import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@bamboocss/logger'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { bamboocss, importsSourceModule, namesEntrypoint } from '../src/plugin'

const cwd = join(dirname(fileURLToPath(import.meta.url)), '../../../sandbox/codegen')

const hookOf = <T>(hook: T | { handler: T } | undefined): T | undefined =>
  typeof hook === 'function' ? hook : (hook as { handler: T } | undefined)?.handler

const transform = async (code: string, file: string) => {
  const plugin = bamboocss({ cwd, reportSummary: false }).find((p) => p.name === 'bamboocss:compiler')!
  await hookOf(plugin.buildStart)?.call({} as never, {} as never)
  const result = await hookOf(plugin.transform)?.call(
    { addWatchFile: () => {} } as never,
    code,
    join(cwd, file),
    {} as never,
  )
  return result as { code: string } | null | undefined
}

/**
 * The compiler transforms what the extraction inventory covers, and nothing else.
 *
 * A module outside `include`, or one `exclude` drops, yields no stylesheet rule whatever it
 * calls, so compiling it is wasted — and each one used to be installed in the shared project
 * under an auxiliary path, which reloads the whole program in the TypeScript 7 compiler. On an
 * app with 3,000 excluded generated modules that was the difference between a build that
 * finished and one that hit its CI timeout.
 */
describe('what the compiler transforms', () => {
  const plain = `export const answer = (value: number) => value * 2\n`

  test('leaves a module outside `include` alone when it names no bamboo entrypoint', async () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    try {
      // `dist/` is outside the sandbox's `include` of `src` and `pages`.
      expect(await transform(plain, 'dist/generated/answer.ts')).toBeNull()
      // Skipped before parsing, rather than parsed and found empty.
      expect(debug.mock.calls.some(([, message]) => String(message).includes('Skipped'))).toBe(true)
    } finally {
      debug.mockRestore()
    }
  })

  test('still compiles a module outside `include` that imports a bamboo entrypoint', async () => {
    const code = `import { css } from '../styled-system/css'\nexport const cls = css({ color: 'red.200' })\n`
    const result = await transform(code, 'dist/styled.ts')

    expect(result?.code).toContain('c_red')
    expect(result?.code).not.toContain('css({')
  })

  test('still compiles a module outside `include` that imports a module the project holds', async () => {
    // The sandbox's own `src/App.tsx` is in the inventory; a module outside it importing that
    // may be calling a recipe declared there.
    const code = `import { App } from '../src/App'\nexport const value = App\n`
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    try {
      await transform(code, 'dist/consumer.ts')
      expect(debug.mock.calls.some(([, message]) => String(message).includes('Skipped'))).toBe(false)
    } finally {
      debug.mockRestore()
    }
  })

  test('leaves a rewrite of an included module alone when the rewrite reaches nothing bamboo', async () => {
    // What a router derives from a page module: not the file's text, and nothing bamboo in it.
    const stub = `export const exportNames = ['default', 'Page']\n`
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    try {
      expect(await transform(stub, 'src/App.tsx')).toBeNull()
      expect(debug.mock.calls.some(([, message]) => String(message).includes('rewritten before bamboo'))).toBe(true)
    } finally {
      debug.mockRestore()
    }
  })

  test('compiles a module `include` covers when it names a bamboo entrypoint', async () => {
    const code = `import { css } from '../styled-system/css'\nexport const cls = css({ color: 'red.200' })\n`
    expect((await transform(code, 'src/covered.ts'))?.code).toContain('c_red')
  })

  test('the entrypoint test reads the outdir name and every import map path', () => {
    const ctx = {
      imports: {
        outdir: './generated/styled',
        value: { css: ['@acme/styled/css'], recipe: [], pattern: [], tokens: [] },
      },
    }

    expect(namesEntrypoint(ctx, `import { css } from '../generated/styled/css'`)).toBe(true)
    expect(namesEntrypoint(ctx, `import { button } from '@acme/styled/css'`)).toBe(true)
    expect(namesEntrypoint(ctx, `export const answer = 42`)).toBe(false)
  })

  test.each([
    ['./styles.js', 'styles.ts'],
    ['./styles.jsx', 'styles.tsx'],
    ['@app/styles.mjs', 'styles.mts'],
    ['styles.cjs', 'styles.cts'],
    ['./styles.js', 'styles.js'],
  ])('counts an import of %s when the inventory holds %s', (specifier, source) => {
    expect(
      importsSourceModule(
        {
          isSourceModule: (path) => path === join(cwd, 'src', source),
          isSourcePackage: () => false,
          resolveAlias: (name) => (name.startsWith('@app/') ? join(cwd, 'src', name.slice('@app/'.length)) : undefined),
          baseUrl: join(cwd, 'src'),
        },
        join(cwd, 'src', 'entry.ts'),
        `import { badge } from '${specifier}'\nexport const className = badge({})`,
      ),
    ).toBe(true)
  })

  const reaches = (code: string) =>
    importsSourceModule(
      {
        isSourceModule: (path) => path === join(cwd, 'src', 'styles.ts'),
        isSourcePackage: () => false,
        resolveAlias: () => undefined,
        baseUrl: undefined,
      },
      join(cwd, 'src', 'entry.ts'),
      `${code}\nexport const className = badge({})`,
    )

  // A comment in front of the specifier hid it: the module was skipped, and the recipe call in it
  // shipped uncompiled, to throw when it was loaded. Read as extraction's scan reads it.
  test.each([
    ['a block comment after from', `import { badge } from /* the recipe */ './styles'`],
    ['a line comment after from', `import { badge } from // the recipe\n  './styles'`],
    ['a comment in an export-from', `export { badge } from /* the recipe */ './styles'`],
    ['a comment in a dynamic import', `const { badge } = await import(/* @vite-ignore */ './styles')`],
    ['a comment in a side-effect import', `import /* registers the recipe */ './styles'`],
  ])('counts the import, reading past %s', (_label, code) => {
    expect(reaches(code)).toBe(true)
  })

  // It names a file only once decoded, which the analysis does.
  test.each([
    ['a unicode escape', `import { badge } from './style\\u0073'`],
    ['a hex escape', `import { badge } from './style\\x73'`],
  ])('counts a specifier spelled with %s', (_label, code) => {
    expect(reaches(code)).toBe(true)
  })

  test('does not count a comment that wraps after "from", or Array.from( before one', () => {
    const code =
      `import { z } from 'zod'\n// The schema is derived from\n// the API's own.\n` +
      `export const rows = Array.from(\n  // one row per letter\n  'abc',\n)\n`
    expect(reaches(code)).toBe(false)
  })
})

/**
 * A module is compiled only when it can reach bamboo — held by `include` as it is, rewritten by
 * a plugin first, or outside `include` altogether.
 *
 * Parsing one that names no entrypoint and imports nothing the project holds finds no call to
 * fold, and on an app where most modules hold no styles that was most of the compiler's time. A
 * package import counts when the project holds that package's files: a workspace design system
 * imported as `@acme/ds` is compiled from source, its compiled module no longer defines what a
 * caller left uncompiled would call, and that caller throws at runtime.
 *
 * Answered without the bundler, whose resolver throws here as Vite's does for a package with no
 * JavaScript: the specifiers are read out of text, which cannot tell a type from a value, and
 * asking Vite about `import type { Simplify } from 'type-fest'` failed the build.
 */
describe('which modules the compiler transforms', () => {
  let root: string
  const files = {
    plain: `export const answer = (value: number) => value * 2\n`,
    consumer: `import { button } from '@acme/ds'\nexport const cls = button({ size: 'sm' })\n`,
    published: `import { button } from 'published-ds'\nexport const cls = button({ size: 'sm' })\n`,
    typeOnly:
      `import type { Simplify } from 'types-only'\n` +
      `export type Shape = Simplify<{ a: 1 }>\n` +
      `export type Expression = import('types-only').Simplify<{ b: 2 }>\n` +
      `export const one = 1\n`,
  }

  beforeAll(() => {
    // Outside the checkout, so the native resolver cannot meet it from an unrelated test.
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-compile-scope-')))
    const write = (file: string, content: string) => {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), content)
    }
    write(
      'bamboo.config.ts',
      `export default { preflight: false, include: ['./app/**/*.ts', './packages/ds/src/**/*.ts'], outdir: 'styled-system' }\n`,
    )
    for (const [name, content] of Object.entries(files)) write(`app/${name}.ts`, content)
    write('outside/consumer.ts', files.consumer)
    // A workspace package `include` reaches, linked into `node_modules` as a package manager does.
    write('packages/ds/package.json', JSON.stringify({ name: '@acme/ds', type: 'module', exports: './src/index.ts' }))
    write(
      'packages/ds/src/index.ts',
      `import { cva } from '../../../styled-system/css'\n` +
        `export const button = cva({ base: { color: 'red' }, variants: { size: { sm: { padding: '1px' } } } })\n`,
    )
    mkdirSync(join(root, 'node_modules/@acme'), { recursive: true })
    // A junction, which Windows creates without elevated rights.
    symlinkSync(join(root, 'packages/ds'), join(root, 'node_modules/@acme/ds'), 'junction')
    // A published package, which ships its own output, and one with no JavaScript, as `type-fest` has none.
    write(
      'node_modules/published-ds/package.json',
      JSON.stringify({ name: 'published-ds', type: 'module', exports: './index.js' }),
    )
    write('node_modules/published-ds/index.js', `export const button = () => 'button'\n`)
    write(
      'node_modules/types-only/package.json',
      JSON.stringify({ name: 'types-only', exports: { '.': { types: './index.d.ts' } } }),
    )
    write('node_modules/types-only/index.d.ts', `export type Simplify<T> = { [K in keyof T]: T[K] }\n`)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const transformIn = async (file: string, code: string) => {
    const list = bamboocss({ cwd: root, reportSummary: false })
    const css = list.find((p) => p.name === 'bamboocss:css')!
    const plugin = list.find((p) => p.name === 'bamboocss:compiler')!
    const config = { command: 'build', root, build: { sourcemap: false } }
    const context = {
      addWatchFile: () => {},
      environment: { name: 'client', config: { build: { sourcemap: false } } },
      resolve: async (specifier: string) => {
        throw new Error(`"." is not exported under the conditions ["module", "browser", "import"] from ${specifier}`)
      },
    }
    // In the order Vite runs them: the stylesheet's `buildStart` extracts, which is what builds
    // the inventory a package import is answered from, before any module is transformed.
    await hookOf(css.configResolved)?.call({} as never, config as never)
    await hookOf(plugin.configResolved)?.call({} as never, config as never)
    await hookOf(css.buildStart)?.call(context as never, {} as never)
    await hookOf(plugin.buildStart)?.call(context as never, {} as never)
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    try {
      const result = await hookOf(plugin.transform)?.call(context as never, code, join(root, file), {} as never)
      const skipped = debug.mock.calls.some(([, message]) => String(message).includes('Skipped'))
      return { code: (result as { code: string } | null | undefined)?.code, skipped }
    } finally {
      debug.mockRestore()
    }
  }

  test('leaves an included module alone when it names no entrypoint and imports nothing the project holds', async () => {
    const { code, skipped } = await transformIn('app/plain.ts', files.plain)
    expect(code).toBeUndefined()
    // Skipped before parsing, rather than parsed and found empty.
    expect(skipped).toBe(true)
  })

  test('leaves one alone whose package imports are type-only, of a package with no JavaScript', async () => {
    const { code, skipped } = await transformIn('app/typeOnly.ts', files.typeOnly)
    expect(code).toBeUndefined()
    expect(skipped).toBe(true)
  })

  test('leaves one alone that imports a published package', async () => {
    expect((await transformIn('app/published.ts', files.published)).skipped).toBe(true)
  })

  test('compiles one that imports, by package name, a workspace package `include` reaches', async () => {
    const { code, skipped } = await transformIn('app/consumer.ts', files.consumer)
    expect(skipped).toBe(false)
    // The recipe call is folded to its class, rather than left to call a definition compiling
    // the design system removed.
    expect(code).toBeDefined()
    expect(code).not.toContain('button({')
  })

  test('compiles that module when a plugin rewrote it first', async () => {
    // What plugin-react's babel pass hands on when it is listed ahead of bamboo: not the file's text.
    const { code, skipped } = await transformIn('app/consumer.ts', `/* rewritten */\n${files.consumer}`)
    expect(skipped).toBe(false)
    expect(code).toBeDefined()
    expect(code).not.toContain('button({')
  })

  test('compiles one outside `include` that imports that package', async () => {
    const { code, skipped } = await transformIn('outside/consumer.ts', files.consumer)
    expect(skipped).toBe(false)
    expect(code).toBeDefined()
    expect(code).not.toContain('button({')
  })

  // Each was skipped, leaving the call to a definition compiling the design system removed: a
  // build that passed and a module that threw when loaded, in the client and in SSR. The last two
  // put a quote in front of the import whose word ends in a keyword: read as a specifier opening,
  // it took everything up to the next quote, the real specifier's, lines later or on the same line.
  test.each([
    ['a comment in front of its specifier', `import { button } from /* the design system */ '@acme/ds'`],
    ['an escape in its specifier', `import { button } from '@acme/d\\u0073'`],
    [
      'a comment quoting "import" on the line before',
      `// keep the "import" below first\nimport { button } from '@acme/ds'`,
    ],
    ['a quoted key "import" on the same line', `const map = { "import": 1 }; import { button } from '@acme/ds'`],
  ])('compiles one that imports that package with %s', async (_label, line) => {
    const { code, skipped } = await transformIn(
      'app/consumer.ts',
      `${line}\nexport const cls = button({ size: 'sm' })\n`,
    )
    expect(skipped).toBe(false)
    expect(code).toBeDefined()
    expect(code).not.toContain('button({')
  })
})
