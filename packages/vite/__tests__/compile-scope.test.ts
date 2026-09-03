import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@bamboocss/logger'
import { describe, expect, test, vi } from 'vitest'
import { bamboocss, namesEntrypoint } from '../src/plugin'

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

  test('compiles a module `include` covers, whatever it imports', async () => {
    const code = `import { css } from '../styled-system/css'\nexport const cls = css({ color: 'red.200' })\n`
    expect((await transform(code, 'src/covered.ts'))?.code).toContain('c_red')
  })

  test('the entrypoint test reads the outdir name and every import map path', () => {
    const ctx = { imports: { outdir: './generated/styled', value: { css: ['@acme/styled/css'], recipe: [] } } }

    expect(namesEntrypoint(ctx, `import { css } from '../generated/styled/css'`)).toBe(true)
    expect(namesEntrypoint(ctx, `import { button } from '@acme/styled/css'`)).toBe(true)
    expect(namesEntrypoint(ctx, `export const answer = 42`)).toBe(false)
  })
})
