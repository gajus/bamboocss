import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { bamboocss } from '../src/plugin'

/**
 * What the compiler compiles against, and what the stylesheet is emitted from, are one thing.
 *
 * They were two. The CSS plugin owned a `Builder`, and the compiler separately created its own
 * context — so a project resolved its config twice, built two `BambooContext` objects and two
 * complete ts-morph projects over the same files, and neither half could see what the other
 * had established. These drive both plugins in the order Vite does and check that the halves
 * agree on things they can only agree on by sharing.
 */
const roots: string[] = []

const project = (files: Record<string, string>, config = '') => {
  const root = mkdtempSync(join(tmpdir(), 'bamboo-vite-shared-'))
  roots.push(root)

  for (const [file, contents] of Object.entries({
    'bamboo.config.mjs': `export default {
      include: ['src/**/*.{ts,tsx}'],
      outdir: 'styled-system',
      preflight: false,
      ${config}
    }`,
    ...files,
  })) {
    const target = join(root, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }

  return root
}

const hookOf = <T>(hook: T | { handler: T } | undefined): T | undefined =>
  typeof hook === 'function' ? hook : (hook as { handler: T } | undefined)?.handler

/**
 * Both plugins, driven through the hooks Vite calls and in the order it calls them.
 *
 * The compiler runs `enforce: 'pre'`, so its `buildStart` lands first — which is the ordering
 * the host exists to survive: it must not consume the setup the stylesheet pass then depends
 * on, and it must not load a second config of its own.
 */
const run = async (root: string, command: 'build' | 'serve') => {
  const list = bamboocss({ cwd: root, reportSummary: false })
  const css = list.find((plugin) => plugin.name === 'bamboocss:css')!
  const compiler = list.find((plugin) => plugin.name === 'bamboocss:compiler')!

  const config = {
    command,
    build: {},
    configFileDependencies: [],
    plugins: [],
    root,
  }
  const context = { addWatchFile() {}, environment: { name: 'client' } }

  for (const plugin of [compiler, css]) await hookOf(plugin.configResolved)?.call(context as never, config as never)
  for (const plugin of [compiler, css]) await hookOf(plugin.buildStart)?.call(context as never, {} as never)

  return {
    fold: async (file: string, code: string) => {
      const result = await hookOf(compiler.transform)?.call(context as never, code, join(root, file), {} as never)
      return (typeof result === 'object' && result !== null ? result.code : result) ?? null
    },
    sheet: async () => {
      const loaded = await hookOf(css.load)?.call(context as never, '\0virtual:bamboo.css', {} as never)
      return (typeof loaded === 'object' && loaded !== null ? loaded.code : loaded) ?? ''
    },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

const APP = `import { css } from 'styled-system/css'
export const cls = css({ color: 'blue' })
`

describe('one context for the compiler and the stylesheet', () => {
  /**
   * `hash: 'auto'` is the sharpest observable there is: it salts every class name with `dev`,
   * which only `Builder.setup` is told. Two contexts meant two answers — the compiler folding
   * a name the sheet has no rule for — and the failure is silent, because each half is
   * internally consistent and they only disagree in the browser.
   */
  test('a dev-salted class the compiler folded has a rule in the sheet', async () => {
    const root = project({ 'src/app.tsx': APP }, `hash: 'auto',`)
    const { fold, sheet } = await run(root, 'serve')

    const folded = await fold('src/app.tsx', APP)
    const className = folded?.match(/"([^"\s]+)"/)?.[1]

    expect(className, 'the fold produced a class name').toBeTruthy()
    expect(await sheet()).toContain(`.${className}`)
  })

  /**
   * The compiler parses every module it folds, and those parses now run against the context
   * the sheet is emitted from. Sending them to the context's own encoder would put a rule in
   * the stylesheet for every `css()` call in the module graph, whether or not extraction
   * reaches it — a safelist nobody asked for, growing with the bundle. A module outside
   * `include` is the observable half: the compiler folds it, and the sheet must not gain it.
   */
  test('a module only the compiler read contributes no rule', async () => {
    const outside = `import { css } from 'styled-system/css'\nexport const cls = css({ color: 'rebeccapurple' })\n`
    const root = project({ 'src/app.tsx': APP, 'elsewhere/loose.tsx': outside })
    const { fold, sheet } = await run(root, 'build')

    // The `buildStart` sheet is consumed first, so what is asserted below is a pass that ran
    // after the fold — the only ordering in which a leaked contribution could show up.
    await sheet()
    expect(await fold('elsewhere/loose.tsx', outside)).toContain('rebeccapurple')

    const css = await sheet()
    expect(css, 'the included module is extracted').toContain('blue')
    expect(css, 'the compiler parses into its own encoder').not.toContain('rebeccapurple')
  })

  /**
   * The compiler folds the bundler's text; extraction reads the checkout. Writing the first
   * over the second in the project they share would make a `pre` plugin's rewrite decide what
   * CSS the next pass emits, for a file the user never edited.
   */
  test('a transform whose text differs from disk leaves the sheet on the checkout', async () => {
    const consumer = `import { css } from 'styled-system/css'
import { decoration } from './styles'
export const cls = css(decoration)
`
    const root = project({
      'src/app.tsx': consumer,
      'src/styles.ts': `export const decoration = { color: 'blue' }`,
    })
    const { fold, sheet } = await run(root, 'build')
    expect(await sheet()).toContain('blue')

    // What an earlier `pre` plugin handed the compiler for this module.
    await fold('src/app.tsx', `import { css } from 'styled-system/css'\nexport const cls = css({ color: 'olive' })\n`)

    // The consumer is re-extracted because its *dependency* moved, so nothing re-reads it from
    // disk. Whatever the project holds for `app.tsx` is what the next sheet is built from.
    const styles = join(root, 'src/styles.ts')
    writeFileSync(styles, `export const decoration = { color: 'teal' }`)
    const later = new Date(Date.now() + 10_000)
    utimesSync(styles, later, later)

    const css = await sheet()
    expect(css).toContain('teal')
    expect(css, 'the bundler never became the source of truth').not.toContain('olive')
  })
})
