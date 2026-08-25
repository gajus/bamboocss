import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Builder } from '../src/builder'

/**
 * The source mutations a bundler integration makes to a Project it shares with extraction.
 *
 * A Vite build folds a consumer *before* the module it imports — that is how a bundler
 * discovers imports — so an edited module has to be refreshed in ts-morph before any dependent
 * transform runs, which is earlier than the next `Builder.setup`. That made the mutation the
 * integration's to perform and the Builder's to account for: reloading a file retracts its own
 * forward edges, and the pass that decides what to re-extract reads them afterwards.
 *
 * So the Builder owns both, and snapshots the resolution ledger before the first of them.
 */
const roots: string[] = []

const project = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'bamboo-builder-shared-'))
  roots.push(root)

  for (const [file, contents] of Object.entries({
    'bamboo.config.mjs': `export default {
      include: ['src/**/*.{ts,tsx}'],
      outdir: 'styled-system',
      preflight: false,
    }`,
    'styled-system/css.ts': `export const css = (..._args: any[]) => ''`,
    ...files,
  })) {
    const target = join(root, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }

  return { configPath: join(root, 'bamboo.config.mjs'), file: (name: string) => join(root, 'src', name), root }
}

/** Written far enough ahead that a same-second rewrite is still seen as a change. */
const write = (path: string, contents: string) => {
  writeFileSync(path, contents)
  const later = new Date(Date.now() + 10_000)
  utimesSync(path, later, later)
}

const APP = `import { css } from '../styled-system/css'
  import { decoration } from './styles'
  export const className = css(decoration)`

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('Builder-owned source mutation', () => {
  const fixture = () => project({ 'src/styles.ts': `export const decoration = { color: 'blue' }`, 'src/app.tsx': APP })

  const setUp = async (created: ReturnType<typeof project>) => {
    const builder = new Builder()
    await builder.setup({ configPath: created.configPath, cwd: created.root })
    builder.extract()
    return builder
  }

  test('an edited dependency reloaded before the pass still moves its consumer', async () => {
    const created = fixture()
    const builder = await setUp(created)
    expect(builder.toCss({ layerParams: true })).toContain('blue')

    // What the integration's `watchChange` does, one hook before the rebuild.
    write(created.file('styles.ts'), `export const decoration = { color: 'red' }`)
    builder.reloadSource(created.file('styles.ts'))

    await builder.setup({ configPath: created.configPath, cwd: created.root })
    builder.extract()

    const css = builder.toCss({ layerParams: true })
    expect(css).toContain('red')
    expect(css, 'the consumer was re-extracted, not merely re-read').not.toContain('blue')
  })

  test('a deleted dependency dropped before the pass stops contributing through its consumer', async () => {
    const created = fixture()
    const builder = await setUp(created)
    expect(builder.toCss({ layerParams: true })).toContain('blue')

    rmSync(created.file('styles.ts'), { force: true })
    builder.removeSource(created.file('styles.ts'))
    write(created.file('app.tsx'), `import { css } from '../styled-system/css'\n  export const className = css({})`)

    await builder.setup({ configPath: created.configPath, cwd: created.root })
    builder.extract()

    expect(builder.toCss({ layerParams: true })).not.toContain('blue')
  })

  test('both refuse to guess at a context, rather than setting one up from a transform', () => {
    const builder = new Builder()

    expect(() => builder.reloadSource('/app/src/styles.ts')).toThrow()
    expect(() => builder.removeSource('/app/src/styles.ts')).toThrow()
  })
})
