import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@bamboocss/logger'
import { esc } from '@bamboocss/shared'
import bamboocss from '@bamboocss/vite'
import { build, createBuilder as createVite7Builder, createServer, type Plugin as VitePlugin, type Rollup } from 'vite'
import { createBuilder as createVite6Builder } from 'vite6'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { build as buildVite8, createBuilder, createServer as createVite8Server, type Plugin } from 'vite8'
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import { cascadeOrder } from '../../../packages/core/__tests__/cascade-oracle'

/**
 * The plugin driven by a real Vite build, rather than by calling its hooks directly.
 *
 * The fold engine is covered thoroughly on its own, but everything between it and Vite
 * was only asserted at the contract boundary: that `transform` is opt-in, that `apply`
 * is `build`, that the id filter rejects assets. None of that shows the plugin actually
 * loads a config, reaches the fold, and puts the result in the bundle — which is the
 * part a user experiences.
 */
const here = dirname(fileURLToPath(import.meta.url))
const cwd = join(here, '..')

/**
 * A path spelled the way Vite spells module ids, source map sources and watch files: with `/` on
 * every platform. `join` spells it with `\` on Windows, so a joined path compared with any of those
 * directly never matches there.
 */
const slash = (path: string) => path.replaceAll('\\', '/')

/** Whether a module id names this file: on Windows, a probe comparing them as spelled counts nothing. */
const isModule = (id: string | null | undefined, path: string) => id != null && slash(id.split('?')[0]) === slash(path)

/** Keep a watcher's extraction graph inside its own fixture instead of all scratch files. */
const writeIsolatedBambooConfig = (path: string, include: string[]) =>
  writeFileSync(
    path,
    `import base from './bamboo.config'\n` + `export default { ...base, include: ${JSON.stringify(include)} }\n`,
  )

/** Emit one filesystem change for watch tests instead of truncate-plus-write notifications. */
const writeWatchTrigger = (path: string, value: string) => {
  const body = value.trimEnd()
  if (Buffer.byteLength(body) > 63) throw new Error(`Watch trigger is too long: ${body}`)
  const contents = `${body.padEnd(63)}\n`
  if (existsSync(path) && readFileSync(path).byteLength === Buffer.byteLength(contents)) {
    writeFileSync(path, contents, { flag: 'r+' })
  } else writeFileSync(path, contents)
}

const readOutputFiles = (directory: string, extension: string) =>
  existsSync(directory)
    ? readdirSync(directory)
        .filter((file) => file.endsWith(extension))
        .sort()
        .map((file) => readFileSync(join(directory, file), 'utf8'))
        .join('\n')
    : ''

describe('vite plugin, real build', () => {
  test('shares recipe and utility atoms through a real build', async () => {
    const entry = join(cwd, 'src/__static-composition-test.tsx')
    writeFileSync(
      entry,
      `
        import 'virtual:bamboo.css'
        import { css, cva, cx, viewTransition } from '../styled-system/css'
        const box = cva({
          base: { width: '[123.4567px]', color: 'red600' },
          variants: {
            state: {
              selected: { height: '[234.5678px]' },
              unreachable: { height: '[345.6789px]' },
            },
          },
        })
        export const className = cx(box({ state: 'selected' }), css({ width: '[123.4567px]', color: 'blue600' }))
        const dynamicBadge = cva({
          base: { minWidth: '[456.789px]' },
          variants: {
            tone: {
              compact: { maxWidth: '[567.891px]' },
              expanded: { maxWidth: '[678.912px]' },
            },
          },
          defaultVariants: { tone: 'compact' },
          compoundVariants: [{ tone: 'expanded', css: { opacity: 0.75 } }],
        })
        export const dynamicClassName = (tone) => dynamicBadge({ tone })
        export const transitionClassName = viewTransition({ old: { opacity: 0.314159 } })
      `,
    )

    try {
      const result = (await build({
        root: cwd,
        logLevel: 'silent',
        // The sandbox's PostCSS config targets its browser entry URL; this library-mode
        // fixture exercises Vite's CSS asset graph directly and needs no additional plugins.
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, reportSummary: false })],
        build: {
          write: false,
          minify: false,
          lib: { entry, formats: ['es'], fileName: 'static-composition' },
          rollupOptions: { external: [/^react/] },
        },
      })) as Rollup.RollupOutput[]

      const css = result[0]!.output
        .map((output) => ('source' in output && typeof output.source === 'string' ? output.source : ''))
        .join('\n')
      const js = result[0]!.output.map((output) => ('code' in output ? output.code : '')).join('\n')

      expect(js).toMatch(/"[\w[]\S*_\S+ \S+_\S+/)
      expect(js).toContain('w_[123.4567px]')
      expect(js).toContain('c_blue600')
      expect(js).toContain('h_[234.5678px]')
      expect(js).not.toContain('red600')
      expect(js).not.toContain('createCss')
      expect(js).not.toContain('viewTransition(')
      expect(js).toContain('cvaMap')
      expect(css).toMatch(/\.\S+_\S+\s*\{/)
      expect(css).toContain('123.4567px')
      expect(css.match(/width:\s*123\.4567px/g)).toHaveLength(1)
      expect(css).toMatch(/height:\s*234\.5678px/)
      expect(css).not.toContain('345.6789px')
      expect(css).toMatch(/min-width:\s*456\.789px/)
      expect(css).toMatch(/max-width:\s*567\.891px/)
      expect(css).toMatch(/max-width:\s*678\.912px/)
      expect(css).toMatch(/opacity:\s*0\.75/)
      expect(css).toMatch(/opacity:\s*0\.314159/)
      expect(css).not.toMatch(/@layer recipes\{/)

      // Execute the emitted decision table, then verify every runtime class has a retained
      // selector. This catches drift between the generated helper, the fold's table format,
      // reachability pruning, and final compact-name rewriting in one assertion chain.
      const built = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)) as {
        dynamicClassName: (tone: unknown) => string
        transitionClassName: string
      }
      const defaultClass = built.dynamicClassName(undefined)
      const compactClass = built.dynamicClassName('compact')
      const expandedClass = built.dynamicClassName('expanded')
      const missingClass = built.dynamicClassName('unknown')
      expect(defaultClass).toBe(compactClass)
      expect(expandedClass).not.toBe(compactClass)
      expect(built.dynamicClassName(null)).toBe(missingClass)
      for (const className of [defaultClass, expandedClass, missingClass]) {
        for (const token of className.split(' ')) expect(css).toContain(`.${esc(token)} {`)
      }
      expect(css).toContain(`.${esc(built.transitionClassName)} {`)
      expect(css).toContain(`view-transition-class: ${built.transitionClassName}`)
      expect(css).toContain(`::view-transition-old(.${esc(built.transitionClassName)})`)
    } finally {
      rmSync(entry, { force: true })
    }
  }, 60_000)

  test('static composition proves the CSS and Vite source graphs agree', async () => {
    const outside = join(cwd, '__static-composition-outside.ts')
    writeFileSync(
      outside,
      `
        import 'virtual:bamboo.css'
        import { css } from './styled-system/css'
        export const className = css({ width: '[987.654px]' })
      `,
    )

    try {
      await expect(
        build({
          root: cwd,
          logLevel: 'silent',
          css: { postcss: { plugins: [] } },
          plugins: [bamboocss({ cwd, reportSummary: false })],
          build: {
            write: false,
            minify: false,
            lib: { entry: outside, formats: ['es'], fileName: 'outside' },
            rollupOptions: { external: [/^react/] },
          },
        }),
      ).rejects.toThrow('outside the CSS extraction graph')
    } finally {
      rmSync(outside, { force: true })
    }
  }, 60_000)

  test('static composition requires its virtual stylesheet to be imported', async () => {
    const entry = join(cwd, 'src/__static-composition-no-css.ts')
    writeFileSync(
      entry,
      `import { css } from '../styled-system/css'\nexport const className = css({ width: '[876.543px]' })\n`,
    )

    try {
      await expect(
        build({
          root: cwd,
          logLevel: 'silent',
          plugins: [bamboocss({ cwd, reportSummary: false })],
          build: {
            write: false,
            minify: false,
            lib: { entry, formats: ['es'], fileName: 'no-css' },
            rollupOptions: { external: [/^react/] },
          },
        }),
      ).rejects.toThrow('was not imported')
    } finally {
      rmSync(entry, { force: true })
    }
  }, 60_000)

  test('CSS asset identity follows late reachability pruning', async () => {
    const entry = join(cwd, 'src/__static-composition-asset-hash.tsx')
    const writeEntry = (tone: 'a' | 'b') =>
      writeFileSync(
        entry,
        `
          import 'virtual:bamboo.css'
          import { cva } from '../styled-system/css'
          const badge = cva({ variants: { tone: {
            a: { width: '[731.111px]' },
            b: { width: '[731.222px]' },
          } } })
          export const className = badge({ tone: '${tone}' })
        `,
      )

    const run = async () => {
      const result = (await build({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, reportSummary: false })],
        build: {
          write: false,
          minify: false,
          lib: { entry, formats: ['es'], fileName: 'asset-hash' },
          rollupOptions: {
            external: [/^react/],
            output: { assetFileNames: 'assets/[name]-[hash][extname]' },
          },
        },
      })) as Rollup.RollupOutput[]
      const asset = result[0]!.output.find((output) => output.type === 'asset' && output.fileName.endsWith('.css'))
      if (!asset) throw new Error('expected a CSS asset')
      return { fileName: asset.fileName, source: String(asset.source) }
    }

    try {
      writeEntry('a')
      const a = await run()
      writeEntry('b')
      const b = await run()

      expect(a.source).toContain('731.111px')
      expect(a.source).not.toContain('731.222px')
      expect(b.source).toContain('731.222px')
      expect(b.source).not.toContain('731.111px')
      expect(a.fileName).not.toBe(b.fileName)
    } finally {
      rmSync(entry, { force: true })
    }
  }, 60_000)

  /**
   * `pruneCss: false` is the whole of the opt-out, and it opts out of both halves.
   *
   * The rename is not separately declinable, because pruned bytes under the unpruned sheet's
   * name is the one combination that ships a stylesheet a CDN will serve stale. So the sheet
   * keeps every rule the source graph produced *and* the name Vite gave it — which is what a
   * downstream consumer computing integrity hashes or a precache manifest from the asset
   * needs, since both are invalidated by a late edit rather than by a late rename.
   */
  test('pruneCss: false ships the whole sheet under Vite’s own name', async () => {
    const entry = join(cwd, 'src/__static-composition-unpruned.tsx')
    writeFileSync(
      entry,
      `
        import 'virtual:bamboo.css'
        import { cva } from '../styled-system/css'
        const badge = cva({ variants: { tone: {
          a: { width: '[733.111px]' },
          b: { width: '[733.222px]' },
        } } })
        export const className = badge({ tone: 'a' })
      `,
    )

    const run = async (pruneCss: boolean) => {
      const result = (await build({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, reportSummary: false, pruneCss })],
        build: {
          write: false,
          minify: false,
          lib: { entry, formats: ['es'], fileName: 'static-composition-unpruned' },
          rollupOptions: {
            external: [/^react/],
            output: { assetFileNames: 'assets/[name]-[hash][extname]' },
          },
        },
      })) as Rollup.RollupOutput[]
      const asset = result[0]!.output.find((output) => output.type === 'asset' && output.fileName.endsWith('.css'))
      if (!asset) throw new Error('expected a CSS asset')
      return { fileName: asset.fileName, source: String(asset.source) }
    }

    try {
      const pruned = await run(true)
      const whole = await run(false)

      // The selected variant is in both; only the unselected one distinguishes them.
      expect(pruned.source).toContain('733.111px')
      expect(pruned.source, 'the variant nothing selects').not.toContain('733.222px')
      expect(whole.source).toContain('733.111px')
      expect(whole.source, 'nothing is removed when pruning is off').toContain('733.222px')

      // Both halves declined together. Asserted as "the pruned name is the unpruned one plus a
      // segment" rather than merely "no `.b-` segment": the two runs feed identical pre-prune
      // CSS to the same Rollup, so Vite's own name is identical across them, and stripping the
      // segment has to land back on it. The weaker form would still pass if the unpruned run
      // had emitted some entirely different asset.
      expect(pruned.fileName).toMatch(/\.b-[^.]+\.css$/)
      expect(pruned.fileName.replace(/\.b-[^.]+\.css$/, '.css'), 'the rename goes with the prune').toBe(whole.fileName)
    } finally {
      rmSync(entry, { force: true })
    }
  }, 60_000)

  /**
   * A `.tsx` the entry also imports as `?raw` must not corrupt the real module.
   *
   * The query has to be stripped before the extension is tested, or nothing matches `.tsx` —
   * and stripping it made `./dep.tsx?raw`, whose text is `export default "…"`, look like the
   * file itself. The transform handed that wrapper to ts-morph under the real file's path, so
   * the next module to fold against that file read the wrapper and found none of its exports.
   *
   * It presented as a build failure blaming source that was already static: "1 call(s) could
   * not be compiled … make the values finite and statically analyzable". And it depended on
   * which of the two ids Rollup transformed last, so moving an import could start it.
   *
   * A consumer is imported on each side of the `?raw` line. Only a consumer folded *after* the
   * wrapper lands is exposed, and which that is depends on the order Rollup happens to
   * transform in — so with one on each side the test cannot quietly stop covering the bug if
   * that order changes, which Rolldown is the likeliest thing to do.
   */
  test('a ?raw import of a .tsx does not corrupt folding against that module', async () => {
    const dep = join(cwd, 'src/__static-composition-raw-dep.tsx')
    const before = join(cwd, 'src/__static-composition-raw-before.tsx')
    const after = join(cwd, 'src/__static-composition-raw-after.tsx')
    const entry = join(cwd, 'src/__static-composition-raw.tsx')

    writeFileSync(dep, `export const shared = { width: '[58.8px]' }\n`)
    const consumer = (height: string) =>
      `import { css } from '../styled-system/css'\n` +
      `import { shared } from './__static-composition-raw-dep'\n` +
      `export const cls = css({ ...shared, height: '[${height}]' })\n`
    writeFileSync(before, consumer('58.1px'))
    writeFileSync(after, consumer('58.2px'))
    writeFileSync(
      entry,
      `import 'virtual:bamboo.css'\n` +
        `import { cls as one } from './__static-composition-raw-before'\n` +
        `import text from './__static-composition-raw-dep.tsx?raw'\n` +
        `import { cls as two } from './__static-composition-raw-after'\n` +
        `export const a = [one, text, two]\n`,
    )

    try {
      const result = (await build({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, reportSummary: false })],
        build: {
          write: false,
          minify: false,
          lib: { entry, formats: ['es'], fileName: 'static-composition-raw' },
          rollupOptions: { external: [/^react/] },
        },
      })) as Rollup.RollupOutput[]

      const css = result[0]!.output
        .map((output) => ('source' in output && typeof output.source === 'string' ? output.source : ''))
        .join('\n')
      const js = result[0]!.output.map((output) => ('code' in output ? output.code : '')).join('\n')

      // Both cross-file folds resolved `shared` from the real module, whichever order they ran
      // in relative to the wrapper, and both atoms have rules.
      expect(js, 'the class folded before the ?raw import').toContain('h_[58.1px]')
      expect(js, 'the class folded after the ?raw import').toContain('h_[58.2px]')
      expect(js, 'the property they share, read from the real module').toContain('w_[58.8px]')
      expect(css).toContain('58.1px')
      expect(css).toContain('58.2px')
      expect(css).toContain('58.8px')
      // The `?raw` module still carries the file as text, which is what it is for.
      expect(js).toContain('export const shared')
    } finally {
      for (const file of [dep, before, after, entry]) rmSync(file, { force: true })
    }
  }, 60_000)

  test('late CSS asset naming updates HTML and manifest references', async () => {
    const html = join(cwd, '__static-composition-index.html')
    const entry = join(cwd, 'src/__static-composition-html.tsx')
    writeFileSync(html, `<script type="module" src="/src/__static-composition-html.tsx"></script>`)
    writeFileSync(
      entry,
      `import 'virtual:bamboo.css'\nimport { css } from '../styled-system/css'\ndocument.body.className = css({ width: '[741.333px]' })\n`,
    )

    try {
      const result = (await build({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, reportSummary: false })],
        build: {
          write: false,
          manifest: true,
          minify: false,
          cssCodeSplit: false,
          rollupOptions: {
            input: html,
            output: { assetFileNames: 'assets/[name]-[hash][extname]' },
          },
        },
      })) as Rollup.RollupOutput

      const css = result.output.find((output) => output.type === 'asset' && output.fileName.endsWith('.css'))
      const builtHtml = result.output.find((output) => output.type === 'asset' && output.fileName.endsWith('.html'))
      const manifest = result.output.find(
        (output) => output.type === 'asset' && output.fileName.endsWith('manifest.json'),
      )
      if (!css || !builtHtml || !manifest) throw new Error('expected CSS, HTML, and manifest assets')

      expect(css.fileName).toMatch(/\.b-[A-Za-z]+\.css$/)
      expect(String(builtHtml.source)).toContain(css.fileName)
      expect(String(manifest.source)).toContain(css.fileName)
    } finally {
      rmSync(html, { force: true })
      rmSync(entry, { force: true })
    }
  }, 60_000)

  test('late CSS references retain chunk sourcemaps', async () => {
    const html = join(cwd, '__static-composition-sourcemap.html')
    const entry = join(cwd, 'src/__static-composition-sourcemap.tsx')
    const lazy = join(cwd, 'src/__static-composition-sourcemap-lazy.tsx')
    writeFileSync(html, `<script type="module" src="/src/__static-composition-sourcemap.tsx"></script>`)
    writeFileSync(
      entry,
      `export const loadBambooStyles = () => import('./__static-composition-sourcemap-lazy')\ndocument.body.onclick = loadBambooStyles\n`,
    )
    writeFileSync(
      lazy,
      `import 'virtual:bamboo.css'\nimport { css } from '../styled-system/css'\nexport const className = css({ width: '[751.444px]' })\n`,
    )

    try {
      const result = (await build({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, reportSummary: false })],
        build: {
          write: false,
          sourcemap: true,
          minify: false,
          rollupOptions: { input: html },
        },
      })) as Rollup.RollupOutput

      const css = result.output.find((output) => output.type === 'asset' && output.fileName.endsWith('.css'))
      const chunk = result.output.find((output) => output.type === 'chunk' && output.isEntry)
      if (!css || !chunk) throw new Error('expected CSS and entry chunk')
      expect(chunk.code).toContain(css.fileName)

      const mapAsset = result.output.find(
        (output) => output.type === 'asset' && output.fileName === `${chunk.fileName}.map`,
      )
      if (!mapAsset) throw new Error('expected an entry sourcemap')

      // Reuse the Vite package's test-only decoder without making this runtime sandbox ship
      // a sourcemap library of its own.
      const { originalPositionFor, TraceMap } = await import(
        join(here, '../../../packages/vite/node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs')
      )

      const marker = 'loadBambooStyles'
      const offset = chunk.code.lastIndexOf(marker)
      expect(offset).toBeGreaterThan(-1)
      const before = chunk.code.slice(0, offset).split('\n')
      const original = originalPositionFor(new TraceMap(String(mapAsset.source)), {
        line: before.length,
        column: before.at(-1)!.length,
      })
      expect(original.source).toContain('__static-composition-sourcemap.tsx')
      expect(original.line).toBe(2)
    } finally {
      rmSync(html, { force: true })
      rmSync(entry, { force: true })
      rmSync(lazy, { force: true })
    }
  }, 60_000)
})

/**
 * A rebuild, driven by Vite's own watcher.
 *
 * The plugin refreshes a changed module in `watchChange`, which only works if the bundler
 * calls that hook before the rebuild reads anything. That ordering is Vite's to keep, not
 * bamboo's, and calling the hook by hand — which is what the unit tests in
 * `packages/vite` do — asserts the effect of the refresh while assuming the schedule.
 * This is the assumption, run.
 */
describe.sequential('vite plugin, real rebuild', () => {
  const fixtureDir = join(cwd, 'src/__watch-tmp')
  const configPath = join(cwd, '__watch-tmp.bamboo.config.ts')
  const dependency = join(fixtureDir, 'dep.ts')
  const entry = join(fixtureDir, 'entry.tsx')
  const outDir = join(fixtureDir, 'out')

  const writeDependency = (color: string) => writeFileSync(dependency, `export const shared = { color: '${color}' }\n`)

  beforeEach(() => writeIsolatedBambooConfig(configPath, ['./src/__watch-tmp/**/*.{tsx,jsx}']))

  afterEach(() => {
    rmSync(fixtureDir, { force: true, recursive: true })
    rmSync(configPath, { force: true })
  })

  test('an imported local dependency outside include rebuilds JavaScript and CSS', async () => {
    mkdirSync(fixtureDir, { recursive: true })
    writeDependency('blue600')
    writeFileSync(
      entry,
      `import 'virtual:bamboo.css'\nimport { css } from '../../styled-system/css'\nimport { shared } from './dep'\nexport const cls = css(shared)\n`,
    )

    const watchedRuns: string[][] = []
    const watcher = (await build({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [
        bamboocss({ cwd, configPath, reportSummary: false }),
        {
          name: 'bamboocss:test-watch-closure',
          buildEnd() {
            watchedRuns.push(this.getWatchFiles())
          },
        },
      ],
      build: {
        watch: {},
        minify: false,
        outDir,
        emptyOutDir: false,
        lib: { entry, formats: ['es'], fileName: 'entry' },
        rollupOptions: { external: [/styled-system/] },
      },
    })) as Rollup.RollupWatcher

    /** Resolves on the next completed build, so an edit can be awaited rather than slept on. */
    const nextBuild = () =>
      new Promise<void>((resolve, reject) => {
        const onEvent = (event: { code: string; error?: Error }) => {
          if (event.code === 'END') {
            watcher.off('event', onEvent)
            resolve()
          } else if (event.code === 'ERROR') {
            watcher.off('event', onEvent)
            reject(event.error)
          }
        }
        watcher.on('event', onEvent)
      })

    // Whatever the build wrote, rather than a name derived from the format and the
    // package's `type` — the assertion is about the contents, not about Vite's naming.
    const output = (...extensions: string[]) =>
      readdirSync(outDir)
        .filter((file) => extensions.some((extension) => file.endsWith(extension)))
        .map((file) => readFileSync(join(outDir, file), 'utf8'))
        .join('\n')

    try {
      await nextBuild()
      expect(output('.js', '.mjs')).toContain('"c_blue600"')
      expect(output('.css')).toContain('blue600')
      expect(watchedRuns.at(-1)?.map(slash)).toContain(slash(dependency))

      const rebuilt = nextBuild()
      // Edited a beat after the first build rather than immediately. The watcher arms
      // itself once that build settles, and a write landing before then is either missed
      // or folded into the same debounce window — which reads as "the rebuild never
      // happened" rather than as a race. Waiting longer only makes this more reliable.
      await new Promise((settle) => setTimeout(settle, 800))
      writeDependency('red600')
      await rebuilt

      // The assertion the whole hook exists for. Without the refresh this is still
      // `c_blue600` — and stays that way for the life of the watch session.
      expect(output('.js', '.mjs')).toContain('"c_red600"')
      expect(output('.js', '.mjs')).not.toContain('"c_blue600"')
      expect(output('.css')).toContain('red600')
      expect(output('.css')).not.toContain('blue600')
      expect(watchedRuns.at(-1)?.map(slash)).toContain(slash(dependency))
    } finally {
      await watcher.close()
    }
  }, 120_000)

  test('a cached transform replays the reachability used to prune the rebuilt stylesheet', async () => {
    const cachedDependency = join(fixtureDir, 'cached-dep.tsx')
    const styleDependency = join(fixtureDir, 'cached-style.tsx')
    const cachedEntry = join(fixtureDir, 'cached-entry.tsx')
    const rebuildEntry = join(fixtureDir, 'rebuild-entry.tsx')
    const width = '719.314px'
    const transformCalls: string[] = []
    const summaries: string[] = []
    const info = vi.spyOn(logger, 'info').mockImplementation((type, message) => {
      if (type === 'vite:transform') summaries.push(message)
    })
    const config = (watch: boolean) => ({
      root: cwd,
      logLevel: 'silent' as const,
      css: { postcss: { plugins: [] } },
      plugins: [
        bamboocss({ cwd, configPath }),
        {
          name: 'bamboocss:test-cached-transform-probe',
          transform(_code: string, id: string) {
            if (isModule(id, cachedEntry)) transformCalls.push(id)
          },
        },
      ],
      build: {
        ...(watch ? { watch: {} } : { write: false }),
        minify: false,
        outDir,
        emptyOutDir: false,
        lib: {
          entry: { cached: cachedEntry, rebuild: rebuildEntry },
          formats: ['es'] as const,
          fileName: (_format: string, name: string) => `${name}.js`,
        },
        rollupOptions: { external: [/styled-system/] },
      },
    })

    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(cachedDependency, `export const version = 'first'\n`)
    writeFileSync(styleDependency, `export const shared = { width: '[${width}]' }\n`)
    writeFileSync(
      cachedEntry,
      `import 'virtual:bamboo.css'\nimport { css, cx } from '../../styled-system/css'\nimport { shared } from './cached-style'\nexport const cls = (external) => cx(external, css(shared))\n`,
    )
    writeFileSync(rebuildEntry, `export { version } from './cached-dep'\n`)

    let watcher: Rollup.RollupWatcher | undefined
    const nextBuild = () =>
      new Promise<void>((resolve, reject) => {
        const active = watcher
        if (!active) throw new Error('watcher has not started')
        const onEvent = (event: { code: string; error?: Error }) => {
          if (event.code === 'END') {
            active.off('event', onEvent)
            resolve()
          } else if (event.code === 'ERROR') {
            active.off('event', onEvent)
            reject(event.error)
          }
        }
        active.on('event', onEvent)
      })
    const writtenCss = () =>
      readdirSync(outDir)
        .filter((file) => file.endsWith('.css'))
        .map((file) => readFileSync(join(outDir, file), 'utf8'))
        .join('\n')

    try {
      watcher = (await build(config(true))) as Rollup.RollupWatcher
      await nextBuild()
      expect(transformCalls).toHaveLength(1)
      const cleanCss = writtenCss()
      expect(cleanCss).toContain(width)

      // Remove the first build's hashed asset so only the rebuild's stylesheet can satisfy
      // the assertion below. Vite excludes its own outDir from the watcher.
      rmSync(outDir, { force: true, recursive: true })
      const rebuilt = nextBuild()
      await new Promise((settle) => setTimeout(settle, 800))
      writeFileSync(cachedDependency, `export const version = 'second'\n`)
      await rebuilt

      // Rollup reused Bamboo's transform result for the unchanged entry. The probe is after
      // Bamboo in the same transform pipeline, so it is cached or rerun with it.
      expect(transformCalls, 'the entry took Rollup’s cached transform path').toHaveLength(1)
      const cachedCss = writtenCss()
      expect(summaries).toHaveLength(2)
      // `cx(external, css(shared))` joins a class the build cannot read with one it compiled,
      // which is reported apart from a plain dynamic skip so the warning can name it. What
      // this test is about is the line below: the cached rebuild has to reach the same verdict.
      expect(summaries[0]).toContain('declined: opaque-composition=1')
      expect(summaries[1], 'cached coverage and diagnostics must match the clean build').toBe(summaries[0])

      expect(cachedCss).toContain(width)
      expect(cachedCss, 'a cached rebuild must match the first, cache-free build').toBe(cleanCss)
    } finally {
      await watcher?.close()
      info.mockRestore()
    }
  }, 120_000)

  test('fails closed when cached Bamboo metadata uses a stale schema', async () => {
    const staleEntry = join(fixtureDir, 'stale-meta-entry.tsx')
    const trigger = join(fixtureDir, 'stale-meta-trigger.tsx')
    const staleOutDir = join(fixtureDir, 'stale-meta-out')
    const width = '729.414px'
    let transformCalls = 0

    // Runs after Bamboo and deliberately replaces only its serialized cache boundary. The
    // first build still uses Bamboo's in-memory contribution and emits valid JS/CSS; Rollup
    // then retains this stale schema alongside those compiled JS bytes for the rebuild.
    const staleMetadata: VitePlugin = {
      name: 'bamboocss:test-stale-transform-metadata',
      transform(_code, id) {
        if (!isModule(id, staleEntry)) return
        transformCalls++
        return { meta: { 'bamboocss:transform': { version: 1 } } }
      },
    }

    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      staleEntry,
      `import 'virtual:bamboo.css'\n` +
        `import { css } from '../../styled-system/css'\n` +
        `export const className = css({ width: '[${width}]' })\n`,
    )
    writeFileSync(trigger, `export const version = 'first'\n`)

    let watcher: Rollup.RollupWatcher | undefined
    const nextBuild = () =>
      new Promise<Error | undefined>((resolve) => {
        const active = watcher
        if (!active) throw new Error('watcher has not started')
        const onEvent = (event: { code: string; error?: Error }) => {
          if (event.code !== 'END' && event.code !== 'ERROR') return
          active.off('event', onEvent)
          resolve(event.code === 'ERROR' ? event.error : undefined)
        }
        active.on('event', onEvent)
      })
    const written = (extension: string) =>
      readdirSync(staleOutDir)
        .filter((file) => file.endsWith(extension))
        .map((file) => readFileSync(join(staleOutDir, file), 'utf8'))
        .join('\n')

    try {
      watcher = (await build({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, configPath, reportSummary: false }), staleMetadata],
        build: {
          watch: {},
          minify: false,
          outDir: staleOutDir,
          emptyOutDir: false,
          lib: {
            entry: { cached: staleEntry, rebuild: trigger },
            formats: ['es'],
            fileName: (_format, name) => `${name}.js`,
          },
          rollupOptions: { external: [/styled-system/] },
        },
      })) as Rollup.RollupWatcher

      expect(await nextBuild()).toBeUndefined()
      expect(transformCalls).toBe(1)
      expect(written('.js')).toContain(width)
      expect(written('.js')).not.toContain('css(')
      expect(written('.css')).toContain(width)

      rmSync(staleOutDir, { force: true, recursive: true })
      const rebuilt = nextBuild()
      await new Promise((settle) => setTimeout(settle, 800))
      writeFileSync(trigger, `export const version = 'second'\n`)
      const error = await rebuilt

      expect(transformCalls, 'the Bamboo-compiled entry took Rollup’s cached transform path').toBe(1)
      expect(error?.message).toContain('cached transform metadata')
      expect(error?.message).toContain(JSON.stringify(slash(staleEntry)))
      expect(error?.message).toContain('version 1; expected schema version 5')
      expect(error?.message).toContain('cached JavaScript may still name CSS classes whose rules would be dropped')
      expect(error?.message).toContain('Restart Vite to invalidate its in-memory transform cache')
    } finally {
      await watcher?.close()
    }
  }, 120_000)

  test('fails closed when a current-schema cached artifact fails integrity', async () => {
    const integrityEntry = join(fixtureDir, 'integrity-meta-entry.tsx')
    const trigger = join(fixtureDir, 'integrity-meta-trigger.tsx')
    const integrityOutDir = join(fixtureDir, 'integrity-meta-out')
    const width = '739.515px'
    let transformCalls = 0
    let compiledCode = ''

    // Read Bamboo's current artifact after its pre transform, then mutate one nested semantic
    // field without access to the instance-private key that sealed it. The first build uses
    // Bamboo's already-applied private collections; Rollup caches the altered metadata for replay.
    const alteredMetadata: VitePlugin = {
      name: 'bamboocss:test-altered-transform-metadata',
      transform(code, id) {
        if (!isModule(id, integrityEntry)) return
        transformCalls++
        compiledCode = code

        const artifact = this.getModuleInfo(id)?.meta['bamboocss:transform']
        if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
          throw new Error('test fixture could not observe Bamboo transform metadata')
        }
        expect(artifact).toMatchObject({
          version: 5,
          classNames: [`w_[${width}]`],
          integrity: expect.any(String),
        })
        const integrity = artifact.integrity
        const classNames = artifact.classNames
        if (!Array.isArray(classNames)) throw new Error('test fixture found malformed class metadata')
        // Well-typed and current-schema, but no longer describes the compiled JS above. Mutating
        // in place proves the public metadata does not share its array with trusted fresh state.
        classNames.length = 0
        expect(artifact.integrity).toBe(integrity)
        return {
          code,
          map: null,
          meta: {
            'bamboocss:transform': artifact,
          },
        }
      },
    }

    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      integrityEntry,
      `import 'virtual:bamboo.css'\n` +
        `import { css } from '../../styled-system/css'\n` +
        `export const className = css({ width: '[${width}]' })\n`,
    )
    writeFileSync(trigger, `export const version = 'first'\n`)

    let watcher: Rollup.RollupWatcher | undefined
    const nextBuild = () =>
      new Promise<Error | undefined>((resolve) => {
        const active = watcher
        if (!active) throw new Error('watcher has not started')
        const onEvent = (event: { code: string; error?: Error }) => {
          if (event.code !== 'END' && event.code !== 'ERROR') return
          active.off('event', onEvent)
          resolve(event.code === 'ERROR' ? event.error : undefined)
        }
        active.on('event', onEvent)
      })
    const written = (extension: string) =>
      readdirSync(integrityOutDir)
        .filter((file) => file.endsWith(extension))
        .map((file) => readFileSync(join(integrityOutDir, file), 'utf8'))
        .join('\n')

    try {
      watcher = (await build({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, configPath, reportSummary: false }), alteredMetadata],
        build: {
          watch: {},
          minify: false,
          outDir: integrityOutDir,
          emptyOutDir: false,
          lib: {
            entry: { cached: integrityEntry, rebuild: trigger },
            formats: ['es'],
            fileName: (_format, name) => `${name}.js`,
          },
          rollupOptions: { external: [/styled-system/] },
        },
      })) as Rollup.RollupWatcher

      expect(await nextBuild()).toBeUndefined()
      expect(transformCalls).toBe(1)
      expect(compiledCode).toContain(`w_[${width}]`)
      expect(compiledCode).not.toContain('css(')
      expect(written('.js')).toContain(width)
      expect(written('.css')).toContain(width)

      rmSync(integrityOutDir, { force: true, recursive: true })
      const rebuilt = nextBuild()
      await new Promise((settle) => setTimeout(settle, 800))
      writeFileSync(trigger, `export const version = 'second'\n`)
      const error = await rebuilt

      expect(transformCalls, 'the altered Bamboo entry took Rollup’s cached transform path').toBe(1)
      expect(error?.message).toContain('cached transform metadata')
      expect(error?.message).toContain(JSON.stringify(slash(integrityEntry)))
      expect(error?.message).toContain('schema version 5 integrity check')
      expect(error?.message).toContain('cached JavaScript may still name CSS classes whose rules would be dropped')
      expect(error?.message).toContain('Restart Vite to invalidate its in-memory transform cache')
    } finally {
      await watcher?.close()
    }
  }, 120_000)

  test('snapshots accessor-backed cached metadata before validation and replay', async () => {
    const accessorEntry = join(fixtureDir, 'accessor-meta-entry.tsx')
    const trigger = join(fixtureDir, 'accessor-meta-trigger.tsx')
    const accessorOutDir = join(fixtureDir, 'accessor-meta-out')
    const width = '749.616px'
    let transformCalls = 0
    let buildStarts = 0
    let integrityReads = 0
    let alteredClassReads = 0
    let accessorArtifact: Record<string, unknown> | undefined

    // This is the exact old TOCTOU: schema validation reads `integrity` once and sees the
    // signed classes; HMAC verification reads the signed classes and then `integrity` again;
    // the subsequent state copy asks for classes a third time and receives an empty list.
    // Snapshot-first replay asks the external record only once and validates that detached data.
    const accessorMetadata: VitePlugin = {
      name: 'bamboocss:test-accessor-transform-metadata',
      buildStart() {
        buildStarts++
        if (buildStarts > 1) {
          integrityReads = 0
          alteredClassReads = 0
        }
      },
      transform(code, id) {
        if (!isModule(id, accessorEntry)) return
        transformCalls++

        const artifact = this.getModuleInfo(id)?.meta['bamboocss:transform']
        if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
          throw new Error('test fixture could not observe Bamboo transform metadata')
        }
        expect(artifact).toMatchObject({
          version: 5,
          classNames: [`w_[${width}]`],
          integrity: expect.any(String),
        })
        const signedClassNames = artifact.classNames
        const signedIntegrity = artifact.integrity
        accessorArtifact = { ...artifact }
        Object.defineProperties(accessorArtifact, {
          classNames: {
            enumerable: true,
            get() {
              if (integrityReads < 2) return signedClassNames
              alteredClassReads++
              return []
            },
          },
          integrity: {
            enumerable: true,
            get() {
              integrityReads++
              return signedIntegrity
            },
          },
        })
        return { code, map: null, meta: { 'bamboocss:transform': accessorArtifact } }
      },
    }

    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      accessorEntry,
      `import 'virtual:bamboo.css'\n` +
        `import { css } from '../../styled-system/css'\n` +
        `export const className = css({ width: '[${width}]' })\n`,
    )
    writeFileSync(trigger, `export const version = 'first'\n`)

    let watcher: Rollup.RollupWatcher | undefined
    const nextBuild = () =>
      new Promise<Error | undefined>((resolve) => {
        const active = watcher
        if (!active) throw new Error('watcher has not started')
        const onEvent = (event: { code: string; error?: Error }) => {
          if (event.code !== 'END' && event.code !== 'ERROR') return
          active.off('event', onEvent)
          resolve(event.code === 'ERROR' ? event.error : undefined)
        }
        active.on('event', onEvent)
      })
    const written = (extension: string) =>
      readdirSync(accessorOutDir)
        .filter((file) => file.endsWith(extension))
        .map((file) => readFileSync(join(accessorOutDir, file), 'utf8'))
        .join('\n')

    try {
      watcher = (await build({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, configPath, reportSummary: false }), accessorMetadata],
        build: {
          watch: {},
          minify: false,
          outDir: accessorOutDir,
          emptyOutDir: false,
          lib: {
            entry: { cached: accessorEntry, rebuild: trigger },
            formats: ['es'],
            fileName: (_format, name) => `${name}.js`,
          },
          rollupOptions: { external: [/styled-system/] },
        },
      })) as Rollup.RollupWatcher

      expect(await nextBuild()).toBeUndefined()
      expect(transformCalls).toBe(1)
      const cleanCss = written('.css')
      expect(cleanCss).toContain(width)

      rmSync(accessorOutDir, { force: true, recursive: true })
      const rebuilt = nextBuild()
      await new Promise((settle) => setTimeout(settle, 800))
      writeFileSync(trigger, `export const version = 'second'\n`)

      expect(await rebuilt).toBeUndefined()
      expect(transformCalls, 'the accessor-backed Bamboo entry took Rollup’s cached transform path').toBe(1)
      expect(alteredClassReads, 'replay never read altered reachability from the external object').toBe(0)
      expect(written('.js')).toContain(width)
      expect(written('.css')).toBe(cleanCss)

      // Arm the accessor after replay to prove it really does return the altered value once the
      // integrity read boundary has passed. The detached contribution must remain unaffected.
      while (integrityReads < 2) void accessorArtifact!.integrity
      expect(accessorArtifact!.classNames).toEqual([])
      expect(alteredClassReads).toBe(1)
      expect(written('.css')).toContain(width)
    } finally {
      await watcher?.close()
    }
  }, 120_000)

  test('replays a cached query variant when a sibling module id retransforms', async () => {
    const dual = join(fixtureDir, 'dual.tsx')
    const trigger = join(fixtureDir, 'query-trigger.tsx')
    const queryEntry = join(fixtureDir, 'query-entry.tsx')
    const queryOutDir = join(fixtureDir, 'query-out')
    const widths = { a: '829.141px', b: '829.282px' }
    const transformCalls = { a: 0, b: 0 }

    const queryVariants: VitePlugin = {
      name: 'bamboocss:test-query-variants',
      enforce: 'pre',
      transform(_code, id) {
        const query = id.split('?')[1]
        if (!isModule(id, dual) || (query !== 'a' && query !== 'b')) return

        transformCalls[query]++
        // Only `?a` depends on this file. Its edit must rerun that live module id while
        // Rollup keeps `?b` on the transform-cache path.
        if (query === 'a') this.addWatchFile(trigger)

        return {
          code:
            `import { css } from '../../styled-system/css'\n` +
            `export const className = css({ width: '[${widths[query]}]' })\n`,
          map: null,
        }
      },
    }

    mkdirSync(fixtureDir, { recursive: true })
    // The extractor reads the physical source, so both query-specific classes have real rules
    // before the bundler plugin selects one call for each live module id.
    writeFileSync(
      dual,
      `import { css } from '../../styled-system/css'\n` +
        `export const a = css({ width: '[${widths.a}]' })\n` +
        `export const b = css({ width: '[${widths.b}]' })\n`,
    )
    writeFileSync(trigger, `export const version = 'first'\n`)
    writeFileSync(
      queryEntry,
      `import 'virtual:bamboo.css'\n` +
        `export { className as a } from './dual.tsx?a'\n` +
        `export { className as b } from './dual.tsx?b'\n`,
    )

    let watcher: Rollup.RollupWatcher | undefined
    const nextBuild = () =>
      new Promise<void>((resolve, reject) => {
        const active = watcher
        if (!active) throw new Error('watcher has not started')
        const onEvent = (event: { code: string; error?: Error }) => {
          if (event.code === 'END') {
            active.off('event', onEvent)
            resolve()
          } else if (event.code === 'ERROR') {
            active.off('event', onEvent)
            reject(event.error)
          }
        }
        active.on('event', onEvent)
      })
    const writtenCss = () =>
      readdirSync(queryOutDir)
        .filter((file) => file.endsWith('.css'))
        .map((file) => readFileSync(join(queryOutDir, file), 'utf8'))
        .join('\n')

    try {
      watcher = (await build({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [queryVariants, bamboocss({ cwd, configPath, reportSummary: false })],
        build: {
          watch: {},
          minify: false,
          outDir: queryOutDir,
          emptyOutDir: false,
          lib: { entry: queryEntry, formats: ['es'], fileName: 'query-entry' },
          rollupOptions: { external: [/styled-system/] },
        },
      })) as Rollup.RollupWatcher

      await nextBuild()
      expect(transformCalls).toEqual({ a: 1, b: 1 })
      const cleanCss = writtenCss()
      expect(cleanCss).toContain(widths.a)
      expect(cleanCss).toContain(widths.b)

      rmSync(queryOutDir, { force: true, recursive: true })
      const rebuilt = nextBuild()
      await new Promise((settle) => setTimeout(settle, 800))
      writeFileSync(trigger, `export const version = 'second'\n`)
      await rebuilt

      expect(transformCalls, 'only the watched query variant retransforms').toEqual({ a: 2, b: 1 })
      const cachedCss = writtenCss()
      expect(cachedCss).toContain(widths.a)
      expect(cachedCss).toContain(widths.b)
      expect(cachedCss, 'query-variant cache replay must match the cache-free build').toBe(cleanCss)
    } finally {
      await watcher?.close()
    }
  }, 120_000)

  test('a cached query sibling cannot erase a fresh survivor', async () => {
    const dual = join(fixtureDir, 'survivor-dual.tsx')
    const trigger = join(fixtureDir, 'survivor-trigger.tsx')
    const queryEntry = join(fixtureDir, 'survivor-entry.tsx')
    const survivorOutDir = join(fixtureDir, 'survivor-out')
    const transformCalls = { fresh: 0, cached: 0 }

    const queryVariants: VitePlugin = {
      name: 'bamboocss:test-query-survivor',
      enforce: 'pre',
      transform(_code, id) {
        const query = id.split('?')[1]
        if (!isModule(id, dual) || (query !== 'fresh' && query !== 'cached')) return
        transformCalls[query]++

        if (query === 'fresh') {
          this.addWatchFile(trigger)
          if (readFileSync(trigger, 'utf8').includes('second')) {
            return {
              code:
                `import { css } from '../../styled-system/css'\n` +
                `export const className = (width) => css({ width })\n`,
              map: null,
            }
          }
        }

        const width = query === 'fresh' ? '839.141px' : '839.282px'
        return {
          code:
            `import { css } from '../../styled-system/css'\n` +
            `export const className = css({ width: '[${width}]' })\n`,
          map: null,
        }
      },
    }

    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      dual,
      `import { css } from '../../styled-system/css'\n` +
        `export const fresh = css({ width: '[839.141px]' })\n` +
        `export const cached = css({ width: '[839.282px]' })\n`,
    )
    writeFileSync(trigger, `export const version = 'first'\n`)
    writeFileSync(
      queryEntry,
      `import 'virtual:bamboo.css'\n` +
        `export { className as fresh } from './survivor-dual.tsx?fresh'\n` +
        `export { className as cached } from './survivor-dual.tsx?cached'\n`,
    )

    let watcher: Rollup.RollupWatcher | undefined
    const nextBuild = () =>
      new Promise<Error | undefined>((resolve) => {
        const active = watcher
        if (!active) throw new Error('watcher has not started')
        const onEvent = (event: { code: string; error?: Error }) => {
          if (event.code !== 'END' && event.code !== 'ERROR') return
          active.off('event', onEvent)
          resolve(event.code === 'ERROR' ? event.error : undefined)
        }
        active.on('event', onEvent)
      })

    try {
      watcher = (await build({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [queryVariants, bamboocss({ cwd, configPath, reportSummary: false })],
        build: {
          watch: {},
          minify: false,
          outDir: survivorOutDir,
          emptyOutDir: false,
          lib: { entry: queryEntry, formats: ['es'], fileName: 'survivor-entry' },
          rollupOptions: { external: [/styled-system/] },
        },
      })) as Rollup.RollupWatcher

      expect(await nextBuild()).toBeUndefined()
      expect(transformCalls).toEqual({ fresh: 1, cached: 1 })

      const rebuilt = nextBuild()
      await new Promise((settle) => setTimeout(settle, 800))
      writeFileSync(trigger, `export const version = 'second'\n`)
      const error = await rebuilt

      expect(transformCalls, 'only the survivor-producing query variant retransforms').toEqual({ fresh: 2, cached: 1 })
      expect(error?.message).toContain('css() — dynamic')
    } finally {
      await watcher?.close()
    }
  }, 120_000)
})

/**
 * Every class the compiler emits must have a rule, including conditional ones.
 *
 * The assertions above check `.${token} {`, which only matches a *flat* rule — a conditional
 * atom is `.x:hover {`, `.x::before {`, or nested inside `@media`, so none were covered by
 * anything. A report that conditional styles compiled into class names whose rules never
 * reached the sheet had nothing in the suite that could confirm or refute it, and the cause
 * turned out to be real: reachability pruning deleted them.
 *
 * Kept in this file rather than its own so the heavy real builds stay on one worker; as a
 * separate file it ran concurrently with them and starved the CLI suite's subprocesses.
 */
const conditionalEntry = join(cwd, 'src/__conditional-atoms-test.tsx')

/** Widths are unique per condition, so a missing rule names the shape that lost it. */
const PROBES: Array<[string, string]> = [
  ['flat', '11.1px'],
  ['_hover', '22.2px'],
  ['_before', '33.3px'],
  ['_after', '44.4px'],
  ['_focus', '55.5px'],
  ['md', '66.6px'],
  ['[data-open]', '77.7px'],
  ['recipe base', '88.8px'],
  ['recipe _hover', '99.9px'],
  ['recipe _before', '12.34px'],
  ['recipe variant _focus', '56.78px'],
]

describe('conditional atoms reach the emitted stylesheet', () => {
  afterEach(() => {
    rmSync(conditionalEntry, { force: true })
  })

  test('every emitted class has a rule, and every condition survives', async () => {
    writeFileSync(
      conditionalEntry,
      `
      import 'virtual:bamboo.css'
      import { css, cva } from '../styled-system/css'

      export const flat = css({ width: '[11.1px]' })
      export const hover = css({ _hover: { width: '[22.2px]' } })
      export const before = css({ _before: { content: '""', width: '[33.3px]' } })
      export const after = css({ _after: { content: '""', width: '[44.4px]' } })
      export const focus = css({ _focus: { width: '[55.5px]' } })
      export const media = css({ md: { width: '[66.6px]' } })
      export const dataAttr = css({ '&[data-open]': { width: '[77.7px]' } })

      const box = cva({
        base: {
          width: '[88.8px]',
          _hover: { width: '[99.9px]' },
          _before: { content: '""', width: '[12.34px]' },
        },
        variants: { tone: { loud: { _focus: { width: '[56.78px]' } } } },
      })
      export const recipe = box({ tone: 'loud' })
      `,
    )

    const result = (await build({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: false })],
      build: {
        write: false,
        minify: false,
        lib: { entry: conditionalEntry, formats: ['es'], fileName: 'conditional-atoms' },
        rollupOptions: { external: [/^react/] },
      },
    })) as Rollup.RollupOutput[]

    const css = result[0]!.output
      .map((output) => ('source' in output && typeof output.source === 'string' ? output.source : ''))
      .join('\n')

    // Collected rather than asserted one at a time: which conditions survive and which do
    // not is the diagnostic, and failing on the first hides the shape of the failure.
    const missing = PROBES.filter(([, width]) => !css.includes(width)).map(([label, width]) => `${label} (${width})`)
    expect(missing, 'conditions with no rule in the emitted sheet').toEqual([])
  }, 120_000)
})

/**
 * The plugin driven by Vite 8, whose bundler is Rolldown rather than Rollup.
 *
 * Every other build test in this repo runs on Rollup, and the two differ in ways that are
 * silent rather than loud. `optimizeStaticCssAssets` renamed the pruned stylesheet by
 * replacing an entry in `bundle`; Rolldown does not support that, logs that the assignment
 * is ignored, and *drops the asset*. The build then exited 0 having shipped no CSS at all
 * and the application rendered unstyled — found by a user grepping their own bundle, because
 * nothing here could express a non-Rollup build.
 *
 * `vite8` is an alias for the real Vite 8 package, installed beside the Vite 7 the rest of
 * the sandbox uses. Pinning both means this asserts what a consumer on either actually gets,
 * rather than what our lockfile happens to resolve.
 */
const rolldownEntry = join(cwd, 'src/__rolldown-test.tsx')

/** Each declaration is unique, so an absence names the shape that lost its rule. */
const ROLLDOWN_PROBES: Array<[string, string]> = [
  ['flat', '21.1px'],
  ['_hover', '21.2px'],
  ['_before', '21.3px'],
  ['md', '21.4px'],
  ['[data-open]', '21.5px'],
  ['recipe base', '21.6px'],
  ['recipe conditional', '21.7px'],
]

describe('vite 8 / rolldown', () => {
  afterEach(() => {
    rmSync(rolldownEntry, { force: true })
  })

  test('emits the stylesheet, with every conditional rule intact', async () => {
    writeFileSync(
      rolldownEntry,
      `
      import 'virtual:bamboo.css'
      import { css, cva } from '../styled-system/css'

      export const flat = css({ width: '[21.1px]' })
      export const hover = css({ _hover: { width: '[21.2px]' } })
      export const before = css({ _before: { content: '""', width: '[21.3px]' } })
      export const media = css({ md: { width: '[21.4px]' } })
      export const dataAttr = css({ '&[data-open]': { width: '[21.5px]' } })

      const box = cva({
        base: { width: '[21.6px]', _hover: { width: '[21.7px]' } },
        variants: { tone: { loud: { opacity: 0.5 } } },
      })
      export const recipe = box({ tone: 'loud' })
      `,
    )

    const result = (await buildVite8({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: false })],
      build: {
        write: false,
        minify: false,
        lib: { entry: rolldownEntry, formats: ['es'], fileName: 'rolldown' },
        rollupOptions: { external: [/^react/] },
      },
    })) as Rollup.RollupOutput[]

    const css = result[0]!.output
      .map((output) => ('source' in output && typeof output.source === 'string' ? output.source : ''))
      .join('\n')

    // The failure that motivated this: a green build carrying no stylesheet at all.
    expect(css, 'no emitted asset carries the generated stylesheet').toContain('--made-with-bamboo')

    const missing = ROLLDOWN_PROBES.filter(([, width]) => !css.includes(width)).map(
      ([label, width]) => `${label} (${width})`,
    )
    expect(missing, 'shapes with no rule in the emitted sheet').toEqual([])
  }, 120_000)

  test('rebuilds JavaScript and CSS when an imported local dependency outside include changes', async () => {
    const fixtureDir = join(cwd, 'src/__rolldown-watch-tmp')
    const configPath = join(cwd, '__rolldown-watch-tmp.bamboo.config.ts')
    const dependency = join(fixtureDir, 'dep.ts')
    const entry = join(fixtureDir, 'entry.tsx')
    const outDir = join(fixtureDir, 'out')
    mkdirSync(fixtureDir, { recursive: true })
    writeIsolatedBambooConfig(configPath, ['./src/__rolldown-watch-tmp/**/*.tsx'])
    writeFileSync(dependency, `export const shared = { color: 'blue600' }\n`)
    writeFileSync(
      entry,
      `import 'virtual:bamboo.css'\nimport { css } from '../../styled-system/css'\nimport { shared } from './dep'\nexport const cls = css(shared)\n`,
    )

    const watcher = (await buildVite8({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, configPath, reportSummary: false })],
      build: {
        watch: {},
        minify: false,
        outDir,
        emptyOutDir: false,
        lib: { entry, formats: ['es'], fileName: 'entry' },
        rollupOptions: { external: [/styled-system/] },
      },
    })) as unknown as Rollup.RollupWatcher

    const nextBuild = () =>
      new Promise<void>((resolve, reject) => {
        const onEvent = (event: { code: string; error?: Error }) => {
          if (event.code === 'END') {
            watcher.off('event', onEvent)
            resolve()
          } else if (event.code === 'ERROR') {
            watcher.off('event', onEvent)
            reject(event.error)
          }
        }
        watcher.on('event', onEvent)
      })
    const output = (...extensions: string[]) =>
      readdirSync(outDir)
        .filter((file) => extensions.some((extension) => file.endsWith(extension)))
        .map((file) => readFileSync(join(outDir, file), 'utf8'))
        .join('\n')

    try {
      await nextBuild()
      expect(output('.js', '.mjs')).toContain('"c_blue600"')
      expect(output('.css')).toContain('blue600')

      const rebuilt = nextBuild()
      await new Promise((settle) => setTimeout(settle, 800))
      writeFileSync(dependency, `export const shared = { color: 'red600' }\n`)
      await rebuilt

      expect(output('.js', '.mjs')).toContain('"c_red600"')
      expect(output('.js', '.mjs')).not.toContain('"c_blue600"')
      expect(output('.css')).toContain('red600')
      expect(output('.css')).not.toContain('blue600')
    } finally {
      await watcher.close()
      rmSync(fixtureDir, { force: true, recursive: true })
      rmSync(configPath, { force: true })
    }
  }, 120_000)
})

/**
 * A client and an SSR environment, built against one plugin instance.
 *
 * `buildStart` fires once per environment, and it reset the whole compilation session each
 * time. The second environment therefore discarded what the first established: `cssLoaded`
 * went false, so an SSR bundle — which legitimately never imports the stylesheet, because the
 * client build emits it — failed the "not imported" check outright. The reachability sets that
 * pruning consults were emptied by the same reset.
 *
 * Pruning was the piece that reset left undone, and it is the rest of this block: the
 * stylesheet is finalized by the environment that imports it, which is not the environment
 * that finishes last, so reachability was incomplete at exactly the moment it was used to
 * delete rules.
 *
 * Driven through `createBuilder` rather than a framework, because the framework is incidental:
 * what matters is two environments sharing one instance, which is the shape react-router,
 * Nuxt and SvelteKit all produce.
 */
const envClientEntry = join(cwd, 'src/__env-client.tsx')
const envSsrEntry = join(cwd, 'src/__env-ssr.tsx')
const envSharedModule = join(cwd, 'src/__env-shared.tsx')

/**
 * `builder: {}` is what `vite build --app` sets, and what every framework building more than
 * one environment configures. It is the signal the plugin reads to know the run has more
 * environments coming, so the omitting case is a test of its own below.
 */
const twoEnvironmentBuilder = (announced: boolean, ssrBuild: Record<string, unknown> = {}) =>
  createBuilder({
    root: cwd,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [bamboocss({ cwd, reportSummary: false })],
    build: { write: false, minify: false, rollupOptions: { external: [/^react/] } },
    ...(announced ? { builder: {} } : {}),
    environments: {
      client: { build: { lib: { entry: envClientEntry, formats: ['es'], fileName: 'env-client' } } },
      ssr: { build: { ssr: true, ...ssrBuild, lib: { entry: envSsrEntry, formats: ['es'], fileName: 'env-ssr' } } },
    },
  })

/** Every asset source both environments emitted, in the order given. */
const buildBothEnvironments = async (
  builder: Awaited<ReturnType<typeof createBuilder>>,
  order: string[] = ['client', 'ssr'],
) => {
  const sources: string[] = []
  for (const name of order) {
    const built = await builder.build(builder.environments[name]!)
    for (const bundle of Array.isArray(built) ? built : [built]) {
      for (const output of (bundle as { output?: unknown[] }).output ?? []) {
        const asset = output as { source?: unknown }
        if (typeof asset.source === 'string') sources.push(asset.source)
      }
    }
  }
  return sources.join('\n')
}

type TestWatchEvent = { code: string; error?: Error }
type TestBuildWatcher = {
  close(): Promise<void>
  off(event: 'event', listener: (event: TestWatchEvent) => void): void
  on(event: 'event', listener: (event: TestWatchEvent) => void): void
}
type TestEnvironmentBuilder = {
  build(environment: unknown): Promise<unknown>
  environments: Record<string, unknown>
}

const nextEnvironmentWatchBuild = (watcher: TestBuildWatcher) =>
  new Promise<Error | undefined>((resolve) => {
    const onEvent = (event: TestWatchEvent) => {
      if (event.code !== 'END' && event.code !== 'ERROR') return
      watcher.off('event', onEvent)
      resolve(event.code === 'ERROR' ? event.error : undefined)
    }
    watcher.on('event', onEvent)
  })

/** Wait through a failed task's ERROR and the enclosing watch run's END. */
const nextEnvironmentWatchCycle = (watcher: TestBuildWatcher) =>
  new Promise<Error | undefined>((resolve) => {
    let error: Error | undefined
    const onEvent = (event: TestWatchEvent) => {
      if (event.code === 'ERROR') error = event.error
      if (event.code !== 'END') return
      watcher.off('event', onEvent)
      resolve(error)
    }
    watcher.on('event', onEvent)
  })

/**
 * The error of the first watch cycle that fails, or `undefined` once one ends clean having done
 * what `done` checks for — what an edit makes the outputs hold.
 *
 * A cycle that did neither, which a late event for an earlier write or the shared plugin can start,
 * ends unread: waiting on whichever cycle ended next read such a rebuild as the one an edit made,
 * and failed a full suite run so. What a cycle wrote says which one it was where when it started
 * does not, as a build that began before an edit can read it. A cycle that never comes fails
 * naming `what`, rather than holding the test to its timeout.
 *
 * Waiting for an edit a plugin is set to reject, `failing` is what its error says: then only a
 * cycle failing so, having done what `done` checks for, is the one, and a clean one is not — the
 * rejection test read a late clean cycle's `undefined` as the error it was waiting for. A cycle
 * failing otherwise is no replay to wait past: its error fails the wait at once.
 */
const watchCycleUntil = (watcher: TestBuildWatcher, done: () => boolean, what: string, failing?: string) => {
  const cycle = new Promise<Error | undefined>((resolve, reject) => {
    // Every error a cycle reports: Rolldown runs each configured output as a task of its own.
    let errors: Error[] = []
    let others = 0
    const stop = () => {
      clearTimeout(timer)
      watcher.off('event', onEvent)
    }
    const timer = setTimeout(() => {
      watcher.off('event', onEvent)
      reject(new Error(`No watch cycle ${what} within 60s; ${others} other cycle(s) ended`))
    }, 60_000)
    // Not to hold the process open after a test that failed before awaiting this.
    timer.unref?.()
    const onEvent = (event: TestWatchEvent) => {
      if (event.code === 'ERROR') {
        if (failing !== undefined && !event.error.message.includes(failing)) {
          stop()
          reject(new Error(`A watch cycle ${what} failed otherwise: ${event.error.message}`, { cause: event.error }))
          return
        }
        errors.push(event.error)
      }
      if (event.code !== 'END') return
      const ended = errors
      errors = []
      const ours = failing === undefined ? ended.length > 0 || done() : ended.length > 0 && done()
      if (!ours) {
        others++
        return
      }
      stop()
      resolve(ended[0])
    }
    watcher.on('event', onEvent)
  })
  // Awaited after a write: if the write throws, the test fails there, and this rejection, when it
  // comes, is not reported against whichever test is running then.
  cycle.catch(() => {})
  return cycle
}

/**
 * Resolves once none of `watchers` has reported anything for `ms`, a cycle under way included, so
 * a rebuild a doubled file event started has run its course before what it wrote, or how many
 * times a plugin transformed, is read.
 *
 * Kept per watcher, and any event short of `END` says one is under way, its `START` seen or not.
 * Watchers that never go quiet — a rebuild feeding itself — fail it after a minute, rather than
 * holding the test to its timeout with them still open.
 */
const watchersQuiet = (watchers: TestBuildWatcher[], ms = 500) =>
  new Promise<void>((resolve, reject) => {
    const running = new Set<TestBuildWatcher>()
    const listeners = new Map<TestBuildWatcher, (event: TestWatchEvent) => void>()
    let started = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      clearTimeout(timer)
      clearTimeout(deadline)
      for (const [watcher, listener] of listeners) watcher.off('event', listener)
    }
    const deadline = setTimeout(() => {
      stop()
      reject(new Error(`Watchers not quiet within 60s: ${running.size} running, ${started} cycle(s) started`))
    }, 60_000)
    deadline.unref?.()
    const arm = () => {
      clearTimeout(timer)
      if (running.size > 0) return
      timer = setTimeout(() => {
        stop()
        resolve()
      }, ms)
    }
    for (const watcher of watchers) {
      const listener = (event: TestWatchEvent) => {
        if (event.code === 'START') started++
        if (event.code === 'END') running.delete(watcher)
        else running.add(watcher)
        arm()
      }
      listeners.set(watcher, listener)
      watcher.on('event', listener)
    }
    arm()
  })

/**
 * How many watch cycles `watcher` starts from here, read by calling what this returns, which stops
 * counting. A transform count cannot say an environment rebuilt: on Vite 7 a cycle Rollup's cache
 * answers transforms nothing, though it was started.
 */
const cyclesStartedBy = (watcher: TestBuildWatcher) => {
  let started = 0
  const onEvent = (event: TestWatchEvent) => {
    if (event.code === 'START') started++
  }
  watcher.on('event', onEvent)
  return () => {
    watcher.off('event', onEvent)
    return started
  }
}

/** Resolves once `condition` holds, polled, or rejects naming `what` after `ms`. */
const until = async (condition: () => boolean, what: string, ms = 10_000) => {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Not ${what} within ${ms / 1000}s`)
    await new Promise((settle) => setTimeout(settle, 50))
  }
}

const runPartialEnvironmentWatchRebuild = async (
  create: (config: Record<string, unknown>) => Promise<unknown>,
  label: string,
  widths: { cachedSsr: string; freshClient: string; freshSsr: string },
  /**
   * Whether SSR imports the stylesheet and emits its assets, writing a sheet of its own. That sheet
   * supersedes the one it wrote last and no other, so its rebuild fails on the client's losses as
   * one writing none does: it passed, though the page links the client's sheet.
   */
  ssrEmitsSheet = false,
) => {
  const clientTrigger = join(cwd, `src/__partial-client-${label}.txt`)
  const ssrTrigger = join(cwd, `src/__partial-ssr-${label}.txt`)
  const configPath = join(cwd, `__partial-environment-${label}.bamboo.config.ts`)
  const clientOutDir = join(cwd, `__partial-client-${label}-out`)
  const ssrOutDir = join(cwd, `__partial-ssr-${label}-out`)
  const calls = { client: 0, ssr: 0 }

  const environmentSource: VitePlugin = {
    name: `bamboocss:test-partial-environment-source-${label}`,
    enforce: 'pre',
    sharedDuringBuild: true,
    transform(_code, id) {
      if (!isModule(id, envSharedModule)) return

      const environment = this.environment.name as keyof typeof calls
      calls[environment]++
      const trigger = environment === 'client' ? clientTrigger : ssrTrigger
      this.addWatchFile(trigger)

      const version = readFileSync(trigger, 'utf8').trim()
      const width =
        version === 'first' ? widths.cachedSsr : environment === 'client' ? widths.freshClient : widths.freshSsr
      return {
        code:
          `import { css } from '../styled-system/css'\n` + `export const className = css({ width: '[${width}]' })\n`,
        map: null,
      }
    },
  }

  writeFileSync(
    envSharedModule,
    `import { css } from '../styled-system/css'\n` +
      `export const cachedSsr = css({ width: '[${widths.cachedSsr}]' })\n` +
      `export const freshClient = css({ width: '[${widths.freshClient}]' })\n` +
      `export const freshSsr = css({ width: '[${widths.freshSsr}]' })\n`,
  )
  writeWatchTrigger(clientTrigger, 'first')
  writeWatchTrigger(ssrTrigger, 'first')
  writeFileSync(envClientEntry, `import 'virtual:bamboo.css'\nexport { className } from './__env-shared'\n`)
  writeFileSync(
    envSsrEntry,
    `${ssrEmitsSheet ? `import 'virtual:bamboo.css'\n` : ''}export { className } from './__env-shared'\n`,
  )
  writeIsolatedBambooConfig(configPath, ['./src/__env-shared.tsx', './src/__env-client.tsx', './src/__env-ssr.tsx'])
  // Before the watchers start, so a late event for one of these writes cannot start a rebuild
  // the counts below would read as the edit's.
  await settled()

  const builder = (await create({
    root: cwd,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [environmentSource, bamboocss({ cwd, configPath, reportSummary: false })],
    build: {
      watch: {},
      minify: false,
      emptyOutDir: false,
      rollupOptions: { external: [/^react/] },
    },
    builder: {},
    environments: {
      client: {
        build: {
          outDir: clientOutDir,
          lib: { entry: envClientEntry, formats: ['es'], fileName: `partial-client-${label}` },
        },
      },
      ssr: {
        build: {
          ssr: true,
          outDir: ssrOutDir,
          ...(ssrEmitsSheet ? { emitAssets: true } : {}),
          lib: { entry: envSsrEntry, formats: ['es'], fileName: `partial-ssr-${label}` },
        },
      },
    },
  })) as TestEnvironmentBuilder

  let clientWatcher: TestBuildWatcher | undefined
  let ssrWatcher: TestBuildWatcher | undefined
  try {
    // SSR finishes first. Its contribution has to survive a later client-only generation,
    // because these are independent watchers and its emitted JavaScript remains live.
    ssrWatcher = (await builder.build(builder.environments.ssr)) as TestBuildWatcher
    expect(await nextEnvironmentWatchBuild(ssrWatcher)).toBeUndefined()
    clientWatcher = (await builder.build(builder.environments.client)) as TestBuildWatcher
    expect(await nextEnvironmentWatchBuild(clientWatcher)).toBeUndefined()

    expect(calls).toEqual({ client: 1, ssr: 1 })
    const ssrJs = readOutputFiles(ssrOutDir, '.js')
    expect(ssrJs).toContain(`w_[${widths.cachedSsr}]`)

    // Each wait ends on the cycle that built its edit; the counts are taken just before the edit
    // and read once both watchers have gone quiet. A watcher can see one write twice, and a second
    // rebuild of the environment edited is no part of what this asserts — that the other one did
    // not build at all — though more than that would be a rebuild feeding itself (`ssr: 3`, 1
    // suite run under load).
    rmSync(clientOutDir, { force: true, recursive: true })
    const rebuiltClient = watchCycleUntil(
      clientWatcher,
      () => readOutputFiles(clientOutDir, '.css').includes(widths.freshClient),
      'rebuilding the client from its trigger',
    )
    await new Promise((settle) => setTimeout(settle, 800))
    const beforeClientEdit = { ...calls }
    const ssrStarted = cyclesStartedBy(ssrWatcher)
    writeWatchTrigger(clientTrigger, 'second')
    expect(await rebuiltClient).toBeUndefined()
    await watchersQuiet([clientWatcher, ssrWatcher])

    expect(ssrStarted(), 'the client-only edit started SSR').toBe(0)
    expect(calls.ssr, 'the client-only edit did not start or transform SSR').toBe(beforeClientEdit.ssr)
    expect(calls.client).toBeGreaterThan(beforeClientEdit.client)
    expect(calls.client).toBeLessThanOrEqual(beforeClientEdit.client + 2)
    const rebuiltCss = readOutputFiles(clientOutDir, '.css')
    expect(rebuiltCss).toContain(widths.cachedSsr)
    expect(rebuiltCss).toContain(widths.freshClient)
    expect(rebuiltCss).not.toContain(widths.freshSsr)
    expect(rebuiltCss).toContain(`.${esc(`w_[${widths.cachedSsr}]`)}`)

    // The inverse partial rebuild must retain the client sheet's loss history. That sheet
    // pruned the third rule, and SSR emits no replacement asset, so requiring it fails closed.
    // Failing as it should, naming the class its edit compiled, which writes nothing: a late cycle
    // of the source before the edit compiles none the client sheet pruned, and does not fail.
    const rebuiltSsr = watchCycleUntil(
      ssrWatcher,
      () => true,
      'rebuilding SSR from its trigger',
      esc(`w_[${widths.freshSsr}]`),
    )
    await new Promise((settle) => setTimeout(settle, 800))
    const beforeSsrEdit = { ...calls }
    const clientStarted = cyclesStartedBy(clientWatcher)
    writeWatchTrigger(ssrTrigger, 'second')
    const ssrError = await rebuiltSsr
    await watchersQuiet([clientWatcher, ssrWatcher])

    expect(clientStarted(), 'the SSR-only edit started the client').toBe(0)
    expect(calls.client, 'the SSR-only edit did not start or transform the client').toBe(beforeSsrEdit.client)
    expect(calls.ssr).toBeGreaterThan(beforeSsrEdit.ssr)
    expect(calls.ssr).toBeLessThanOrEqual(beforeSsrEdit.ssr + 2)
    expect(ssrError?.message).toContain('already pruned out of a stylesheet')
    expect(ssrError?.message).toContain(esc(`w_[${widths.freshSsr}]`))
    // The client's rebuild restored its class, which the sheet before it had pruned: not lost. On
    // Vite 8 it was named too, Rolldown handing each watch generation the same output options.
    expect(ssrError?.message).not.toContain(esc(`w_[${widths.freshClient}]`))
  } finally {
    await Promise.all([clientWatcher?.close(), ssrWatcher?.close()])
    rmSync(clientTrigger, { force: true })
    rmSync(ssrTrigger, { force: true })
    rmSync(configPath, { force: true })
    rmSync(clientOutDir, { force: true, recursive: true })
    rmSync(ssrOutDir, { force: true, recursive: true })
  }
}

/**
 * Build the client first, as a framework does, then rebuild it alone, then SSR alone.
 *
 * The client's sheet is pruned against the client, then pruned again with SSR's class restored
 * once SSR's build reaches its output, before it writes. Rolldown hands each watch generation of
 * an output the same options, and the loss history kept under them carried that first pruning on
 * into the client's rebuild: the SSR rebuild after it, compiling the class it always had, failed
 * naming it, and the class the client's edit restored, as pruned, though the sheet holds both.
 */
const runClientFirstWatchRebuild = async (
  create: (config: Record<string, unknown>) => Promise<unknown>,
  label: string,
  widths: { ssr: string; client: string; edited: string },
  /**
   * Whether SSR imports the stylesheet too, so its own copy, which Vite discards, is pruned in the
   * output hook where SSR completes the run: the stage it recorded took the client's losses for its
   * own, and the SSR rebuild after the client's failed naming the class the client had restored.
   */
  ssrImportsSheet = false,
) => {
  const clientTrigger = join(cwd, `src/__client-first-client-${label}.txt`)
  const ssrTrigger = join(cwd, `src/__client-first-ssr-${label}.txt`)
  const configPath = join(cwd, `__client-first-${label}.bamboo.config.ts`)
  const clientOutDir = join(cwd, `__client-first-client-${label}-out`)
  const ssrOutDir = join(cwd, `__client-first-ssr-${label}-out`)
  const calls = { client: 0, ssr: 0 }
  // What a run stopped before its `finally` left would be read as this one's.
  rmSync(clientOutDir, { force: true, recursive: true })
  rmSync(ssrOutDir, { force: true, recursive: true })

  const environmentSource: VitePlugin = {
    name: `bamboocss:test-client-first-source-${label}`,
    enforce: 'pre',
    sharedDuringBuild: true,
    transform(_code, id) {
      if (!isModule(id, envSharedModule)) return

      const environment = this.environment.name as keyof typeof calls
      calls[environment]++
      const trigger = environment === 'client' ? clientTrigger : ssrTrigger
      this.addWatchFile(trigger)

      // SSR compiles its one class whatever its trigger says, and the client the one its edit names.
      const edited = readFileSync(trigger, 'utf8').trim() !== 'first'
      const width = environment === 'ssr' ? widths.ssr : edited ? widths.edited : widths.client
      return {
        code:
          `import { css } from '../styled-system/css'\n` + `export const className = css({ width: '[${width}]' })\n`,
        map: null,
      }
    },
  }

  writeFileSync(
    envSharedModule,
    `import { css } from '../styled-system/css'\n` +
      `export const ssr = css({ width: '[${widths.ssr}]' })\n` +
      `export const client = css({ width: '[${widths.client}]' })\n` +
      `export const edited = css({ width: '[${widths.edited}]' })\n`,
  )
  writeWatchTrigger(clientTrigger, 'first')
  writeWatchTrigger(ssrTrigger, 'first')
  writeFileSync(envClientEntry, `import 'virtual:bamboo.css'\nexport { className } from './__env-shared'\n`)
  writeFileSync(
    envSsrEntry,
    `${ssrImportsSheet ? `import 'virtual:bamboo.css'\n` : ''}export { className } from './__env-shared'\n`,
  )
  writeIsolatedBambooConfig(configPath, ['./src/__env-shared.tsx', './src/__env-client.tsx', './src/__env-ssr.tsx'])
  // Before the watchers start, so a late event for one of these writes cannot start a rebuild.
  await settled()

  const builder = (await create({
    root: cwd,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [environmentSource, bamboocss({ cwd, configPath, reportSummary: false })],
    build: {
      watch: {},
      minify: false,
      emptyOutDir: false,
      rollupOptions: { external: [/^react/] },
    },
    builder: {},
    environments: {
      client: {
        build: {
          outDir: clientOutDir,
          lib: { entry: envClientEntry, formats: ['es'], fileName: `client-first-client-${label}` },
        },
      },
      ssr: {
        build: {
          ssr: true,
          outDir: ssrOutDir,
          // Split, as an app's is, so the sheet SSR imports is in its bundle for the early pass.
          ...(ssrImportsSheet ? { cssCodeSplit: true } : {}),
          lib: { entry: envSsrEntry, formats: ['es'], fileName: `client-first-ssr-${label}` },
        },
      },
    },
  })) as TestEnvironmentBuilder

  let clientWatcher: TestBuildWatcher | undefined
  let ssrWatcher: TestBuildWatcher | undefined
  try {
    clientWatcher = (await builder.build(builder.environments.client)) as TestBuildWatcher
    expect(await nextEnvironmentWatchBuild(clientWatcher)).toBeUndefined()
    ssrWatcher = (await builder.build(builder.environments.ssr)) as TestBuildWatcher
    expect(await nextEnvironmentWatchBuild(ssrWatcher)).toBeUndefined()
    await watchersQuiet([clientWatcher, ssrWatcher])

    expect(calls).toEqual({ client: 1, ssr: 1 })
    const firstCss = readOutputFiles(clientOutDir, '.css')
    expect(firstCss).toContain(`.${esc(`w_[${widths.ssr}]`)}`)
    expect(firstCss).toContain(`.${esc(`w_[${widths.client}]`)}`)
    expect(firstCss).not.toContain(widths.edited)

    // The client alone, now compiling the class its first sheet pruned. Its sheet is written under
    // a name of its own, beside the first, so only what the rebuild writes is read.
    rmSync(clientOutDir, { force: true, recursive: true })
    const rebuiltClient = watchCycleUntil(
      clientWatcher,
      () => readOutputFiles(clientOutDir, '.css').includes(widths.edited),
      'rebuilding the client from its trigger',
    )
    await new Promise((settle) => setTimeout(settle, 800))
    writeWatchTrigger(clientTrigger, 'second')
    expect(await rebuiltClient).toBeUndefined()
    await watchersQuiet([clientWatcher, ssrWatcher])

    const rebuiltCss = readOutputFiles(clientOutDir, '.css')
    expect(rebuiltCss).toContain(`.${esc(`w_[${widths.ssr}]`)}`)
    expect(rebuiltCss).toContain(`.${esc(`w_[${widths.edited}]`)}`)

    // SSR alone, compiling the class it always had, which the client's sheet holds. Counted from
    // the edit, so a late cycle before it does not end the wait.
    let beforeSsrEdit = Number.POSITIVE_INFINITY
    const rebuiltSsr = watchCycleUntil(ssrWatcher, () => calls.ssr > beforeSsrEdit, 'rebuilding SSR from its trigger')
    await new Promise((settle) => setTimeout(settle, 800))
    beforeSsrEdit = calls.ssr
    writeWatchTrigger(ssrTrigger, 'second')
    expect(await rebuiltSsr).toBeUndefined()
    await watchersQuiet([clientWatcher, ssrWatcher])

    expect(readOutputFiles(ssrOutDir, '.js')).toContain(`w_[${widths.ssr}]`)
    expect(readOutputFiles(clientOutDir, '.css')).toContain(`.${esc(`w_[${widths.ssr}]`)}`)
  } finally {
    await Promise.all([clientWatcher?.close(), ssrWatcher?.close()])
    rmSync(clientTrigger, { force: true })
    rmSync(ssrTrigger, { force: true })
    rmSync(configPath, { force: true })
    rmSync(clientOutDir, { force: true, recursive: true })
    rmSync(ssrOutDir, { force: true, recursive: true })
  }
}

/**
 * Build the client first, then SSR, whose output another plugin rejects once Bamboo's early pass
 * has finalized the client's sheet in it, then rebuild SSR alone.
 *
 * The finalization restored SSR's class to the client's sheet on disk, while the loss history the
 * guard read was the set that pass put back as it ended, still holding the client's provisional
 * losses: only SSR's output being written rebuilt it, and a rejected one never is. SSR's next
 * rebuild failed naming the class the client's sheet holds, and the one after that passed.
 */
const runRejectedCompletionWatchRebuild = async (
  create: (config: Record<string, unknown>) => Promise<unknown>,
  label: string,
  widths: { ssr: string; client: string },
) => {
  const ssrTrigger = join(cwd, `src/__rejected-completion-ssr-${label}.txt`)
  const configPath = join(cwd, `__rejected-completion-${label}.bamboo.config.ts`)
  const clientOutDir = join(cwd, `__rejected-completion-client-${label}-out`)
  const ssrOutDir = join(cwd, `__rejected-completion-ssr-${label}-out`)
  const calls = { client: 0, ssr: 0 }
  rmSync(clientOutDir, { force: true, recursive: true })
  rmSync(ssrOutDir, { force: true, recursive: true })

  const environmentSource: VitePlugin = {
    name: `bamboocss:test-rejected-completion-source-${label}`,
    enforce: 'pre',
    sharedDuringBuild: true,
    transform(_code, id) {
      if (!isModule(id, envSharedModule)) return

      const environment = this.environment.name as keyof typeof calls
      calls[environment]++
      if (environment === 'ssr') this.addWatchFile(ssrTrigger)
      const width = environment === 'ssr' ? widths.ssr : widths.client
      return {
        code:
          `import { css } from '../styled-system/css'\n` + `export const className = css({ width: '[${width}]' })\n`,
        map: null,
      }
    },
  }
  // A normal-order hook, so it runs after Bamboo's early pass has finalized the client's sheet.
  let rejectSsrOutput = true
  const rejecter: VitePlugin = {
    name: `bamboocss:test-rejected-completion-rejecter-${label}`,
    sharedDuringBuild: true,
    generateBundle() {
      if (this.environment.name !== 'ssr' || !rejectSsrOutput) return
      rejectSsrOutput = false
      throw new Error('SSR output rejected once by a test plugin')
    },
  }

  writeFileSync(
    envSharedModule,
    `import { css } from '../styled-system/css'\n` +
      `export const ssr = css({ width: '[${widths.ssr}]' })\n` +
      `export const client = css({ width: '[${widths.client}]' })\n`,
  )
  writeWatchTrigger(ssrTrigger, 'first')
  writeFileSync(envClientEntry, `import 'virtual:bamboo.css'\nexport { className } from './__env-shared'\n`)
  writeFileSync(envSsrEntry, `export { className } from './__env-shared'\n`)
  writeIsolatedBambooConfig(configPath, ['./src/__env-shared.tsx', './src/__env-client.tsx', './src/__env-ssr.tsx'])
  await settled()

  const builder = (await create({
    root: cwd,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [environmentSource, bamboocss({ cwd, configPath, reportSummary: false }), rejecter],
    build: {
      watch: {},
      minify: false,
      emptyOutDir: false,
      rollupOptions: { external: [/^react/] },
    },
    builder: {},
    environments: {
      client: {
        build: {
          outDir: clientOutDir,
          lib: { entry: envClientEntry, formats: ['es'], fileName: `rejected-completion-client-${label}` },
        },
      },
      ssr: {
        build: {
          ssr: true,
          outDir: ssrOutDir,
          lib: { entry: envSsrEntry, formats: ['es'], fileName: `rejected-completion-ssr-${label}` },
        },
      },
    },
  })) as TestEnvironmentBuilder

  let clientWatcher: TestBuildWatcher | undefined
  let ssrWatcher: TestBuildWatcher | undefined
  try {
    clientWatcher = (await builder.build(builder.environments.client)) as TestBuildWatcher
    expect(await nextEnvironmentWatchBuild(clientWatcher)).toBeUndefined()
    ssrWatcher = (await builder.build(builder.environments.ssr)) as TestBuildWatcher
    expect((await nextEnvironmentWatchBuild(ssrWatcher))?.message).toContain('SSR output rejected once')
    await watchersQuiet([clientWatcher, ssrWatcher])

    // Finalized in SSR's early pass, before the rejection: the sheet on disk holds SSR's class.
    expect(readOutputFiles(clientOutDir, '.css')).toContain(`.${esc(`w_[${widths.ssr}]`)}`)
    expect(readOutputFiles(ssrOutDir, '.js')).toBe('')

    let beforeSsrEdit = Number.POSITIVE_INFINITY
    const rebuiltSsr = watchCycleUntil(ssrWatcher, () => calls.ssr > beforeSsrEdit, 'rebuilding SSR from its trigger')
    await new Promise((settle) => setTimeout(settle, 800))
    beforeSsrEdit = calls.ssr
    writeWatchTrigger(ssrTrigger, 'second')
    expect(await rebuiltSsr).toBeUndefined()
    await watchersQuiet([clientWatcher, ssrWatcher])

    expect(readOutputFiles(ssrOutDir, '.js')).toContain(`w_[${widths.ssr}]`)
    expect(readOutputFiles(clientOutDir, '.css')).toContain(`.${esc(`w_[${widths.ssr}]`)}`)
  } finally {
    await Promise.all([clientWatcher?.close(), ssrWatcher?.close()])
    rmSync(ssrTrigger, { force: true })
    rmSync(configPath, { force: true })
    rmSync(clientOutDir, { force: true, recursive: true })
    rmSync(ssrOutDir, { force: true, recursive: true })
  }
}

/**
 * Reject one environment after Bamboo generated its candidate bundle, then rebuild only its
 * sibling.
 *
 * `buildEnd` is too early to publish reachability: Rollup and Rolldown keep the previous files
 * when a later `generateBundle` hook throws. The sibling must therefore see the last output which
 * actually reached disk, not the rejected graph Bamboo had prepared in memory.
 */
const runRejectedOutputWatchRebuild = async (
  create: (config: Record<string, unknown>) => Promise<unknown>,
  label: string,
  widths: { old: string; rejected: string; written: string; sibling: string },
) => {
  const clientEntry = join(cwd, `src/__output-transaction-client-${label}.tsx`)
  const siblingEntry = join(cwd, `src/__output-transaction-sibling-${label}.tsx`)
  const clientTrigger = join(cwd, `src/__output-transaction-client-${label}.txt`)
  const siblingTrigger = join(cwd, `src/__output-transaction-sibling-${label}.ts`)
  const configPath = join(cwd, `__output-transaction-${label}.bamboo.config.ts`)
  const clientOutDir = join(cwd, `__output-transaction-client-${label}-out`)
  const siblingOutDir = join(cwd, `__output-transaction-sibling-${label}-out`)
  const calls = { client: 0 }

  const selectedClientSource: VitePlugin = {
    name: `bamboocss:test-output-transaction-source-${label}`,
    enforce: 'pre',
    sharedDuringBuild: true,
    transform(_code, id) {
      if (!isModule(id, clientEntry)) return
      calls.client++
      this.addWatchFile(clientTrigger)
      const version = readFileSync(clientTrigger, 'utf8').trim()
      const width = version === 'second' ? widths.rejected : version === 'third' ? widths.written : widths.old
      return {
        code:
          `import 'virtual:bamboo.css'\n` +
          `import { css } from '../styled-system/css'\n` +
          `export const className = css({ width: '[${width}]' })\n`,
        map: null,
      }
    },
  }

  let rejectClientOutput = false
  let rejectAfterWrite = false
  let rejectBeforeBambooWrite = false
  let rejectOnClose = false
  let mutateClientCss = false
  let configuredOutputCloseCalls = 0
  let rejectedJs = ''
  let rejectedCss = ''
  // A configured output plugin, not another Vite input plugin. Bamboo's private finalizer must
  // be appended after this too; otherwise an in-memory success marker can still run too early.
  const rejectAfterBamboo: VitePlugin = {
    name: `bamboocss:test-reject-output-transaction-${label}`,
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        // What Qwik's optimizer does in the same hook: a manifest that quotes each stylesheet's
        // text. A new asset carrying the marker is not the sheet changing, and must pass.
        const quoted = Object.values(bundle)
          .map((output) =>
            output.type === 'asset' && output.fileName.endsWith('.css')
              ? typeof output.source === 'string'
                ? output.source
                : Buffer.from(output.source).toString()
              : '',
          )
          .join('')
        if (quoted) {
          this.emitFile({ type: 'asset', fileName: `q-manifest-${label}.json`, source: JSON.stringify({ quoted }) })
        }
        if (mutateClientCss) {
          for (const output of Object.values(bundle)) {
            if (output.type !== 'asset' || !output.fileName.endsWith('.css')) continue
            const source = typeof output.source === 'string' ? output.source : Buffer.from(output.source).toString()
            output.source = source.replace('--made-with-bamboo', '--removed-after-bamboo')
          }
        }
        const isClientOutput = Object.values(bundle).some(
          (output) => output.type === 'chunk' && isModule(output.facadeModuleId, clientEntry),
        )
        if (!rejectClientOutput || !isClientOutput) return
        rejectedJs = Object.values(bundle)
          .map((output) => (output.type === 'chunk' ? output.code : ''))
          .join('\n')
        rejectedCss = Object.values(bundle)
          .map((output) => {
            if (output.type !== 'asset' || !output.fileName.endsWith('.css')) return ''
            return typeof output.source === 'string' ? output.source : Buffer.from(output.source).toString()
          })
          .join('\n')
        throw new Error(`test rejected client output (${label})`)
      },
    },
    writeBundle() {
      if (rejectAfterWrite) throw new Error(`test rejected after writing client output (${label})`)
    },
    closeBundle() {
      configuredOutputCloseCalls++
    },
  }
  const rejectCloseAfterBamboo: VitePlugin = {
    name: `bamboocss:test-reject-close-transaction-${label}`,
    enforce: 'post',
    sharedDuringBuild: true,
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        if (rejectOnClose) throw new Error(`test rejected while closing client output (${label})`)
      },
    },
  }
  const rejectWriteBeforeBamboo: VitePlugin = {
    name: `bamboocss:test-reject-write-before-transaction-${label}`,
    enforce: 'pre',
    sharedDuringBuild: true,
    writeBundle: {
      order: 'pre',
      sequential: true,
      handler() {
        if (this.environment.name === 'client' && rejectBeforeBambooWrite) {
          throw new Error(`test rejected before Bamboo's write observer (${label})`)
        }
      },
    },
  }

  writeFileSync(
    clientEntry,
    `import 'virtual:bamboo.css'\n` +
      `import { css } from '../styled-system/css'\n` +
      `export const oldClass = css({ width: '[${widths.old}]' })\n` +
      `export const rejectedClass = css({ width: '[${widths.rejected}]' })\n` +
      `export const writtenClass = css({ width: '[${widths.written}]' })\n`,
  )
  writeFileSync(
    siblingEntry,
    `import 'virtual:bamboo.css'\n` +
      `import { css } from '../styled-system/css'\n` +
      `export { generation } from './__output-transaction-sibling-${label}'\n` +
      `export const className = css({ width: '[${widths.sibling}]' })\n`,
  )
  writeWatchTrigger(clientTrigger, 'first')
  writeWatchTrigger(siblingTrigger, `export const generation = 'first'`)
  writeIsolatedBambooConfig(configPath, [
    `./src/__output-transaction-client-${label}.tsx`,
    `./src/__output-transaction-sibling-${label}.tsx`,
  ])
  // Before the watchers start, so a late event for one of these writes cannot start a rebuild
  // read as an edit's.
  await settled()

  const builder = (await create({
    root: cwd,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [rejectWriteBeforeBamboo, selectedClientSource, ...bamboocss({ cwd, configPath, reportSummary: false })],
    build: {
      watch: {},
      minify: false,
      emptyOutDir: false,
      rollupOptions: {
        external: [/^react/, /styled-system/],
        output: { plugins: [rejectAfterBamboo] },
      },
    },
    builder: {},
    environments: {
      client: {
        build: {
          emitAssets: true,
          outDir: clientOutDir,
          lib: { entry: clientEntry, formats: ['es'], fileName: `output-transaction-client-${label}` },
        },
      },
      // A second environment serving a sheet of its own, as a browser one does. Vite takes any
      // environment but `client` for a server, whose markup the client's sheet styles.
      sibling: {
        consumer: 'client',
        build: {
          emitAssets: true,
          outDir: siblingOutDir,
          lib: { entry: siblingEntry, formats: ['es'], fileName: `output-transaction-sibling-${label}` },
        },
      },
    },
  })) as TestEnvironmentBuilder

  let clientWatcher: TestBuildWatcher | undefined
  let siblingWatcher: TestBuildWatcher | undefined
  try {
    clientWatcher = (await builder.build(builder.environments.client)) as TestBuildWatcher
    expect(await nextEnvironmentWatchCycle(clientWatcher)).toBeUndefined()
    siblingWatcher = (await builder.build(builder.environments.sibling)) as TestBuildWatcher
    expect(await nextEnvironmentWatchCycle(siblingWatcher)).toBeUndefined()

    const clientJsFiles = readdirSync(clientOutDir).filter((file) => file.endsWith('.js'))
    expect(clientJsFiles).toHaveLength(1)
    const clientJsPath = join(clientOutDir, clientJsFiles[0]!)
    const initialClientJsBytes = readFileSync(clientJsPath)
    const initialClientJs = initialClientJsBytes.toString()
    const initialClientCss = readOutputFiles(clientOutDir, '.css')
    // Both graphs were transformed from scratch. This is the clean accepted output the later
    // sibling-only rebuild must reproduce after the intervening client candidate is rejected.
    const cleanCss = readOutputFiles(siblingOutDir, '.css')
    expect(initialClientJs).toContain(`w_[${widths.old}]`)
    expect(initialClientCss).toContain(widths.old)
    expect(cleanCss).toContain(widths.old)
    expect(cleanCss).toContain(widths.sibling)
    expect(cleanCss).not.toContain(widths.rejected)

    // The hook rejects whatever the client bundle names, so what it rejected says which cycle it
    // was: a late one for the source before the edit is rejected as surely.
    rejectedJs = ''
    rejectedCss = ''
    rejectClientOutput = true
    const rejectedBuild = watchCycleUntil(
      clientWatcher,
      () => rejectedJs.includes(`w_[${widths.rejected}]`),
      'rejecting the client output',
      `test rejected client output (${label})`,
    )
    await new Promise((settle) => setTimeout(settle, 800))
    writeWatchTrigger(clientTrigger, 'second')
    const rejectedError = await rejectedBuild

    expect(rejectedError?.message).toContain(`test rejected client output (${label})`)
    expect(rejectedJs).toContain(`w_[${widths.rejected}]`)
    expect(rejectedJs).not.toContain(`w_[${widths.old}]`)
    expect(rejectedCss).toContain(widths.rejected)
    expect(rejectedCss).not.toContain(widths.old)
    expect(
      readFileSync(clientJsPath).equals(initialClientJsBytes),
      'failed output replaced the previously emitted JavaScript bytes',
    ).toBe(true)
    expect(readOutputFiles(clientOutDir, '.css'), 'failed output replaced the previously emitted stylesheet').toBe(
      initialClientCss,
    )

    // A replayed notification may start the client again: it has run its course before the
    // client's transforms are counted, here and after the sibling's edit.
    await watchersQuiet([clientWatcher, siblingWatcher], 800)
    const clientCallsAfterFailure = calls.client
    const clientStartedAfterFailure = cyclesStartedBy(clientWatcher)
    rmSync(siblingOutDir, { force: true, recursive: true })
    const siblingBuild = watchCycleUntil(
      siblingWatcher,
      () => readOutputFiles(siblingOutDir, '.css') !== '',
      'rebuilding the sibling from its trigger',
    )
    writeWatchTrigger(siblingTrigger, `export const generation = 'second'`)
    expect(await siblingBuild).toBeUndefined()
    await watchersQuiet([clientWatcher, siblingWatcher])
    expect(clientStartedAfterFailure(), 'the sibling-only edit started the rejected client').toBe(0)
    expect(calls.client, 'the sibling-only edit unexpectedly rebuilt the rejected client graph').toBe(
      clientCallsAfterFailure,
    )

    const rebuiltCss = readOutputFiles(siblingOutDir, '.css')
    expect(rebuiltCss).toContain(widths.old)
    expect(rebuiltCss).toContain(widths.sibling)
    expect(rebuiltCss).not.toContain(widths.rejected)
    expect(rebuiltCss, 'cached sibling output disagrees with the clean no-cache build').toBe(cleanCss)
    // Keep the injected failure armed through the sibling assertion. A filesystem watcher may
    // replay a coalesced notification after reporting END; accepting that duplicate would make
    // this fixture publish the candidate whose rollback it is meant to inspect.
    rejectClientOutput = false

    // `writeBundle` is a notification after every output file has been replaced. A peer hook
    // rejecting there makes the watch cycle red but cannot roll those bytes back, so Bamboo must
    // publish the written candidate rather than restoring reachability for files no longer live.
    rejectAfterWrite = true
    const failedAfterWrite = watchCycleUntil(
      clientWatcher,
      () => readOutputFiles(clientOutDir, '.js').includes(`w_[${widths.written}]`),
      'failing after writing the client output',
      `test rejected after writing client output (${label})`,
    )
    await new Promise((settle) => setTimeout(settle, 800))
    writeWatchTrigger(clientTrigger, 'third')
    const writeError = await failedAfterWrite
    rejectAfterWrite = false
    expect(writeError?.message).toContain(`test rejected after writing client output (${label})`)
    expect(readOutputFiles(clientOutDir, '.js')).toContain(`w_[${widths.written}]`)

    await watchersQuiet([clientWatcher, siblingWatcher], 800)
    const clientCallsAfterWrite = calls.client
    const clientStartedAfterWrite = cyclesStartedBy(clientWatcher)
    rmSync(siblingOutDir, { force: true, recursive: true })
    const siblingAfterWrite = watchCycleUntil(
      siblingWatcher,
      () => readOutputFiles(siblingOutDir, '.css') !== '',
      'rebuilding the sibling after the written client output',
    )
    writeWatchTrigger(siblingTrigger, `export const generation = 'third'`)
    expect(await siblingAfterWrite).toBeUndefined()
    await watchersQuiet([clientWatcher, siblingWatcher])
    expect(clientStartedAfterWrite(), 'the sibling-only edit started the client').toBe(0)
    expect(calls.client).toBe(clientCallsAfterWrite)
    const cssAfterWrite = readOutputFiles(siblingOutDir, '.css')
    expect(cssAfterWrite).toContain(widths.written)
    expect(cssAfterWrite).toContain(widths.sibling)
    expect(cssAfterWrite).not.toContain(widths.old)
    expect(cssAfterWrite).not.toContain(widths.rejected)

    // Even a pre/sequential input write hook declared before Bamboo runs after Bamboo's private
    // filesystem observer. Files have already been replaced when writeBundle begins, so the
    // rejected cycle must still publish the class those new bytes name.
    rejectBeforeBambooWrite = true
    const failedBeforeBambooWrite = watchCycleUntil(
      clientWatcher,
      () => readOutputFiles(clientOutDir, '.js').includes(`w_[${widths.old}]`),
      "failing before Bamboo's write observer",
      `test rejected before Bamboo's write observer (${label})`,
    )
    await new Promise((settle) => setTimeout(settle, 800))
    writeWatchTrigger(clientTrigger, 'first')
    const earlyWriteError = await failedBeforeBambooWrite
    rejectBeforeBambooWrite = false
    expect(earlyWriteError?.message).toContain(`test rejected before Bamboo's write observer (${label})`)
    expect(readOutputFiles(clientOutDir, '.js')).toContain(`w_[${widths.old}]`)

    await watchersQuiet([clientWatcher, siblingWatcher], 800)
    const callsAfterEarlyWrite = calls.client
    const clientStartedAfterEarlyWrite = cyclesStartedBy(clientWatcher)
    rmSync(siblingOutDir, { force: true, recursive: true })
    const siblingAfterEarlyWrite = watchCycleUntil(
      siblingWatcher,
      () => readOutputFiles(siblingOutDir, '.css') !== '',
      'rebuilding the sibling after the early-written client output',
    )
    writeWatchTrigger(siblingTrigger, `export const generation = 'fourth'`)
    expect(await siblingAfterEarlyWrite).toBeUndefined()
    await watchersQuiet([clientWatcher, siblingWatcher])
    expect(clientStartedAfterEarlyWrite(), 'the sibling-only edit started the client').toBe(0)
    expect(calls.client).toBe(callsAfterEarlyWrite)
    const cssAfterEarlyWrite = readOutputFiles(siblingOutDir, '.css')
    expect(cssAfterEarlyWrite).toContain(widths.old)
    expect(cssAfterEarlyWrite).toContain(widths.sibling)
    expect(cssAfterEarlyWrite).not.toContain(widths.written)

    // `build.write: false` has no writeBundle and Vite passes the same empty closeBundle argument
    // after success and failure. The final configured output plugin is therefore the commit
    // boundary: a later configured generate hook must prevent the in-memory candidate from
    // becoming the sibling's reachability answer.
    await Promise.all([clientWatcher.close(), siblingWatcher.close()])
    clientWatcher = undefined
    siblingWatcher = undefined
    writeWatchTrigger(clientTrigger, 'first')
    const inMemoryBuilder = (await create({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [selectedClientSource, ...bamboocss({ cwd, configPath, reportSummary: false }), rejectCloseAfterBamboo],
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          external: [/^react/, /styled-system/],
          output: { plugins: [rejectAfterBamboo] },
        },
      },
      builder: {},
      environments: {
        client: {
          build: {
            emitAssets: true,
            lib: { entry: clientEntry, formats: ['es'], fileName: `output-transaction-memory-client-${label}` },
          },
        },
        sibling: {
          consumer: 'client',
          build: {
            emitAssets: true,
            lib: { entry: siblingEntry, formats: ['es'], fileName: `output-transaction-memory-sibling-${label}` },
          },
        },
      },
    })) as TestEnvironmentBuilder

    await inMemoryBuilder.build(inMemoryBuilder.environments.client)
    // `closeBundle` belongs to the input plugin driver in both Rollup and Rolldown; configured
    // output plugins never receive it. Bamboo's commit hook is therefore an ordered input hook.
    expect(configuredOutputCloseCalls).toBe(0)
    writeWatchTrigger(clientTrigger, 'second')
    const buildInMemorySibling = async () => {
      const built = await inMemoryBuilder.build(inMemoryBuilder.environments.sibling)
      return (Array.isArray(built) ? built : [built])
        .flatMap((bundle) => (bundle as { output?: unknown[] }).output ?? [])
        .map((output) => {
          const asset = output as { fileName?: string; source?: unknown }
          return asset.fileName?.endsWith('.css') && typeof asset.source === 'string' ? asset.source : ''
        })
        .join('\n')
    }

    mutateClientCss = true
    await expect(inMemoryBuilder.build(inMemoryBuilder.environments.client)).rejects.toThrow(
      'changed or removed the generated stylesheet',
    )
    mutateClientCss = false
    const afterMutation = await buildInMemorySibling()
    expect(afterMutation).toContain(widths.old)
    expect(afterMutation).not.toContain(widths.rejected)

    rejectOnClose = true
    await expect(inMemoryBuilder.build(inMemoryBuilder.environments.client)).rejects.toThrow(
      `test rejected while closing client output (${label})`,
    )
    rejectOnClose = false
    const afterCloseFailure = await buildInMemorySibling()
    expect(afterCloseFailure).toContain(widths.old)
    expect(afterCloseFailure).not.toContain(widths.rejected)

    rejectClientOutput = true
    await expect(inMemoryBuilder.build(inMemoryBuilder.environments.client)).rejects.toThrow(
      `test rejected client output (${label})`,
    )
    rejectClientOutput = false
    const inMemoryCss = await buildInMemorySibling()
    expect(inMemoryCss).toContain(widths.old)
    expect(inMemoryCss).toContain(widths.sibling)
    expect(inMemoryCss).not.toContain(widths.rejected)
  } finally {
    rejectClientOutput = false
    rejectAfterWrite = false
    rejectBeforeBambooWrite = false
    rejectOnClose = false
    mutateClientCss = false
    await Promise.all([clientWatcher?.close(), siblingWatcher?.close()])
    rmSync(clientEntry, { force: true })
    rmSync(siblingEntry, { force: true })
    rmSync(clientTrigger, { force: true })
    rmSync(siblingTrigger, { force: true })
    rmSync(configPath, { force: true })
    rmSync(clientOutDir, { force: true, recursive: true })
    rmSync(siblingOutDir, { force: true, recursive: true })
  }
}

/**
 * Leave two configured outputs from different generations on disk, then make a sibling emit CSS.
 *
 * Vite writes configured outputs independently. The first can finish before a later output's
 * `generateBundle` hook rejects, so neither restoring the old generation nor publishing only the
 * candidate describes the files users now have. Reachability has to retain both live epochs until
 * a later generation replaces every output.
 */
const runMixedOutputEpochWatchRebuild = async (
  create: (config: Record<string, unknown>) => Promise<unknown>,
  label: string,
  widths: { old: string; candidate: string; replacement: string; sibling: string },
) => {
  const clientEntry = join(cwd, `src/__multi-output-client-${label}.tsx`)
  const siblingEntry = join(cwd, `src/__multi-output-sibling-${label}.tsx`)
  const clientTrigger = join(cwd, `src/__multi-output-client-${label}.txt`)
  const siblingTrigger = join(cwd, `src/__multi-output-sibling-trigger-${label}.ts`)
  const configPath = join(cwd, `__multi-output-${label}.bamboo.config.ts`)
  const firstOutDir = join(cwd, `__multi-output-client-first-${label}-out`)
  const secondOutDir = join(cwd, `__multi-output-client-second-${label}-out`)
  const siblingOutDir = join(cwd, `__multi-output-sibling-${label}-out`)
  const calls = { client: 0 }

  const cssFromBuild = (built: unknown) =>
    (Array.isArray(built) ? built : [built])
      .flatMap((bundle) => (bundle as { output?: unknown[] }).output ?? [])
      .map((output) => {
        const asset = output as { fileName?: string; source?: unknown }
        return asset.fileName?.endsWith('.css') && typeof asset.source === 'string' ? asset.source : ''
      })
      .join('\n')

  const selectedClientSource: VitePlugin = {
    name: `bamboocss:test-multi-output-source-${label}`,
    enforce: 'pre',
    sharedDuringBuild: true,
    transform(_code, id) {
      if (!isModule(id, clientEntry)) return
      calls.client++
      this.addWatchFile(clientTrigger)
      const generation = readFileSync(clientTrigger, 'utf8').trim()
      const width =
        generation === 'first'
          ? widths.old
          : generation === 'replacement-mixed' || generation === 'accepted'
            ? widths.replacement
            : widths.candidate
      return {
        code:
          `import 'virtual:bamboo.css'\n` +
          `import { css } from '../styled-system/css'\n` +
          `export const className = css({ width: '[${width}]' })\n`,
        map: null,
      }
    },
  }

  type FailureMode = 'none' | 'before-write' | 'after-first-write' | 'first-before-second-writes' | 'memory-second'
  let failureMode: FailureMode = 'none'
  let firstOutputWritten = Promise.resolve()
  let markFirstOutputWritten = () => {}
  let rejectedSecondJs = ''
  // What an output rejected before writing held, which says which cycle it was.
  let rejectedEarlyJs = ''
  const armFirstOutput = () => {
    firstOutputWritten = new Promise<void>((resolve) => {
      markFirstOutputWritten = resolve
    })
  }
  const outputPlugin = (output: 1 | 2): VitePlugin => ({
    name: `bamboocss:test-multi-output-${label}-${output}`,
    async generateBundle(_, bundle) {
      const code = () =>
        Object.values(bundle)
          .map((entry) => (entry.type === 'chunk' ? entry.code : ''))
          .join('\n')
      if (failureMode === 'before-write') {
        rejectedEarlyJs = code()
        throw new Error(`test rejected every output before write (${label})`)
      }
      if (failureMode === 'first-before-second-writes' && output === 1) {
        rejectedEarlyJs = code()
        throw new Error(`test rejected first output before second wrote (${label})`)
      }
      if (output !== 2) return
      if (failureMode === 'after-first-write' || failureMode === 'memory-second') {
        if (failureMode === 'after-first-write') await firstOutputWritten
        rejectedSecondJs = Object.values(bundle)
          .map((entry) => (entry.type === 'chunk' ? entry.code : ''))
          .join('\n')
        throw new Error(`test rejected second configured output (${label})`)
      }
    },
    writeBundle() {
      if (output === 1) markFirstOutputWritten()
    },
  })

  const clientOutputs = () => [
    {
      dir: firstOutDir,
      format: 'es',
      entryFileNames: `multi-output-client-${label}.js`,
      assetFileNames: `multi-output-client-${label}.[ext]`,
      plugins: [outputPlugin(1)],
    },
    {
      dir: secondOutDir,
      format: 'cjs',
      entryFileNames: `multi-output-client-${label}.js`,
      assetFileNames: `multi-output-client-${label}.[ext]`,
      plugins: [outputPlugin(2)],
    },
  ]

  writeFileSync(
    clientEntry,
    `import 'virtual:bamboo.css'\n` +
      `import { css } from '../styled-system/css'\n` +
      `export const oldClass = css({ width: '[${widths.old}]' })\n` +
      `export const candidateClass = css({ width: '[${widths.candidate}]' })\n` +
      `export const replacementClass = css({ width: '[${widths.replacement}]' })\n`,
  )
  writeFileSync(
    siblingEntry,
    `import 'virtual:bamboo.css'\n` +
      `import { css } from '../styled-system/css'\n` +
      `export { generation } from './__multi-output-sibling-trigger-${label}'\n` +
      `export const className = css({ width: '[${widths.sibling}]' })\n`,
  )
  writeWatchTrigger(clientTrigger, 'first')
  writeWatchTrigger(siblingTrigger, `export const generation = 'first'`)
  writeIsolatedBambooConfig(configPath, [
    `./src/__multi-output-client-${label}.tsx`,
    `./src/__multi-output-sibling-${label}.tsx`,
  ])
  // Before the watchers start, so a late event for one of these writes cannot start a rebuild
  // read as an edit's.
  await settled()

  const builder = (await create({
    root: cwd,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [selectedClientSource, ...bamboocss({ cwd, configPath, reportSummary: false })],
    build: {
      watch: {},
      minify: false,
      emptyOutDir: false,
      rollupOptions: { external: [/^react/, /styled-system/] },
    },
    builder: {},
    environments: {
      client: {
        build: {
          cssCodeSplit: true,
          emitAssets: true,
          lib: { entry: clientEntry, formats: ['es', 'cjs'], fileName: `multi-output-client-${label}` },
          rollupOptions: { output: clientOutputs() },
        },
      },
      sibling: {
        consumer: 'client',
        build: {
          emitAssets: true,
          outDir: siblingOutDir,
          lib: { entry: siblingEntry, formats: ['es'], fileName: `multi-output-sibling-${label}` },
        },
      },
    },
  })) as TestEnvironmentBuilder

  let clientWatcher: TestBuildWatcher | undefined
  let siblingWatcher: TestBuildWatcher | undefined
  let siblingGeneration = 1
  const rebuildSibling = async () => {
    // Rolldown reports an aggregate output failure while another configured output task can
    // still be finishing, and a replayed notification may start the client again. Both have run
    // their course before measuring whether this sibling-only edit touched the client graph.
    await watchersQuiet([clientWatcher!, siblingWatcher!], 800)
    rmSync(siblingOutDir, { force: true, recursive: true })
    const built = watchCycleUntil(
      siblingWatcher!,
      () => readOutputFiles(siblingOutDir, '.css') !== '',
      'rebuilding the sibling from its trigger',
    )
    const callsBefore = calls.client
    const clientStarted = cyclesStartedBy(clientWatcher!)
    writeWatchTrigger(siblingTrigger, `export const generation = '${++siblingGeneration}'`)
    expect(await built).toBeUndefined()
    await watchersQuiet([clientWatcher!, siblingWatcher!])
    expect(clientStarted(), `${label}: sibling-only edit started the client`).toBe(0)
    expect(calls.client, `${label}: sibling-only edit rebuilt the client graph`).toBe(callsBefore)
    return readOutputFiles(siblingOutDir, '.css')
  }

  try {
    clientWatcher = (await builder.build(builder.environments.client)) as TestBuildWatcher
    expect(await nextEnvironmentWatchCycle(clientWatcher)).toBeUndefined()
    siblingWatcher = (await builder.build(builder.environments.sibling)) as TestBuildWatcher
    expect(await nextEnvironmentWatchCycle(siblingWatcher)).toBeUndefined()

    const initialFirstJs = readOutputFiles(firstOutDir, '.js')
    const initialSecondJs = readOutputFiles(secondOutDir, '.js')
    expect(initialFirstJs).toContain(`w_[${widths.old}]`)
    expect(initialSecondJs).toContain(`w_[${widths.old}]`)
    expect(initialFirstJs).not.toContain(`w_[${widths.candidate}]`)
    expect(initialSecondJs).not.toContain(`w_[${widths.candidate}]`)

    // A generation rejected before either output writes is atomic: only the old epoch remains.
    rejectedEarlyJs = ''
    failureMode = 'before-write'
    const rejectedBeforeWrite = watchCycleUntil(
      clientWatcher,
      () => rejectedEarlyJs.includes(`w_[${widths.candidate}]`),
      'rejecting every output before write',
      `test rejected every output before write (${label})`,
    )
    await new Promise((settle) => setTimeout(settle, 800))
    writeWatchTrigger(clientTrigger, 'before-write')
    expect((await rejectedBeforeWrite)?.message).toContain(`test rejected every output before write (${label})`)
    expect(readOutputFiles(firstOutDir, '.js')).toBe(initialFirstJs)
    expect(readOutputFiles(secondOutDir, '.js')).toBe(initialSecondJs)
    const afterPreWriteFailure = await rebuildSibling()
    failureMode = 'none'
    expect(afterPreWriteFailure).toContain(widths.old)
    expect(afterPreWriteFailure).toContain(widths.sibling)
    expect(afterPreWriteFailure).not.toContain(widths.candidate)

    // Output one reaches disk, then output two rejects. Both generations now name classes in
    // live JavaScript and a sibling stylesheet must conservatively back both.
    failureMode = 'after-first-write'
    const mixedBuild = watchCycleUntil(
      clientWatcher,
      () => readOutputFiles(firstOutDir, '.js').includes(`w_[${widths.candidate}]`),
      'rejecting the second output once the first wrote the candidate',
      `test rejected second configured output (${label})`,
    )
    await new Promise((settle) => setTimeout(settle, 800))
    // Armed as the edit is written, so no late cycle before it can have written the first output.
    armFirstOutput()
    writeWatchTrigger(clientTrigger, 'mixed')
    expect((await mixedBuild)?.message).toContain(`test rejected second configured output (${label})`)
    expect(rejectedSecondJs).toContain(`w_[${widths.candidate}]`)
    expect(readOutputFiles(firstOutDir, '.js')).toContain(`w_[${widths.candidate}]`)
    expect(readOutputFiles(firstOutDir, '.js')).not.toContain(`w_[${widths.old}]`)
    expect(readOutputFiles(secondOutDir, '.js')).toBe(initialSecondJs)

    const mixedCss = await rebuildSibling()
    failureMode = 'none'
    expect(mixedCss).toContain(widths.old)
    expect(mixedCss).toContain(widths.candidate)
    expect(mixedCss).toContain(widths.sibling)

    // A second partial failure replaces the already-written slot. The first candidate no
    // longer exists in either client output and must not accumulate as an immortal epoch.
    failureMode = 'after-first-write'
    const replacementMixedBuild = watchCycleUntil(
      clientWatcher,
      () => readOutputFiles(firstOutDir, '.js').includes(`w_[${widths.replacement}]`),
      'rejecting the second output once the first wrote the replacement',
      `test rejected second configured output (${label})`,
    )
    await new Promise((settle) => setTimeout(settle, 800))
    armFirstOutput()
    writeWatchTrigger(clientTrigger, 'replacement-mixed')
    expect((await replacementMixedBuild)?.message).toContain(`test rejected second configured output (${label})`)
    expect(readOutputFiles(firstOutDir, '.js')).toContain(`w_[${widths.replacement}]`)
    expect(readOutputFiles(firstOutDir, '.js')).not.toContain(`w_[${widths.candidate}]`)
    expect(readOutputFiles(secondOutDir, '.js')).toBe(initialSecondJs)
    const replacementMixedCss = await rebuildSibling()
    failureMode = 'none'
    expect(replacementMixedCss).toContain(widths.old)
    expect(replacementMixedCss).toContain(widths.replacement)
    expect(replacementMixedCss).toContain(widths.sibling)
    expect(replacementMixedCss).not.toContain(widths.candidate)

    // Alternate the failed slot: slot zero never reaches disk, while slot one does. Rolldown
    // runs each configured output as its own build task, so a stale "slot zero succeeded" bit
    // from the preceding generation must not combine with this slot-one success. The disk now
    // genuinely contains two candidate epochs and the sibling must retain exactly those two.
    rejectedEarlyJs = ''
    failureMode = 'first-before-second-writes'
    const alternatingBuild = watchCycleUntil(
      clientWatcher,
      () => rejectedEarlyJs.includes(`w_[${widths.candidate}]`),
      'rejecting the first output before the second wrote',
      `test rejected first output before second wrote (${label})`,
    )
    await new Promise((settle) => setTimeout(settle, 800))
    writeWatchTrigger(clientTrigger, 'alternating')
    expect((await alternatingBuild)?.message).toContain(`test rejected first output before second wrote (${label})`)
    // Both hosts report the aggregate error before the still-running second output finishes.
    // Wait for it to reach disk, as this edit wrote it, so the assertions compare stable live slots
    // to disk: a late cycle's write may have come first.
    await until(
      () => readOutputFiles(secondOutDir, '.js').includes(`w_[${widths.candidate}]`),
      'the second output written with the candidate',
    )
    expect(readOutputFiles(firstOutDir, '.js')).toContain(`w_[${widths.replacement}]`)
    expect(readOutputFiles(secondOutDir, '.js')).toContain(`w_[${widths.candidate}]`)
    const alternatingCss = await rebuildSibling()
    failureMode = 'none'
    expect(alternatingCss).not.toContain(widths.old)
    expect(alternatingCss).toContain(widths.candidate)
    expect(alternatingCss).toContain(widths.replacement)
    expect(alternatingCss).toContain(widths.sibling)

    // A later successful generation replaces both configured outputs, collapsing the live set
    // back to one epoch and reproducing a clean no-cache stylesheet exactly.
    const acceptedBuild = watchCycleUntil(
      clientWatcher,
      () => readOutputFiles(firstOutDir, '.js').includes(`w_[${widths.replacement}]`),
      'accepting both outputs',
    )
    await new Promise((settle) => setTimeout(settle, 800))
    writeWatchTrigger(clientTrigger, 'accepted')
    expect(await acceptedBuild).toBeUndefined()
    await until(
      () => readOutputFiles(secondOutDir, '.js').includes(`w_[${widths.replacement}]`),
      'the second output written with the replacement',
    )
    expect(readOutputFiles(firstOutDir, '.js')).toContain(`w_[${widths.replacement}]`)
    expect(readOutputFiles(secondOutDir, '.js')).toContain(`w_[${widths.replacement}]`)
    const convergedCss = await rebuildSibling()
    expect(convergedCss).not.toContain(widths.old)
    expect(convergedCss).not.toContain(widths.candidate)
    expect(convergedCss).toContain(widths.replacement)
    expect(convergedCss).toContain(widths.sibling)

    // The clean and in-memory controls below own separate plugin instances. Stop the two
    // filesystem watchers before reusing their trigger paths so no queued retry can race those
    // controls or publish after the assertions above.
    await Promise.all([clientWatcher.close(), siblingWatcher.close()])
    clientWatcher = undefined
    siblingWatcher = undefined

    const cleanBuilder = (await create({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [selectedClientSource, ...bamboocss({ cwd, configPath, reportSummary: false })],
      build: { write: false, minify: false, rollupOptions: { external: [/^react/, /styled-system/] } },
      builder: {},
      environments: {
        client: {
          build: {
            emitAssets: true,
            lib: { entry: clientEntry, formats: ['es'], fileName: `multi-output-clean-client-${label}` },
          },
        },
        sibling: {
          consumer: 'client',
          build: {
            emitAssets: true,
            lib: { entry: siblingEntry, formats: ['es'], fileName: `multi-output-clean-sibling-${label}` },
          },
        },
      },
    })) as TestEnvironmentBuilder
    await cleanBuilder.build(cleanBuilder.environments.client)
    const cleanCss = cssFromBuild(await cleanBuilder.build(cleanBuilder.environments.sibling))
    expect(convergedCss.trim(), `${label}: converged watcher CSS differs from a clean build`).toBe(cleanCss.trim())

    // In-memory multi-output builds expose nothing when the aggregate build rejects. A first
    // generated result must not become a live epoch merely because its own output hooks passed.
    writeWatchTrigger(clientTrigger, 'first')
    const memoryBuilder = (await create({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [selectedClientSource, ...bamboocss({ cwd, configPath, reportSummary: false })],
      build: { write: false, minify: false, rollupOptions: { external: [/^react/, /styled-system/] } },
      builder: {},
      environments: {
        client: {
          build: {
            emitAssets: true,
            lib: { entry: clientEntry, formats: ['es'], fileName: `multi-output-memory-client-${label}` },
            rollupOptions: { output: clientOutputs().map(({ dir: _dir, ...output }) => output) },
          },
        },
        sibling: {
          consumer: 'client',
          build: {
            emitAssets: true,
            lib: { entry: siblingEntry, formats: ['es'], fileName: `multi-output-memory-sibling-${label}` },
          },
        },
      },
    })) as TestEnvironmentBuilder
    await memoryBuilder.build(memoryBuilder.environments.client)
    writeWatchTrigger(clientTrigger, 'memory-candidate')
    failureMode = 'memory-second'
    await expect(memoryBuilder.build(memoryBuilder.environments.client)).rejects.toThrow(
      `test rejected second configured output (${label})`,
    )
    failureMode = 'none'
    const memoryCss = cssFromBuild(await memoryBuilder.build(memoryBuilder.environments.sibling))
    expect(memoryCss).toContain(widths.old)
    expect(memoryCss).toContain(widths.sibling)
    expect(memoryCss).not.toContain(widths.candidate)
  } finally {
    failureMode = 'none'
    markFirstOutputWritten()
    await Promise.all([clientWatcher?.close(), siblingWatcher?.close()])
    rmSync(clientEntry, { force: true })
    rmSync(siblingEntry, { force: true })
    rmSync(clientTrigger, { force: true })
    rmSync(siblingTrigger, { force: true })
    rmSync(configPath, { force: true })
    rmSync(firstOutDir, { force: true, recursive: true })
    rmSync(secondOutDir, { force: true, recursive: true })
    rmSync(siblingOutDir, { force: true, recursive: true })
  }
}

/**
 * Remove an old atom from physical extraction while one configured JS output still names it.
 *
 * The sibling owns the stylesheet. Its replacement must fail before write while the client has
 * mixed live output slots, then converge once both slots publish the new generation.
 */
const runRemovedLiveRuleWatchRebuild = async (
  create: (config: Record<string, unknown>) => Promise<unknown>,
  label: string,
  widths: { old: string; replacement: string; sibling: string },
  pruneCss = true,
) => {
  const clientEntry = join(cwd, `src/__removed-live-rule-client-${label}.tsx`)
  const clientTrigger = join(cwd, `src/__removed-live-rule-client-trigger-${label}.ts`)
  const siblingEntry = join(cwd, `src/__removed-live-rule-sibling-${label}.tsx`)
  const siblingTrigger = join(cwd, `src/__removed-live-rule-sibling-trigger-${label}.ts`)
  const configPath = join(cwd, `__removed-live-rule-${label}.bamboo.config.ts`)
  const firstOutDir = join(cwd, `__removed-live-rule-first-${label}-out`)
  const secondOutDir = join(cwd, `__removed-live-rule-second-${label}-out`)
  const siblingOutDir = join(cwd, `__removed-live-rule-sibling-${label}-out`)

  const clientSource = (width: string) =>
    `import { css } from '../styled-system/css'\n` +
    `export { generation } from './__removed-live-rule-client-trigger-${label}'\n` +
    `export const className = css({ width: '[${width}]' })\n`
  const siblingSource =
    `import 'virtual:bamboo.css'\n` +
    `import { css } from '../styled-system/css'\n` +
    `export { generation } from './__removed-live-rule-sibling-trigger-${label}'\n` +
    `export const className = css({ width: '[${widths.sibling}]' })\n`
  const cssFromBuild = (built: unknown) =>
    (Array.isArray(built) ? built : [built])
      .flatMap((bundle) => (bundle as { output?: unknown[] }).output ?? [])
      .map((output) => {
        const asset = output as { fileName?: string; source?: unknown }
        return asset.fileName?.endsWith('.css') && typeof asset.source === 'string' ? asset.source : ''
      })
      .join('\n')
  const outputSnapshot = (directory: string) =>
    Object.fromEntries(
      (existsSync(directory) ? readdirSync(directory) : [])
        .sort()
        .map((file) => [file, readFileSync(join(directory, file), 'utf8')]),
    )

  let rejectOneOutput = false
  // Only a build of the edit is the mixed one. A rebuild of the source as it was, which a late
  // watch event or the shared plugin can start while the rejection is armed, leaves the state
  // below alone: run through it, one rejected an output of the old source, and its written output
  // released the sibling before the edit's had reached disk.
  const buildsReplacement = (bundle: Record<string, unknown>) =>
    Object.values(bundle).some((chunk) => {
      const { code } = chunk as { code?: unknown }
      return typeof code === 'string' && code.includes(`w_[${widths.replacement}]`)
    })
  let rejectedOutput: 1 | 2 | undefined
  let firstOutputWritten = Promise.resolve()
  let markFirstOutputWritten = () => {}
  const armFirstOutput = () => {
    rejectedOutput = undefined
    firstOutputWritten = new Promise<void>((resolveFirstOutput) => {
      markFirstOutputWritten = resolveFirstOutput
    })
  }
  let siblingMayBuild = Promise.resolve()
  let releaseSibling = () => {}
  const holdSibling = () => {
    siblingMayBuild = new Promise<void>((resolveSibling) => {
      releaseSibling = resolveSibling
    })
  }

  const outputPlugin = (output: 1 | 2): VitePlugin => ({
    name: `bamboocss:test-removed-live-rule-output-${label}-${output}`,
    async generateBundle(_options, bundle) {
      if (!rejectOneOutput || !buildsReplacement(bundle)) return
      // Rolldown runs configured outputs as separate tasks and does not promise their order.
      // Let whichever task starts first reach disk, then reject the other one. Waiting for a
      // designated output deadlocks when the scheduler happens to start the waiter first.
      if (rejectedOutput === undefined) {
        rejectedOutput = output === 1 ? 2 : 1
        return
      }
      if (output !== rejectedOutput) return
      await firstOutputWritten
      releaseSibling()
      throw new Error(`test rejected removed-rule output ${output} (${label})`)
    },
    writeBundle(_options, bundle) {
      if (rejectOneOutput && output !== rejectedOutput && buildsReplacement(bundle)) markFirstOutputWritten()
    },
  })
  const siblingBarrier: VitePlugin = {
    name: `bamboocss:test-removed-live-rule-sibling-barrier-${label}`,
    enforce: 'pre',
    sharedDuringBuild: true,
    async buildStart() {
      if (this.environment.name === 'sibling') await siblingMayBuild
    },
  }
  const clientOutputs = () => [
    {
      dir: firstOutDir,
      format: 'es',
      entryFileNames: `removed-live-rule-client-${label}.js`,
      plugins: [outputPlugin(1)],
    },
    {
      dir: secondOutDir,
      format: 'cjs',
      entryFileNames: `removed-live-rule-client-${label}.js`,
      plugins: [outputPlugin(2)],
    },
  ]

  writeFileSync(clientEntry, clientSource(widths.old))
  writeFileSync(clientTrigger, `export const generation = 'first'\n`)
  writeFileSync(siblingEntry, siblingSource)
  writeFileSync(siblingTrigger, `export const generation = 'first'\n`)
  writeIsolatedBambooConfig(configPath, [
    `./src/__removed-live-rule-sibling-${label}.tsx`,
    `./src/__removed-live-rule-client-${label}.tsx`,
  ])
  // Before the watchers start. The writes above can still be reported to them, and a rebuild one
  // sets off, under way when the next cycle is awaited, ended that cycle without the rejection
  // this arms: the build it awaited was not the one the edit below makes. 2 runs of the suite in 6.
  await settled()

  const createConfig = (watch: boolean) => ({
    root: cwd,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [siblingBarrier, ...bamboocss({ cwd, configPath, pruneCss, reportSummary: false })],
    build: {
      ...(watch ? { watch: {} } : { write: false }),
      minify: false,
      emptyOutDir: false,
      rollupOptions: { external: [/^react/, /styled-system/] },
    },
    builder: {},
    environments: {
      client: {
        build: {
          emitAssets: false,
          lib: { entry: clientEntry, formats: ['es', 'cjs'], fileName: `removed-live-rule-client-${label}` },
          ...(watch ? { rollupOptions: { output: clientOutputs() } } : {}),
        },
      },
      sibling: {
        consumer: 'client',
        build: {
          emitAssets: true,
          outDir: siblingOutDir,
          lib: { entry: siblingEntry, formats: ['es'], fileName: `removed-live-rule-sibling-${label}` },
          rollupOptions: { output: { assetFileNames: `removed-live-rule-sibling-${label}.[ext]` } },
        },
      },
    },
  })

  const builder = (await create(createConfig(true))) as TestEnvironmentBuilder
  let clientWatcher: TestBuildWatcher | undefined
  let siblingWatcher: TestBuildWatcher | undefined
  let convergedCss = ''
  try {
    clientWatcher = (await builder.build(builder.environments.client)) as TestBuildWatcher
    expect(await nextEnvironmentWatchCycle(clientWatcher)).toBeUndefined()
    siblingWatcher = (await builder.build(builder.environments.sibling)) as TestBuildWatcher
    expect(await nextEnvironmentWatchCycle(siblingWatcher)).toBeUndefined()

    const initialFirstJs = readOutputFiles(firstOutDir, '.js')
    const initialSecondJs = readOutputFiles(secondOutDir, '.js')
    const initialSiblingOutput = outputSnapshot(siblingOutDir)
    const initialCss = readOutputFiles(siblingOutDir, '.css')
    expect(initialFirstJs).toContain(`w_[${widths.old}]`)
    expect(initialSecondJs).toContain(`w_[${widths.old}]`)
    expect(initialCss).toContain(widths.old)
    expect(initialCss).not.toContain(widths.replacement)

    // The physical source now contains only NEW. One output reaches disk before the other
    // rejects, while the sibling stylesheet generation is held until that mixed state exists.
    armFirstOutput()
    holdSibling()
    rejectOneOutput = true
    const replacementJs = (directory: string) => readOutputFiles(directory, '.js').includes(`w_[${widths.replacement}]`)
    // Either fails the run below: a mixed edit both outputs took, or a sheet replaced under it.
    const mixedClientBuild = watchCycleUntil(
      clientWatcher,
      () => replacementJs(firstOutDir) && replacementJs(secondOutDir),
      'building the replacement width',
    )
    const rejectedSiblingBuild = watchCycleUntil(
      siblingWatcher,
      () => readOutputFiles(siblingOutDir, '.css').includes(widths.replacement),
      'refusing the sibling stylesheet',
    )
    await new Promise((settle) => setTimeout(settle, 800))
    writeFileSync(clientEntry, clientSource(widths.replacement))

    expect((await mixedClientBuild)?.message).toContain(`test rejected removed-rule output`)
    const siblingError = await rejectedSiblingBuild
    const writtenOutDir = rejectedOutput === 1 ? secondOutDir : firstOutDir
    const rejectedOutDir = rejectedOutput === 1 ? firstOutDir : secondOutDir
    const rejectedInitialJs = rejectedOutput === 1 ? initialFirstJs : initialSecondJs
    expect(readOutputFiles(writtenOutDir, '.js')).toContain(`w_[${widths.replacement}]`)
    expect(readOutputFiles(writtenOutDir, '.js')).not.toContain(`w_[${widths.old}]`)
    expect(readOutputFiles(rejectedOutDir, '.js')).toBe(rejectedInitialJs)
    expect(siblingError?.message).toContain(esc(`w_[${widths.old}]`))
    expect(siblingError?.message).toContain('sibling')
    expect(siblingError?.message).toContain('source generation')
    expect(outputSnapshot(siblingOutDir), `${label}: rejected sheet replaced the prior output`).toEqual(
      initialSiblingOutput,
    )

    // Once both configured outputs move to NEW, no live JavaScript names OLD and the same
    // physical extraction is safe to publish.
    rejectOneOutput = false
    releaseSibling()
    const secondGeneration = (directory: string) => readOutputFiles(directory, '.js').includes('"second"')
    const acceptedClientBuild = watchCycleUntil(
      clientWatcher,
      () => secondGeneration(firstOutDir) && secondGeneration(secondOutDir),
      'publishing the client trigger edit',
    )
    await new Promise((settle) => setTimeout(settle, 800))
    writeFileSync(clientTrigger, `export const generation = 'second'\n`)
    expect(await acceptedClientBuild).toBeUndefined()
    expect(readOutputFiles(firstOutDir, '.js')).toContain(`w_[${widths.replacement}]`)
    expect(readOutputFiles(secondOutDir, '.js')).toContain(`w_[${widths.replacement}]`)
    expect(readOutputFiles(firstOutDir, '.js')).not.toContain(`w_[${widths.old}]`)
    expect(readOutputFiles(secondOutDir, '.js')).not.toContain(`w_[${widths.old}]`)

    const acceptedSiblingBuild = watchCycleUntil(
      siblingWatcher,
      () => secondGeneration(siblingOutDir),
      'publishing the sibling trigger edit',
    )
    await new Promise((settle) => setTimeout(settle, 800))
    writeFileSync(siblingTrigger, `export const generation = 'second'\n`)
    expect(await acceptedSiblingBuild).toBeUndefined()
    convergedCss = readOutputFiles(siblingOutDir, '.css')
    expect(convergedCss).toContain(widths.replacement)
    expect(convergedCss).toContain(widths.sibling)
    expect(convergedCss).not.toContain(widths.old)

    await Promise.all([clientWatcher.close(), siblingWatcher.close()])
    clientWatcher = undefined
    siblingWatcher = undefined

    const cleanBuilder = (await create(createConfig(false))) as TestEnvironmentBuilder
    await cleanBuilder.build(cleanBuilder.environments.client)
    const cleanCss = cssFromBuild(await cleanBuilder.build(cleanBuilder.environments.sibling))
    expect(convergedCss.trim(), `${label}: converged sheet differs from a clean accepted build`).toBe(cleanCss.trim())
  } finally {
    rejectOneOutput = false
    markFirstOutputWritten()
    releaseSibling()
    await Promise.all([clientWatcher?.close(), siblingWatcher?.close()])
    rmSync(clientEntry, { force: true })
    rmSync(clientTrigger, { force: true })
    rmSync(siblingEntry, { force: true })
    rmSync(siblingTrigger, { force: true })
    rmSync(configPath, { force: true })
    rmSync(firstOutDir, { force: true, recursive: true })
    rmSync(secondOutDir, { force: true, recursive: true })
    rmSync(siblingOutDir, { force: true, recursive: true })
  }
}

/**
 * Rebuild the client while SSR is replacing its output, from an edit to a module only SSR imports:
 * the client rebuilds too, as its stylesheet watches every extracted file.
 *
 * SSR's old output still counted as complete, so the client's sheet was pruned against it and
 * written as final: a class new to the extraction shipped with no rule, and one extracted before
 * and pruned failed SSR's guard on the client's old losses though the client's rebuild could keep
 * it. The sheet is held now while SSR replaces its output, and pruned again once SSR's output is
 * written — or, when SSR's replacement fails, once its old output is back, to the same bytes.
 */
const runSiblingReplacementWatchRebuild = async (
  create: (config: Record<string, unknown>) => Promise<unknown>,
  label: string,
  shape: 'a new class' | 'a class extracted before' | 'a failed replacement',
) => {
  const widths = { client: '77.0px', kept: '77.2px', fresh: '77.1px', pruned: '77.3px' }
  const clientEntry = join(cwd, `src/__sibling-client-${label}.tsx`)
  const ssrEntry = join(cwd, `src/__sibling-ssr-${label}.tsx`)
  const serverOnly = join(cwd, `src/__sibling-server-${label}.tsx`)
  const unused = join(cwd, `src/__sibling-unused-${label}.tsx`)
  const ssrTrigger = join(cwd, `src/__sibling-ssr-trigger-${label}.txt`)
  const configPath = join(cwd, `__sibling-${label}.bamboo.config.ts`)
  const clientOutDir = join(cwd, `__sibling-client-${label}-out`)
  const ssrOutDir = join(cwd, `__sibling-ssr-${label}-out`)
  rmSync(clientOutDir, { force: true, recursive: true })
  rmSync(ssrOutDir, { force: true, recursive: true })

  let holding: Promise<void> | undefined
  let release = () => {}
  let failSsr = false
  const sibling: VitePlugin = {
    name: `bamboocss:test-sibling-replacement-${label}`,
    enforce: 'pre',
    sharedDuringBuild: true,
    async transform(code, id) {
      if (this.environment.name !== 'ssr') return
      if (isModule(id, serverOnly)) {
        // Held until the client's cycle has ended, so SSR is replacing its output throughout.
        if (holding) await holding
        // Failed for the whole round, not only in the build held: a watcher can see the one write
        // twice, and a second build, held by nothing, replaced SSR's output after all.
        if (failSsr) throw new Error(`SSR replacement failed by a test plugin (${label})`)
      }
      // An edit only SSR sees: its entry starts using a class the client's sheet pruned.
      if (isModule(id, ssrEntry)) {
        this.addWatchFile(ssrTrigger)
        if (readFileSync(ssrTrigger, 'utf8').trim() === 'pruned') {
          return { code: `${code}export { pruned } from './__sibling-unused-${label}'\n`, map: null }
        }
      }
    },
  }

  const server = (...widthsUsed: string[]) =>
    `import { css } from '../styled-system/css'\n` +
    widthsUsed.map((width, index) => `export const s${index} = css({ width: '[${width}]' })\n`).join('')
  writeFileSync(
    clientEntry,
    `import 'virtual:bamboo.css'\nimport { css } from '../styled-system/css'\nexport const client = css({ width: '[${widths.client}]' })\n`,
  )
  writeFileSync(ssrEntry, `export * from './__sibling-server-${label}'\n`)
  writeFileSync(serverOnly, server(widths.kept))
  // Extracted, and reached by nothing at first: every sheet prunes it.
  writeFileSync(
    unused,
    `import { css } from '../styled-system/css'\nexport const pruned = css({ width: '[${widths.pruned}]' })\n`,
  )
  writeWatchTrigger(ssrTrigger, 'first')
  writeIsolatedBambooConfig(configPath, [
    `./src/__sibling-client-${label}.tsx`,
    `./src/__sibling-ssr-${label}.tsx`,
    `./src/__sibling-server-${label}.tsx`,
    `./src/__sibling-unused-${label}.tsx`,
  ])
  await settled()

  const builder = (await create({
    root: cwd,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [sibling, bamboocss({ cwd, configPath, reportSummary: false })],
    build: { watch: {}, minify: false, emptyOutDir: false, rollupOptions: { external: [/^react/] } },
    builder: {},
    environments: {
      client: {
        build: {
          outDir: clientOutDir,
          lib: { entry: clientEntry, formats: ['es'], fileName: `sibling-client-${label}` },
        },
      },
      ssr: {
        build: {
          ssr: true,
          outDir: ssrOutDir,
          lib: { entry: ssrEntry, formats: ['es'], fileName: `sibling-ssr-${label}` },
        },
      },
    },
  })) as TestEnvironmentBuilder

  let clientWatcher: TestBuildWatcher | undefined
  let ssrWatcher: TestBuildWatcher | undefined
  const clientSheets = () => readdirSync(clientOutDir).filter((file) => file.endsWith('.css'))
  try {
    clientWatcher = (await builder.build(builder.environments.client)) as TestBuildWatcher
    expect(await nextEnvironmentWatchBuild(clientWatcher)).toBeUndefined()
    ssrWatcher = (await builder.build(builder.environments.ssr)) as TestBuildWatcher
    expect(await nextEnvironmentWatchBuild(ssrWatcher)).toBeUndefined()
    await watchersQuiet([clientWatcher, ssrWatcher])
    expect(readOutputFiles(clientOutDir, '.css')).not.toContain(widths.pruned)

    // The edit both rebuild for, SSR held until the client's cycle has ended.
    holding = new Promise<void>((resolve) => {
      release = resolve
    })
    failSsr = shape === 'a failed replacement'
    rmSync(clientOutDir, { force: true, recursive: true })
    const rebuiltClient = watchCycleUntil(
      clientWatcher,
      () => existsSync(clientOutDir) && clientSheets().length > 0,
      'rebuilding the client from the edit',
    )
    const rebuiltSsr = watchCycleUntil(
      ssrWatcher,
      () => true,
      'rebuilding SSR from the edit',
      failSsr ? 'SSR replacement failed by a test plugin' : undefined,
    )
    await new Promise((settle) => setTimeout(settle, 800))
    const clientBuilds = cyclesStartedBy(clientWatcher)
    const ssrBuilds = cyclesStartedBy(ssrWatcher)
    if (shape === 'a class extracted before') {
      writeFileSync(serverOnly, `${server(widths.kept)}export { pruned } from './__sibling-unused-${label}'\n`)
    } else {
      writeFileSync(serverOnly, server(widths.kept, widths.fresh))
    }
    expect(await rebuiltClient).toBeUndefined()
    release()
    holding = undefined
    const ssrError = await rebuiltSsr
    await watchersQuiet([clientWatcher, ssrWatcher])
    failSsr = false

    // Pruned again from source once SSR's replacement was settled, and renamed only if that
    // restored a rule, the sheet it replaces gone: one sheet a client build. A watcher can see one
    // write twice, and a second build's sheet is written beside the first's, as Vite leaves every
    // asset of an output it does not empty; the newest is the one its output is.
    const builds = clientBuilds()
    const rounds = `${builds} client and ${ssrBuilds()} SSR build(s)`
    expect(clientSheets().length).toBeGreaterThanOrEqual(1)
    expect(clientSheets().length).toBeLessThanOrEqual(Math.max(builds, 1))
    const css = clientSheets()
      .map((file) => join(clientOutDir, file))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
      .map((path) => readFileSync(path, 'utf8'))[0]!
    if (shape === 'a failed replacement') {
      expect(ssrError?.message).toContain('SSR replacement failed by a test plugin')
      expect(css, rounds).not.toContain(widths.fresh)

      // Nothing is left held: an SSR-only rebuild newly using a class the client's sheet pruned
      // fails, as one does with no sibling replacing.
      const failedSsr = watchCycleUntil(
        ssrWatcher,
        () => true,
        'rebuilding SSR alone',
        'already pruned out of a stylesheet',
      )
      await new Promise((settle) => setTimeout(settle, 800))
      writeWatchTrigger(ssrTrigger, 'pruned')
      expect((await failedSsr)?.message).toContain(esc(`w_[${widths.pruned}]`))
      await watchersQuiet([clientWatcher, ssrWatcher])
    } else {
      expect(ssrError).toBeUndefined()
      const used = shape === 'a new class' ? widths.fresh : widths.pruned
      expect(readOutputFiles(ssrOutDir, '.js')).toContain(`w_[${used}]`)
      expect(css).toContain(`.${esc(`w_[${used}]`)}`)
    }
  } finally {
    release()
    await Promise.all([clientWatcher?.close(), ssrWatcher?.close()])
    for (const file of [clientEntry, ssrEntry, serverOnly, unused, ssrTrigger, configPath])
      rmSync(file, { force: true })
    rmSync(clientOutDir, { force: true, recursive: true })
    rmSync(ssrOutDir, { force: true, recursive: true })
  }
}

/**
 * Rebuild both environment watchers while one generation is deliberately held after
 * `buildStart`.
 *
 * A completed generation leaves one contribution per environment. On the next edit both
 * environments open replacements at once, but the fast one can reach `buildEnd` while the
 * other has not loaded its graph — including the client's virtual stylesheet — yet. Merely
 * starting that delayed generation must not make the fast environment treat the whole run as
 * complete.
 */
const runConcurrentEnvironmentWatchRebuild = async (
  create: (config: Record<string, unknown>) => Promise<unknown>,
  label: string,
  widths: { client: string; ssr: string },
) => {
  const clientEntry = join(cwd, `src/__concurrent-generation-client-${label}.tsx`)
  const ssrEntry = join(cwd, `src/__concurrent-generation-ssr-${label}.tsx`)
  const trigger = join(cwd, `src/__concurrent-generation-trigger-${label}.ts`)
  const configPath = join(cwd, `__concurrent-generation-${label}.bamboo.config.ts`)
  const clientOutDir = join(cwd, `__concurrent-generation-client-${label}-out`)
  const ssrOutDir = join(cwd, `__concurrent-generation-ssr-${label}-out`)
  const buildStarts = { client: 0, ssr: 0 }

  type EnvironmentName = keyof typeof buildStarts
  let delayedEnvironment: EnvironmentName | undefined
  let releaseDelayed = () => {}
  let markDelayedStarted = () => {}
  let delayedStarted = Promise.resolve()

  const armDelay = (environment: EnvironmentName) => {
    delayedEnvironment = environment
    delayedStarted = new Promise<void>((resolve) => {
      markDelayedStarted = resolve
    })
    const wait = new Promise<void>((resolve) => {
      releaseDelayed = resolve
    })
    return wait
  }

  const delayGeneration: VitePlugin = {
    name: `bamboocss:test-delay-concurrent-generation-${label}`,
    sharedDuringBuild: true,
    buildStart: {
      order: 'post',
      async handler() {
        const environment = this.environment.name as EnvironmentName
        buildStarts[environment]++
        if (buildStarts[environment] === 1 || !delayedEnvironment) return
        if (environment !== delayedEnvironment) {
          // Do not let the fast graph finish before the delayed watcher has actually opened its
          // replacement generation. The production race exists only after both buildStart hooks.
          await delayedStarted
          return
        }
        markDelayedStarted()
        await armWait
      },
    },
  }
  let armWait = Promise.resolve()

  writeFileSync(trigger, `export const generation = 'first'\n`)
  writeFileSync(
    clientEntry,
    `import 'virtual:bamboo.css'\n` +
      `import { css } from '../styled-system/css'\n` +
      `export { generation } from './__concurrent-generation-trigger-${label}'\n` +
      `export const className = css({ width: '[${widths.client}]' })\n`,
  )
  writeFileSync(
    ssrEntry,
    `import { css } from '../styled-system/css'\n` +
      `export { generation } from './__concurrent-generation-trigger-${label}'\n` +
      `export const className = css({ width: '[${widths.ssr}]' })\n`,
  )
  writeIsolatedBambooConfig(configPath, [
    `./src/__concurrent-generation-client-${label}.tsx`,
    `./src/__concurrent-generation-ssr-${label}.tsx`,
  ])

  const bambooPlugins = bamboocss({ cwd, configPath, reportSummary: false })
  const builder = (await create({
    root: cwd,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [...bambooPlugins, delayGeneration],
    build: {
      watch: {},
      minify: false,
      emptyOutDir: false,
      rollupOptions: { external: [/^react/, /styled-system/] },
    },
    builder: {},
    environments: {
      client: {
        build: {
          outDir: clientOutDir,
          lib: { entry: clientEntry, formats: ['es'], fileName: `concurrent-generation-client-${label}` },
        },
      },
      ssr: {
        build: {
          ssr: true,
          outDir: ssrOutDir,
          lib: { entry: ssrEntry, formats: ['es'], fileName: `concurrent-generation-ssr-${label}` },
        },
      },
    },
  })) as TestEnvironmentBuilder

  let clientWatcher: TestBuildWatcher | undefined
  let ssrWatcher: TestBuildWatcher | undefined
  const rebuildWith = async (environment: EnvironmentName, generation: string) => {
    armWait = armDelay(environment)
    rmSync(clientOutDir, { force: true, recursive: true })
    const clientBuild = nextEnvironmentWatchBuild(clientWatcher!)
    const ssrBuild = nextEnvironmentWatchBuild(ssrWatcher!)
    await new Promise((settle) => setTimeout(settle, 800))
    writeFileSync(trigger, `export const generation = '${generation}'\n`)
    await delayedStarted

    const fastBuild = environment === 'client' ? ssrBuild : clientBuild
    const delayedBuild = environment === 'client' ? clientBuild : ssrBuild
    const fastError = await fastBuild
    releaseDelayed()
    const delayedError = await delayedBuild
    delayedEnvironment = undefined

    expect(fastError, `${label}: the fast environment rejected an incomplete shared generation`).toBeUndefined()
    expect(delayedError, `${label}: the delayed environment did not finish after release`).toBeUndefined()
    const css = existsSync(clientOutDir)
      ? readdirSync(clientOutDir)
          .filter((file) => file.endsWith('.css'))
          .map((file) => readFileSync(join(clientOutDir, file), 'utf8'))
          .join('\n')
      : ''
    expect(css, `${label}: the completed client generation emitted no Bamboo stylesheet`).toContain(
      '--made-with-bamboo',
    )
    expect(css, `${label}: the emitted stylesheet lost the client class`).toContain(widths.client)
    expect(css, `${label}: the emitted stylesheet lost the committed SSR class`).toContain(widths.ssr)
  }

  try {
    ssrWatcher = (await builder.build(builder.environments.ssr)) as TestBuildWatcher
    expect(await nextEnvironmentWatchBuild(ssrWatcher)).toBeUndefined()
    clientWatcher = (await builder.build(builder.environments.client)) as TestBuildWatcher
    expect(await nextEnvironmentWatchBuild(clientWatcher)).toBeUndefined()
    expect(buildStarts).toEqual({ client: 1, ssr: 1 })

    // This is the original failure order: SSR reaches the whole-run guard while the client is
    // between buildStart and loading `virtual:bamboo.css`.
    await rebuildWith('client', 'second')
    // The inverse order proves completion belongs to generations rather than to a preferred
    // environment or fixed client-first schedule.
    await rebuildWith('ssr', 'third')
    // Rolldown may coalesce the two filesystem writes differently and schedule an additional
    // no-op generation. The barriers above prove both named generations participated; an exact
    // cumulative hook count is not portable between its watcher and Rollup's.
    expect(buildStarts.client).toBeGreaterThanOrEqual(3)
    expect(buildStarts.ssr).toBeGreaterThanOrEqual(3)
  } finally {
    releaseDelayed()
    await Promise.all([clientWatcher?.close(), ssrWatcher?.close()])
    rmSync(clientEntry, { force: true })
    rmSync(ssrEntry, { force: true })
    rmSync(trigger, { force: true })
    rmSync(configPath, { force: true })
    rmSync(clientOutDir, { force: true, recursive: true })
    rmSync(ssrOutDir, { force: true, recursive: true })
  }
}

describe.sequential('two build environments, one plugin instance', () => {
  beforeEach(() => {
    // The client also declares a recipe variant nothing selects, so a build can be asked
    // whether pruning ran at all rather than only whether it took too much.
    writeFileSync(
      envClientEntry,
      `import 'virtual:bamboo.css'\n` +
        `import { css, cva } from '../styled-system/css'\n` +
        `const box = cva({ variants: { state: { on: { height: '[31.5px]' }, off: { height: '[31.7px]' } } } })\n` +
        `export const a = css({ width: '[31.1px]' })\n` +
        `export const b = box({ state: 'on' })\n`,
    )
    writeFileSync(
      envSsrEntry,
      `import { css } from '../styled-system/css'\nexport const b = css({ md: { display: 'inline-block' }, height: '[31.3px]' })\n`,
    )
  })

  afterEach(() => {
    rmSync(envClientEntry, { force: true })
    rmSync(envSsrEntry, { force: true })
    // Removed here rather than by the one test that writes it. A fixture left in `src/` is not
    // inert: `include` is `./src/**/*.{tsx,jsx}`, so it becomes a real extraction input for
    // every later test in the run. `afterEach` fires even when a test times out, which a
    // `finally` in the test body does not — the body keeps running past the timeout.
    rmSync(envSharedModule, { force: true })
    vi.restoreAllMocks()
  })

  /**
   * The subject here is the stylesheet's emission, not its pruning, so the ssr entry is
   * rewritten to reach only classes the client reaches too. Left as the shared fixture writes
   * it, this fails on the ssr-only classes instead — a true result about the wrong thing.
   */
  test('an ssr environment does not have to import the stylesheet', async () => {
    writeFileSync(
      envSsrEntry,
      `import { css } from '../styled-system/css'\nexport const b = css({ width: '[31.1px]' })\n`,
    )

    const css = await buildBothEnvironments(await twoEnvironmentBuilder(true))

    expect(css).toContain('--made-with-bamboo')
    expect(css).toContain('31.1px')
  }, 180_000)

  test('concurrent environments wait for one shared artifact prebuild', async () => {
    const configPath = join(cwd, '__concurrent-prebuild.config.ts')
    const outdir = join(cwd, '__concurrent-styled-system')
    const generatedCss = join(outdir, 'css/index.mjs')

    type PrebuildGate = { wait: Promise<void>; done: () => void; starts: number }
    const testGlobal = globalThis as typeof globalThis & {
      __bambooConcurrentPrebuildGate?: PrebuildGate
    }

    let releaseGeneration!: () => void
    const waitForRelease = new Promise<void>((resolve) => {
      releaseGeneration = resolve
    })
    let markGenerated!: () => void
    const generated = new Promise<void>((resolve) => {
      markGenerated = resolve
    })
    testGlobal.__bambooConcurrentPrebuildGate = { wait: waitForRelease, done: markGenerated, starts: 0 }

    writeFileSync(
      configPath,
      `import { defineConfig } from '@bamboocss/dev'

export default defineConfig({
  preflight: false,
  include: ['./src/__env-{client,ssr}.tsx'],
  outdir: '__concurrent-styled-system',
  plugins: [{
    name: 'concurrent-prebuild-gate',
    hooks: {
      'codegen:prepare': async ({ artifacts }) => {
        globalThis.__bambooConcurrentPrebuildGate.starts++
        await globalThis.__bambooConcurrentPrebuildGate.wait
        return artifacts
      },
      'codegen:done': () => globalThis.__bambooConcurrentPrebuildGate.done(),
    },
  }],
})
`,
    )
    writeFileSync(
      envClientEntry,
      `import 'virtual:bamboo.css'\n` +
        `import { cx } from '../__concurrent-styled-system/css'\n` +
        `export const joined = (value) => cx(value, 'client-generated')\n`,
    )
    writeFileSync(
      envSsrEntry,
      `import { cx } from '../__concurrent-styled-system/css'\n` +
        `export const joined = (value) => cx(value, 'ssr-generated')\n`,
    )
    rmSync(outdir, { recursive: true, force: true })

    let releaseBuildStarts!: () => void
    const bothBuildsStarted = new Promise<void>((resolve) => {
      releaseBuildStarts = resolve
    })
    let buildStarts = 0
    let releaseTimer: ReturnType<typeof setTimeout> | undefined
    const synchronizeBuildStarts: Plugin = {
      name: 'synchronize-concurrent-environments',
      sharedDuringBuild: true,
      async buildStart() {
        buildStarts++
        if (buildStarts === 2) {
          releaseBuildStarts()
          // The racing environment reaches the observer below before the next macrotask.
          // A correct single-flight has both environments waiting, so release the generation
          // ourselves once they have each had a chance to join it.
          releaseTimer = setTimeout(releaseGeneration, 0)
        }
        await bothBuildsStarted
      },
    }

    const artifactsReadyAtBuildStart: boolean[] = []
    const observeAfterBambooPrebuild: Plugin = {
      name: 'observe-bamboo-prebuild',
      sharedDuringBuild: true,
      async buildStart() {
        const ready = existsSync(generatedCss)
        artifactsReadyAtBuildStart.push(ready)
        if (!ready) {
          releaseGeneration()
          await generated
        }
      },
    }

    const bambooPlugins = bamboocss({ cwd, configPath, reportSummary: false, pruneCss: false })

    try {
      const builder = await createBuilder({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [synchronizeBuildStarts, bambooPlugins[0]!, observeAfterBambooPrebuild, bambooPlugins[1]!],
        build: { write: false, minify: false, rollupOptions: { external: [/^react/] } },
        builder: {},
        environments: {
          client: { build: { lib: { entry: envClientEntry, formats: ['es'], fileName: 'env-client' } } },
          ssr: { build: { ssr: true, lib: { entry: envSsrEntry, formats: ['es'], fileName: 'env-ssr' } } },
        },
      })

      const builds = await Promise.all([
        builder.build(builder.environments.client!),
        builder.build(builder.environments.ssr!),
      ])

      expect(artifactsReadyAtBuildStart).toEqual([true, true])
      expect(existsSync(generatedCss)).toBe(true)
      expect(testGlobal.__bambooConcurrentPrebuildGate!.starts).toBe(1)

      const modules = await Promise.all(
        builds.map(async (built) => {
          const bundles = Array.isArray(built) ? built : [built]
          const code = bundles
            .flatMap((bundle) => (bundle as Rollup.RollupOutput).output)
            .map((output) => ('code' in output ? output.code : ''))
            .join('\n')
          return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)) as {
            joined: (value: string) => string
          }
        }),
      )

      expect(modules.map((module) => module.joined('runtime'))).toEqual([
        'runtime client-generated',
        'runtime ssr-generated',
      ])
    } finally {
      if (releaseTimer) clearTimeout(releaseTimer)
      releaseBuildStarts()
      releaseGeneration()
      delete testGlobal.__bambooConcurrentPrebuildGate
      rmSync(configPath, { force: true })
      rmSync(outdir, { recursive: true, force: true })
    }
  }, 180_000)

  test('cached transform facts are owned by their Vite environment', async () => {
    const trigger = join(cwd, 'src/__env-cache-trigger.tsx')
    const clientTrigger = join(cwd, 'src/__env-cache-client-trigger.ts')
    const sharedModule = join(cwd, 'src/__env-cache-shared.tsx')
    const clientEntry = join(cwd, 'src/__env-cache-client-entry.tsx')
    const ssrEntry = join(cwd, 'src/__env-cache-ssr-entry.tsx')
    const configPath = join(cwd, '__env-cache.bamboo.config.ts')
    const clientOutDir = join(cwd, '__env-cache-client-out')
    const ssrOutDir = join(cwd, '__env-cache-ssr-out')
    const widths = { cached: '37.811px', fresh: '37.922px' }
    type EnvironmentCalls = { client: number; ssr: number }

    const environmentSource = (calls: EnvironmentCalls): VitePlugin => ({
      name: 'bamboocss:test-environment-cache-source',
      enforce: 'pre',
      sharedDuringBuild: true,
      transform(_code, id) {
        if (!isModule(id, sharedModule)) return

        const environment = this.environment.name as keyof EnvironmentCalls
        calls[environment]++
        // The trigger is a separate build entry, so both watchers rebuild. Only the client
        // module itself watches it: SSR must reuse this transform and its environment-local metadata.
        if (environment === 'client') this.addWatchFile(trigger)

        const fresh = environment === 'client' && readFileSync(trigger, 'utf8').includes('second')
        const width = fresh ? widths.fresh : widths.cached
        return {
          code:
            `import { css } from '../styled-system/css'\n` + `export const className = css({ width: '[${width}]' })\n`,
          map: null,
        }
      },
    })

    // The SSR build is held behind the client's post-generateBundle pass. Its previous
    // generation remains live while the replacement waits, so the client sheet must retain the
    // cached SSR class; replay then publishes that same contribution for later partial rebuilds.
    let clientBundles = 0
    let ssrStarts = 0
    const waiters = new Map<number, Set<() => void>>()
    const waitForClient = (bundle: number) => {
      if (clientBundles >= bundle) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const pending = waiters.get(bundle) ?? new Set()
        pending.add(resolve)
        waiters.set(bundle, pending)
      })
    }
    const releaseClient = () => {
      clientBundles++
      for (const [bundle, pending] of [...waiters]) {
        if (bundle > clientBundles) continue
        waiters.delete(bundle)
        for (const resolve of pending) resolve()
      }
    }
    const clientBeforeSsr: VitePlugin = {
      name: 'bamboocss:test-client-before-ssr-cache-replay',
      sharedDuringBuild: true,
      async buildStart() {
        if (this.environment.name === 'ssr') await waitForClient(++ssrStarts)
      },
      generateBundle: {
        // Bamboo's CSS hook is also post and precedes this plugin in the array, so the release
        // happens after the client has populated `prunedClasses` for this build.
        order: 'post',
        handler() {
          if (this.environment.name === 'client') releaseClient()
        },
      },
    }

    const writtenCss = () =>
      readdirSync(clientOutDir)
        .filter((file) => file.endsWith('.css'))
        .map((file) => readFileSync(join(clientOutDir, file), 'utf8'))
        .join('\n')
    const nextBuild = (watcher: Rollup.RollupWatcher) =>
      new Promise<Error | undefined>((resolve) => {
        const onEvent = (event: Rollup.RollupWatcherEvent) => {
          if (event.code !== 'END' && event.code !== 'ERROR') return
          watcher.off('event', onEvent)
          resolve(event.code === 'ERROR' ? event.error : undefined)
        }
        watcher.on('event', onEvent)
      })

    mkdirSync(dirname(sharedModule), { recursive: true })
    // Extraction sees the physical source rather than the environment-specific upstream
    // transform, so both possible rules must belong to the configured CSS graph.
    writeFileSync(
      sharedModule,
      `import { css } from '../styled-system/css'\n` +
        `export const cached = css({ width: '[${widths.cached}]' })\n` +
        `export const fresh = css({ width: '[${widths.fresh}]' })\n`,
    )
    // Written as one change each: `writeFileSync` can reach a watcher as a truncation and a
    // write, which rebuilds twice and retransforms the shared module a third time.
    writeWatchTrigger(trigger, `export const version = 'first'`)
    writeWatchTrigger(clientTrigger, `export const clientVersion = 'first'`)
    writeFileSync(
      clientEntry,
      `import 'virtual:bamboo.css'\n` +
        `export { className } from './__env-cache-shared'\n` +
        `export { clientVersion } from './__env-cache-client-trigger'\n`,
    )
    writeFileSync(ssrEntry, `export { className } from './__env-cache-shared'\n`)
    writeIsolatedBambooConfig(configPath, [
      './src/__env-cache-shared.tsx',
      './src/__env-cache-client-entry.tsx',
      './src/__env-cache-ssr-entry.tsx',
    ])

    const calls: EnvironmentCalls = { client: 0, ssr: 0 }
    const bambooPlugins = bamboocss({ cwd, configPath, reportSummary: false })
    const builder = await createVite7Builder({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [environmentSource(calls), ...bambooPlugins, clientBeforeSsr],
      build: {
        watch: {},
        minify: false,
        emptyOutDir: false,
        rollupOptions: { external: [/^react/] },
      },
      builder: {},
      environments: {
        client: {
          build: {
            outDir: clientOutDir,
            lib: {
              entry: { app: clientEntry, trigger },
              formats: ['es'],
              fileName: (_format, entryName) => `env-cache-client-${entryName}`,
            },
          },
        },
        ssr: {
          build: {
            ssr: true,
            outDir: ssrOutDir,
            lib: {
              entry: { app: ssrEntry, trigger },
              formats: ['es'],
              fileName: (_format, entryName) => `env-cache-ssr-${entryName}`,
            },
          },
        },
      },
    })

    let clientWatcher: Rollup.RollupWatcher | undefined
    let ssrWatcher: Rollup.RollupWatcher | undefined
    let watchedCss = ''
    try {
      clientWatcher = (await builder.build(builder.environments.client!)) as Rollup.RollupWatcher
      const firstClient = nextBuild(clientWatcher)
      ssrWatcher = (await builder.build(builder.environments.ssr!)) as Rollup.RollupWatcher
      const firstSsr = nextBuild(ssrWatcher)

      expect(await Promise.all([firstClient, firstSsr])).toEqual([undefined, undefined])
      expect(calls).toEqual({ client: 1, ssr: 1 })
      expect(writtenCss()).toContain(widths.cached)
      expect(writtenCss()).not.toContain(widths.fresh)

      rmSync(clientOutDir, { force: true, recursive: true })
      const rebuiltClient = nextBuild(clientWatcher)
      const rebuiltSsr = nextBuild(ssrWatcher)
      await new Promise((settle) => setTimeout(settle, 800))
      writeWatchTrigger(trigger, `export const version = 'second'`)
      const [clientError, ssrError] = await Promise.all([rebuiltClient, rebuiltSsr])

      expect(calls, 'client retransforms while SSR reuses its environment-local cache').toEqual({ client: 2, ssr: 1 })
      expect(clientError).toBeUndefined()
      expect(writtenCss()).toContain(widths.fresh)
      expect(writtenCss()).toContain(widths.cached)
      expect(ssrError).toBeUndefined()

      // Rebuild only the client once SSR has published its cached generation. If replay were
      // suppressed by the fresh client transform above, this projection would now drop the SSR
      // class even though its cached JavaScript still names it.
      rmSync(clientOutDir, { force: true, recursive: true })
      const clientOnlyBuild = nextBuild(clientWatcher)
      await new Promise((settle) => setTimeout(settle, 800))
      writeWatchTrigger(clientTrigger, `export const clientVersion = 'second'`)
      expect(await clientOnlyBuild).toBeUndefined()
      expect(calls).toEqual({ client: 2, ssr: 1 })
      watchedCss = writtenCss()
      expect(watchedCss).toContain(widths.fresh)
      expect(watchedCss).toContain(widths.cached)
    } finally {
      // Unblock a waiting SSR hook before closing if an earlier assertion or build failed.
      for (const pending of waiters.values()) for (const resolve of pending) resolve()
      waiters.clear()
      await Promise.all([clientWatcher?.close(), ssrWatcher?.close()])
      rmSync(trigger, { force: true })
      rmSync(clientTrigger, { force: true })
      rmSync(sharedModule, { force: true })
      rmSync(clientEntry, { force: true })
      rmSync(ssrEntry, { force: true })
      rmSync(configPath, { force: true })
      rmSync(clientOutDir, { force: true, recursive: true })
      rmSync(ssrOutDir, { force: true, recursive: true })
    }

    // A cold build with the SSR graph established first has the same complete reachability
    // answer. Compare against it so the extra retained rule is proven necessary rather than an
    // accidental failure to prune.
    writeFileSync(
      sharedModule,
      `import { css } from '../styled-system/css'\n` +
        `export const cached = css({ width: '[${widths.cached}]' })\n` +
        `export const fresh = css({ width: '[${widths.fresh}]' })\n`,
    )
    writeFileSync(trigger, `export const version = 'second'\n`)
    writeFileSync(clientTrigger, `export const clientVersion = 'second'\n`)
    writeFileSync(
      clientEntry,
      `import 'virtual:bamboo.css'\n` +
        `export { className } from './__env-cache-shared'\n` +
        `export { clientVersion } from './__env-cache-client-trigger'\n`,
    )
    writeFileSync(ssrEntry, `export { className } from './__env-cache-shared'\n`)
    writeIsolatedBambooConfig(configPath, [
      './src/__env-cache-shared.tsx',
      './src/__env-cache-client-entry.tsx',
      './src/__env-cache-ssr-entry.tsx',
    ])
    const cleanCalls: EnvironmentCalls = { client: 0, ssr: 0 }
    try {
      const cleanBuilder = await createVite7Builder({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [environmentSource(cleanCalls), bamboocss({ cwd, configPath, reportSummary: false })],
        build: { write: false, minify: false, rollupOptions: { external: [/^react/] } },
        builder: {},
        environments: {
          client: {
            build: {
              lib: {
                entry: { app: clientEntry, trigger },
                formats: ['es'],
                fileName: (_format, entryName) => `env-cache-client-clean-${entryName}`,
              },
            },
          },
          ssr: {
            build: {
              ssr: true,
              lib: {
                entry: { app: ssrEntry, trigger },
                formats: ['es'],
                fileName: (_format, entryName) => `env-cache-ssr-clean-${entryName}`,
              },
            },
          },
        },
      })
      await cleanBuilder.build(cleanBuilder.environments.ssr!)
      const cleanBuilt = await cleanBuilder.build(cleanBuilder.environments.client!)
      const cleanCss = (Array.isArray(cleanBuilt) ? cleanBuilt : [cleanBuilt])
        .flatMap((bundle) => (bundle as Rollup.RollupOutput).output)
        .map((output) => (output.type === 'asset' ? String(output.source) : ''))
        .join('\n')
      expect(cleanCss).toContain(widths.fresh)
      expect(cleanCss).toContain(widths.cached)
      expect(watchedCss.trim()).toBe(cleanCss.trim())
      expect(cleanCalls).toEqual({ client: 1, ssr: 1 })
    } finally {
      rmSync(trigger, { force: true })
      rmSync(clientTrigger, { force: true })
      rmSync(sharedModule, { force: true })
      rmSync(clientEntry, { force: true })
      rmSync(ssrEntry, { force: true })
      rmSync(configPath, { force: true })
    }
  }, 180_000)

  test('Vite 7 preserves an untouched SSR contribution across a client-only rebuild', async () => {
    await runPartialEnvironmentWatchRebuild(
      (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0]),
      'vite7',
      { cachedSsr: '47.711px', freshClient: '47.722px', freshSsr: '47.733px' },
    )
  }, 180_000)

  test('Vite 8 preserves an untouched SSR contribution across a client-only rebuild', async () => {
    await runPartialEnvironmentWatchRebuild(
      (config) => createBuilder(config as Parameters<typeof createBuilder>[0]),
      'vite8',
      { cachedSsr: '48.811px', freshClient: '48.822px', freshSsr: '48.833px' },
    )
  }, 180_000)

  test('Vite 7 refuses an SSR rebuild emitting its own sheet for a class the client sheet lost', async () => {
    await runPartialEnvironmentWatchRebuild(
      (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0]),
      'vite7-emitting',
      { cachedSsr: '47.811px', freshClient: '47.822px', freshSsr: '47.833px' },
      true,
    )
  }, 180_000)

  test('Vite 8 refuses an SSR rebuild emitting its own sheet for a class the client sheet lost', async () => {
    await runPartialEnvironmentWatchRebuild(
      (config) => createBuilder(config as Parameters<typeof createBuilder>[0]),
      'vite8-emitting',
      { cachedSsr: '48.911px', freshClient: '48.922px', freshSsr: '48.933px' },
      true,
    )
  }, 180_000)

  test('Vite 7 keeps no first pruning past a client-first rebuild', async () => {
    await runClientFirstWatchRebuild(
      (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0]),
      'vite7',
      { ssr: '93.101px', client: '93.202px', edited: '93.303px' },
    )
  }, 180_000)

  test('Vite 8 keeps no first pruning past a client-first rebuild', async () => {
    await runClientFirstWatchRebuild(
      (config) => createBuilder(config as Parameters<typeof createBuilder>[0]),
      'vite8',
      { ssr: '94.101px', client: '94.202px', edited: '94.303px' },
    )
  }, 180_000)

  test('Vite 7 keeps no first pruning past a client-first rebuild where SSR imports the sheet', async () => {
    await runClientFirstWatchRebuild(
      (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0]),
      'vite7-sheet',
      { ssr: '95.101px', client: '95.202px', edited: '95.303px' },
      true,
    )
  }, 180_000)

  test('Vite 8 keeps no first pruning past a client-first rebuild where SSR imports the sheet', async () => {
    await runClientFirstWatchRebuild(
      (config) => createBuilder(config as Parameters<typeof createBuilder>[0]),
      'vite8-sheet',
      { ssr: '96.101px', client: '96.202px', edited: '96.303px' },
      true,
    )
  }, 180_000)

  test('Vite 7 keeps no provisional loss past an output rejected after it finalized the sheet', async () => {
    await runRejectedCompletionWatchRebuild(
      (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0]),
      'vite7',
      { ssr: '97.101px', client: '97.202px' },
    )
  }, 180_000)

  test('Vite 8 keeps no provisional loss past an output rejected after it finalized the sheet', async () => {
    await runRejectedCompletionWatchRebuild(
      (config) => createBuilder(config as Parameters<typeof createBuilder>[0]),
      'vite8',
      { ssr: '98.101px', client: '98.202px' },
    )
  }, 180_000)

  test('Vite 7 does not publish a generation rejected during output', async () => {
    await runRejectedOutputWatchRebuild(
      (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0]),
      'vite7',
      { old: '50.711px', rejected: '50.722px', written: '50.744px', sibling: '50.733px' },
    )
  }, 180_000)

  test('Vite 8 does not publish a generation rejected during output', async () => {
    await runRejectedOutputWatchRebuild(
      (config) => createBuilder(config as Parameters<typeof createBuilder>[0]),
      'vite8',
      { old: '50.811px', rejected: '50.822px', written: '50.844px', sibling: '50.833px' },
    )
  }, 180_000)

  test('Vite 7 retains every live epoch across a partially written multi-output generation', async () => {
    await runMixedOutputEpochWatchRebuild(
      (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0]),
      'vite7',
      { old: '61.101px', candidate: '61.202px', replacement: '61.303px', sibling: '61.404px' },
    )
  }, 180_000)

  test('Vite 8 retains every live epoch across a partially written multi-output generation', async () => {
    await runMixedOutputEpochWatchRebuild(
      (config) => createBuilder(config as Parameters<typeof createBuilder>[0]),
      'vite8',
      { old: '62.101px', candidate: '62.202px', replacement: '62.303px', sibling: '62.404px' },
    )
  }, 180_000)

  test('Vite 7 refuses to replace CSS while a live output names a physically removed rule', async () => {
    await runRemovedLiveRuleWatchRebuild(
      (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0]),
      'vite7',
      { old: '71.101px', replacement: '71.202px', sibling: '71.303px' },
    )
  }, 180_000)

  test('Vite 8 refuses to replace CSS while a live output names a physically removed rule', async () => {
    await runRemovedLiveRuleWatchRebuild(
      (config) => createBuilder(config as Parameters<typeof createBuilder>[0]),
      'vite8',
      { old: '81.101px', replacement: '81.202px', sibling: '81.303px' },
      false,
    )
  }, 180_000)

  const siblingShapes = ['a new class', 'a class extracted before', 'a failed replacement'] as const
  test.each(siblingShapes)(
    'Vite 7 prunes a watch sheet again once the sibling replacing its output settles, with %s',
    async (shape) => {
      await runSiblingReplacementWatchRebuild(
        (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0]),
        `vite7-${siblingShapes.indexOf(shape)}`,
        shape,
      )
    },
    180_000,
  )

  test.each(siblingShapes)(
    'Vite 8 prunes a watch sheet again once the sibling replacing its output settles, with %s',
    async (shape) => {
      await runSiblingReplacementWatchRebuild(
        (config) => createBuilder(config as Parameters<typeof createBuilder>[0]),
        `vite8-${siblingShapes.indexOf(shape)}`,
        shape,
      )
    },
    180_000,
  )

  test('Vite 7 defers whole-run guards during concurrent replacement generations', async () => {
    await runConcurrentEnvironmentWatchRebuild(
      (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0]),
      'vite7',
      { client: '49.911px', ssr: '49.912px' },
    )
  }, 180_000)

  test('Vite 8 defers whole-run guards during concurrent replacement generations', async () => {
    await runConcurrentEnvironmentWatchRebuild(
      (config) => createBuilder(config as Parameters<typeof createBuilder>[0]),
      'vite8',
      { client: '49.921px', ssr: '49.922px' },
    )
  }, 180_000)

  /**
   * The stylesheet is emitted by the environment that imports it, and in an SSR app that is the
   * client — which builds *first*, before the server environment has transformed a single
   * module. A class only the server graph reaches is therefore not in reachability when the
   * sheet is emitted.
   *
   * Holding the sheet back until the whole run had contributed was the old answer, and it meant
   * never pruning at all under react-router, Remix, Nuxt, SvelteKit or Qwik — every one builds
   * the client first. So the sheet is pruned against what the run knows, and a written one is
   * pruned again from source once the last environment reaches its output. An in-memory build has no
   * file to finalize, so for it the guard stays: one project lost 39% of its atoms to a silent
   * version of this, `md:{display:inline-block}` among them, and that must fail rather than ship.
   */
  test('a class only the later environment reaches fails an in-memory build, which cannot be finalized', async () => {
    const builder = await twoEnvironmentBuilder(true)

    await expect(buildBothEnvironments(builder)).rejects.toThrow(/already pruned out of a stylesheet/)
  }, 180_000)

  /**
   * The same with an SSR environment that imports the stylesheet and emits its assets. The sheet
   * it emits supersedes the one it emitted last, and no other: a page links the client's, which
   * lost the server-only rules, so the build fails as it does when SSR discards its assets. It
   * passed, the client's sheet shipping without them.
   */
  test('a class only an SSR environment emitting its own sheet reaches fails an in-memory build', async () => {
    writeFileSync(envSsrEntry, `import 'virtual:bamboo.css'\n${readFileSync(envSsrEntry, 'utf8')}`)
    const builder = await twoEnvironmentBuilder(true, { emitAssets: true })

    const failure = await buildBothEnvironments(builder).then(
      () => undefined,
      (error: Error) => error.message,
    )
    expect(failure).toContain('already pruned out of a stylesheet')
    expect(failure).toContain(esc('h_[31.3px]'))
  }, 180_000)

  /** Linked through `?url`, the sheet a page loads for SSR's markup is SSR's own, which holds its rules. */
  test('an SSR environment linking its own copy of the sheet through ?url is not refused', async () => {
    writeFileSync(
      envSsrEntry,
      `import href from 'virtual:bamboo.css?url'\nexport { href }\n${readFileSync(envSsrEntry, 'utf8')}`,
    )
    const builder = await twoEnvironmentBuilder(true, { emitAssets: true })

    const css = await buildBothEnvironments(builder)
    expect(css).toContain(esc('h_[31.3px]'))
  }, 180_000)

  /**
   * The written case. The client writes the sheet pruned against itself; when the server
   * environment finishes, the sheet is pruned again from source against both, which restores the
   * server-only rules, so the final bytes go under a new name and every reference to it — the
   * HTML, the manifest — is rewritten in place.
   */
  test('a written sheet is pruned against every environment once the last has compiled', async () => {
    const html = join(cwd, '__env-index.html')
    const clientOutDir = join(cwd, '__env-finalized-client-out')
    const ssrOutDir = join(cwd, '__env-finalized-ssr-out')
    writeFileSync(html, `<script type="module" src="/src/__env-client.tsx"></script>`)

    try {
      const builder = await createBuilder({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, reportSummary: false })],
        build: { minify: false, emptyOutDir: true, rollupOptions: { external: [/^react/] } },
        builder: {},
        environments: {
          client: {
            build: {
              outDir: clientOutDir,
              manifest: true,
              cssCodeSplit: false,
              rollupOptions: { input: html, output: { assetFileNames: 'assets/[name]-[hash][extname]' } },
            },
          },
          ssr: {
            build: { ssr: true, outDir: ssrOutDir, lib: { entry: envSsrEntry, formats: ['es'], fileName: 'env-ssr' } },
          },
        },
      })
      await builder.build(builder.environments.client!)
      await builder.build(builder.environments.ssr!)

      const cssFiles = readdirSync(join(clientOutDir, 'assets')).filter((file) => file.endsWith('.css'))
      expect(cssFiles, 'one sheet, and only the finalized one').toHaveLength(1)
      const [cssFile] = cssFiles
      expect(cssFile).toMatch(/\.b-[A-Za-z0-9]+\.css$/)

      const css = readFileSync(join(clientOutDir, 'assets', cssFile!), 'utf8')
      expect(css, 'the client class').toContain('31.1px')
      expect(css, 'the class only the ssr environment reaches').toContain('31.3px')
      expect(css, 'the condition only the ssr environment reaches').toContain('inline-block')
      expect(css, 'the variant nothing selects').not.toContain('31.7px')

      expect(readFileSync(join(clientOutDir, '__env-index.html'), 'utf8')).toContain(`assets/${cssFile}`)
      expect(readFileSync(join(clientOutDir, '.vite/manifest.json'), 'utf8')).toContain(`assets/${cssFile}`)
    } finally {
      rmSync(html, { force: true })
      rmSync(clientOutDir, { force: true, recursive: true })
      rmSync(ssrOutDir, { force: true, recursive: true })
    }
  }, 180_000)

  /**
   * `pruneCss: false` is the way out, and it has to actually be one — the escape hatch for
   * this is worthless if the build fails before the user can take it.
   */
  test('pruneCss: false keeps a class only the later environment reaches', async () => {
    const css = await buildBothEnvironments(
      await createBuilder({
        root: cwd,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, reportSummary: false, pruneCss: false })],
        build: { write: false, minify: false, rollupOptions: { external: [/^react/] } },
        builder: {},
        environments: {
          client: { build: { lib: { entry: envClientEntry, formats: ['es'], fileName: 'env-client' } } },
          ssr: { build: { ssr: true, lib: { entry: envSsrEntry, formats: ['es'], fileName: 'env-ssr' } } },
        },
      }),
    )

    expect(css, 'the client class').toContain('31.1px')
    expect(css, 'the class only the ssr environment reaches').toContain('31.3px')
    expect(css, 'the condition only the ssr environment reaches').toContain('inline-block')
    expect(css, 'nothing is pruned at all').toContain('31.7px')
  }, 180_000)

  /**
   * The same two environments with the server bundle built first.
   *
   * Reachability is complete by the time the client — which is what imports and finalizes the
   * stylesheet — reaches `generateBundle`, so pruning goes ahead and is right. This is the
   * order that keeps both properties at once, and the reason the gate asks "is this the last
   * environment" rather than "is this a multi-environment build".
   */
  test('prunes normally when the environment holding the stylesheet builds last', async () => {
    const css = await buildBothEnvironments(await twoEnvironmentBuilder(true), ['ssr', 'client'])

    expect(css, 'the client class').toContain('31.1px')
    expect(css, 'the class only the ssr environment reaches').toContain('31.3px')
    expect(css, 'the condition only the ssr environment reaches').toContain('inline-block')
    expect(css, 'the variant nothing selects').not.toContain('31.7px')
  }, 180_000)

  /**
   * A run that builds environments itself, without saying how many there are.
   *
   * Same outcome as the announced case above, and deliberately so: pruning no longer waits on
   * the environment count, so announcing it cannot change what ships. This stays a test of its
   * own because the two setups reach the guard by different routes.
   */
  test('fails loudly when the run never announced its environments', async () => {
    const builder = await twoEnvironmentBuilder(false)

    await expect(buildBothEnvironments(builder)).rejects.toThrow(/already pruned out of a stylesheet/)
  }, 180_000)

  /**
   * The coverage summary counts a shared module once, and prints once.
   *
   * Both environments transform the modules they have in common, which in a real app is most of
   * them. Summing as the transforms arrive therefore counted each of those once per
   * environment: this fixture — one shared module and one entry each, three files, one `css()`
   * call — reported "Compiled 2/2 across 2/4 files", and printed a partial line for the client
   * before a second line quietly superseded it. Coverage describes the source, not how many
   * times a bundler handed the same file over.
   */
  test('reports coverage once per run, counting shared modules once', async () => {
    writeFileSync(
      envSharedModule,
      `import { css } from '../styled-system/css'\nexport const s = css({ width: '[41.1px]' })\n`,
    )
    writeFileSync(
      envClientEntry,
      `import 'virtual:bamboo.css'\nimport { s } from './__env-shared'\nexport const a = s\n`,
    )
    writeFileSync(envSsrEntry, `import { s } from './__env-shared'\nexport const b = s\n`)

    const lines: string[] = []
    // Restored by `afterEach`, which runs even if this times out — a `finally` here does not,
    // because the body keeps going past the deadline and would leave `console.log` patched
    // over whatever runs next.
    vi.spyOn(console, 'log').mockImplementation((...args) => void lines.push(args.join(' ')))

    const builder = await createBuilder({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: true })],
      build: { write: false, minify: false, rollupOptions: { external: [/^react/] } },
      builder: {},
      environments: {
        client: { build: { lib: { entry: envClientEntry, formats: ['es'], fileName: 'env-client' } } },
        ssr: { build: { ssr: true, lib: { entry: envSsrEntry, formats: ['es'], fileName: 'env-ssr' } } },
      },
    })
    await buildBothEnvironments(builder)

    // Matched on the summary's shape rather than on the word, which the per-file debug line
    // `Compiled N call(s) in <file>` also carries whenever `BAMBOO_DEBUG` is set.
    const summaries = lines.filter((line) => /Compiled \d+\/\d+/.test(line))
    expect(summaries, 'one summary for the run, not one per environment').toHaveLength(1)
    // Three source modules, one of which folds its single `css()` call. The shared module is
    // transformed by both environments and must still count as one file and one call.
    expect(summaries[0]).toContain('Compiled 1/1 (100%) across 1/3 files')
  }, 180_000)
})

/**
 * `virtual:bamboo.css?url` through a real build.
 *
 * Vite's convention for asking any CSS module for its URL rather than its contents. It did not
 * resolve here at all, so requesting it failed as an unresolvable path.
 *
 * The sheet becomes an asset of its own, which is what `?url` means rather than a shortcoming:
 * a project concatenating Bamboo's CSS into one global stylesheet does not want it. It is for
 * a `<link>` written by hand, a preload hint, or an href handed outside the bundler.
 */
const urlEntry = join(cwd, 'src/__url-entry.tsx')

describe('the stylesheet URL', () => {
  afterEach(() => {
    rmSync(urlEntry, { force: true })
  })

  test('resolves, and points at an asset carrying the stylesheet', async () => {
    writeFileSync(
      urlEntry,
      `import href from 'virtual:bamboo.css?url'\nimport { css } from '../styled-system/css'\nexport const a = css({ width: '[51.1px]' })\nexport const url = href\n`,
    )

    const result = (await build({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: false })],
      build: {
        write: false,
        minify: false,
        lib: { entry: urlEntry, formats: ['es'], fileName: 'url' },
        rollupOptions: { external: [/^react/] },
      },
    })) as Rollup.RollupOutput[]

    const outputs = result[0]!.output
    const js = outputs.map((output) => ('code' in output ? output.code : '')).join('\n')
    const assets = outputs.filter((output) => 'source' in output && typeof output.source === 'string') as unknown as {
      fileName: string
      source: string
    }[]

    const sheet = assets.find((asset) => asset.source.includes('--made-with-bamboo'))
    expect(sheet, 'no emitted asset carries the stylesheet').toBeDefined()
    expect(sheet!.source).toContain('51.1px')

    // The module exports the emitted asset's name, not the virtual id.
    expect(js).not.toContain('virtual:bamboo.css')
    expect(js).toContain(sheet!.fileName.split('/').pop()!)
  }, 120_000)

  // A server bundle links the client's sheet by the name pruning gives it, so the server's own copy,
  // which Vite does not write, is pruned and renamed as the client's is: left whole, the page linked
  // a stylesheet nothing wrote. One entry for both, as an app's is, so both reach the same classes,
  // and a config of its own, so what else the sandbox holds does not reach either.
  const linkCases: Array<[string, (config: Record<string, unknown>) => Promise<unknown>]> = [
    ['Vite 7', (config) => createVite7Builder(config as Parameters<typeof createVite7Builder>[0])],
    ['Vite 8', (config) => createBuilder(config as Parameters<typeof createBuilder>[0])],
  ]

  test.each(linkCases)(
    'on %s, a server bundle links the sheet the client writes',
    async (label, create) => {
      const tag = label.replace(/\W/g, '').toLowerCase()
      const app = join(cwd, `src/__url-app-${tag}.tsx`)
      const unused = join(cwd, `src/__url-unused-${tag}.tsx`)
      const configPath = join(cwd, `__url-${tag}.bamboo.config.ts`)
      const clientOut = join(cwd, `__url-client-${tag}-out`)
      const ssrOut = join(cwd, `__url-ssr-${tag}-out`)
      writeFileSync(
        app,
        `import href from 'virtual:bamboo.css?url'\nimport { css } from '../styled-system/css'\nexport const cls = css({ width: '[51.3px]' })\n;(globalThis as any).__bambooUrlApp = { href, cls }\n`,
      )
      // Extracted and reached by neither, so pruning removes it and the sheet is renamed.
      writeFileSync(
        unused,
        `import { css } from '../styled-system/css'\nexport const unused = css({ width: '[51.4px]' })\n`,
      )
      writeIsolatedBambooConfig(configPath, [`./src/__url-app-${tag}.tsx`, `./src/__url-unused-${tag}.tsx`])
      try {
        const builder = (await create({
          root: cwd,
          configFile: false,
          logLevel: 'silent',
          css: { postcss: { plugins: [] } },
          plugins: [bamboocss({ cwd, configPath, reportSummary: false })],
          builder: {},
          build: { emptyOutDir: true },
          environments: {
            client: { build: { outDir: clientOut, rollupOptions: { input: { app } } } },
            ssr: { build: { outDir: ssrOut, rollupOptions: { input: { app } } } },
          },
        })) as { buildApp(): Promise<void> }
        await builder.buildApp()

        const linked = [...new Set(readOutputFiles(ssrOut, '.js').match(/\/assets\/[\w.-]+\.css/g) ?? [])]
        expect(linked, 'the server bundle links no stylesheet').not.toEqual([])
        const written = readdirSync(join(clientOut, 'assets')).filter((file) => file.endsWith('.css'))
        for (const href of linked) {
          expect(existsSync(join(clientOut, href)), `the client wrote no ${href}, but ${written.join(', ')}`).toBe(true)
        }
      } finally {
        for (const file of [app, unused, configPath]) rmSync(file, { force: true })
        rmSync(clientOut, { force: true, recursive: true })
        rmSync(ssrOut, { force: true, recursive: true })
      }
    },
    180_000,
  )

  /**
   * The server's copy of the sheet is one Vite discards, so it has to carry the name of the one the
   * client writes. Built first, the server pruned its copy against itself alone and named it after
   * those bytes, which no environment wrote: the client's, pruned against both, kept a rule only
   * the client reaches, and every server-rendered page linked a stylesheet that was not there.
   */
  test.each(linkCases)(
    'on %s, a server built first links the sheet the client writes after it',
    async (label, create) => {
      const tag = `${label}-first`.replace(/\W/g, '').toLowerCase()
      const app = join(cwd, `src/__url-app-${tag}.tsx`)
      const other = join(cwd, `src/__url-other-${tag}.tsx`)
      const configPath = join(cwd, `__url-${tag}.bamboo.config.ts`)
      const clientOut = join(cwd, `__url-client-${tag}-out`)
      const ssrOut = join(cwd, `__url-ssr-${tag}-out`)
      writeFileSync(
        app,
        `import href from 'virtual:bamboo.css?url'\nimport { css } from '../styled-system/css'\nexport const cls = css({ width: '[51.3px]' })\n;(globalThis as any).__bambooUrlApp = { href, cls }\n`,
      )
      // Reached by the client's input alone.
      writeFileSync(
        other,
        `import { css } from '../styled-system/css'\nexport const other = css({ width: '[51.6px]' })\n`,
      )
      writeIsolatedBambooConfig(configPath, [`./src/__url-app-${tag}.tsx`, `./src/__url-other-${tag}.tsx`])
      try {
        const builder = (await create({
          root: cwd,
          configFile: false,
          logLevel: 'silent',
          css: { postcss: { plugins: [] } },
          plugins: [bamboocss({ cwd, configPath, reportSummary: false })],
          builder: {},
          build: { emptyOutDir: true },
          environments: {
            client: { build: { outDir: clientOut, rollupOptions: { input: { app, other } } } },
            ssr: { build: { outDir: ssrOut, rollupOptions: { input: { app } } } },
          },
        })) as TestEnvironmentBuilder
        await builder.build(builder.environments.ssr)
        await builder.build(builder.environments.client)

        const linked = [...new Set(readOutputFiles(ssrOut, '.js').match(/\/assets\/[\w.-]+\.css/g) ?? [])]
        expect(linked, 'the server bundle links no stylesheet').not.toEqual([])
        const written = readdirSync(join(clientOut, 'assets')).filter((file) => file.endsWith('.css'))
        for (const href of linked) {
          expect(existsSync(join(clientOut, href)), `the client wrote no ${href}, but ${written.join(', ')}`).toBe(true)
          expect(readFileSync(join(clientOut, href), 'utf8')).toContain(esc('w_[51.6px]'))
        }
      } finally {
        for (const file of [app, other, configPath]) rmSync(file, { force: true })
        rmSync(clientOut, { force: true, recursive: true })
        rmSync(ssrOut, { force: true, recursive: true })
      }
    },
    180_000,
  )

  // Vite 6 builds the outputs it writes from `rollupOptions.output` before `options` runs, so the
  // finalizer installed there never ran: the client's sheet, deferred until SSR completed, was never
  // finalized, and a rule only the server reaches was missing from it, with the build green.
  test('on Vite 6 with rollupOptions.output set, an announced run finalizes the sheet it deferred', async () => {
    const client = join(cwd, 'src/__vite6-output-client.tsx')
    const server = join(cwd, 'src/__vite6-output-server.tsx')
    const configPath = join(cwd, '__vite6-output.bamboo.config.ts')
    const clientOut = join(cwd, '__vite6-output-client-out')
    const ssrOut = join(cwd, '__vite6-output-ssr-out')
    writeFileSync(
      client,
      `import 'virtual:bamboo.css'\nimport { css } from '../styled-system/css'\nexport const a = css({ height: '[61.5px]' })\n`,
    )
    writeFileSync(server, `import { css } from '../styled-system/css'\nexport const b = css({ width: '[61.3px]' })\n`)
    writeIsolatedBambooConfig(configPath, ['./src/__vite6-output-client.tsx', './src/__vite6-output-server.tsx'])
    try {
      const builder = await createVite6Builder({
        root: cwd,
        configFile: false,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, configPath, reportSummary: false })],
        builder: {},
        build: { emptyOutDir: true },
        environments: {
          client: {
            build: { outDir: clientOut, rollupOptions: { input: { client }, output: { entryFileNames: '[name].js' } } },
          },
          ssr: {
            build: {
              ssr: true,
              outDir: ssrOut,
              rollupOptions: { input: { server }, output: { entryFileNames: '[name].js' } },
            },
          },
        },
      })
      await builder.buildApp()

      expect(readOutputFiles(join(clientOut, 'assets'), '.css')).toContain('61.3px')
    } finally {
      for (const file of [client, server, configPath]) rmSync(file, { force: true })
      rmSync(clientOut, { force: true, recursive: true })
      rmSync(ssrOut, { force: true, recursive: true })
    }
  }, 180_000)

  /**
   * The same import on a dev server, which leaves `?url` to Vite's asset plugin, and that plugin
   * skips an id with no file behind it. The CSS itself came back as the module, which neither the
   * SSR runner nor the browser could parse. TanStack Start's template links its stylesheet exactly
   * this way, so the first server render failed outright.
   *
   * Fetched over HTTP the way a `<link>` fetches it, accepting `text/css`, which is what makes the
   * dev server answer with the stylesheet rather than a module. An edit then has to reach that
   * stylesheet too: it is a module of its own, `?direct`, with its own edges.
   */
  const devCases: Array<[string, typeof createServer, number]> = [
    ['Vite 7', createServer, 24795],
    ['Vite 8', createVite8Server as unknown as typeof createServer, 24796],
  ]

  for (const [label, createDevServer, port] of devCases) {
    test(`${label} serves the stylesheet at the URL a dev server exports`, async () => {
      const writeEntry = (width: string) =>
        writeFileSync(
          urlEntry,
          `import href from 'virtual:bamboo.css?url'\nimport { css } from '../styled-system/css'\nexport const a = css({ width: '[${width}]' })\nexport const url = href\n`,
        )
      writeEntry('52.1px')

      const server = await createDevServer({
        root: cwd,
        configFile: false,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, reportSummary: false }) as never],
        server: { port, strictPort: true },
      })

      try {
        await server.listen()
        const href = '/@id/__x00__virtual:bamboo.css'
        for (const environment of ['client', 'ssr'] as const) {
          const module = await server.environments[environment].transformRequest('virtual:bamboo.css?url')
          expect(module?.code, environment).toContain(JSON.stringify(href))
        }

        const fetchSheet = async () => {
          const response = await fetch(new URL(href, server.resolvedUrls!.local[0]), {
            headers: { accept: 'text/css,*/*;q=0.1' },
          })
          return { type: response.headers.get('content-type'), css: await response.text() }
        }
        const served = await fetchSheet()
        expect(served.type).toContain('text/css')
        expect(served.css).toContain('w_\\[52\\.1px\\]')

        // A page linking the sheet has loaded its modules too, which leaves the edit to Vite's own
        // propagation rather than to the watcher's forced reload.
        await server.environments.client.transformRequest('/src/__url-entry.tsx')
        writeEntry('52.2px')
        server.watcher.emit('change', urlEntry)

        const deadline = Date.now() + 10_000
        let css = ''
        do {
          // A macrotask between reads, so the update being waited for is not starved.
          await new Promise((resolve) => setTimeout(resolve, 50))
          css = (await fetchSheet()).css
        } while (!css.includes('w_\\[52\\.2px\\]') && Date.now() < deadline)
        expect(css, 'the edit never reached the linked stylesheet').toContain('w_\\[52\\.2px\\]')
      } finally {
        await server.close()
      }
    }, 120_000)
  }
})

/**
 * An edit reaching a module that compiled somebody else's call.
 *
 * This is the one failure with no build-time equivalent, so it needs a running server. In a
 * build, Rollup discards a module whose `addWatchFile` dependency changed. Vite's dev server
 * *soft*-invalidates a module that statically imports the changed one: it keeps that module's
 * cached transform result and rewrites nothing but the timestamps on its import specifiers.
 * The compiled class string lives in exactly that cached result.
 *
 * Recipes are where users meet it, because a recipe is the case where the class is compiled
 * into somebody else's module — an inline `cva` declaration is erased and each *call site*
 * becomes a literal where it is called. Editing the recipe therefore has to update a module
 * Vite decided not to re-transform, and the browser and the SSR render keep the old class
 * with nothing logged: Vite reports its update, Bamboo reports a fresh extraction, and the
 * stylesheet does gain the new rule. Only a restart applied the edit.
 *
 * The consumer imports a second value from the same module on purpose. A consumer that folds
 * *nothing but* recipe calls has its import erased, and an erased import is not a static one,
 * so Vite hard-invalidates it and the bug hides — which is why a minimal reproduction of it
 * does not reproduce it.
 */
describe('vite plugin, real dev server', () => {
  const recipe = join(cwd, 'src/__hmr-recipe.tsx')
  const consumer = join(cwd, 'src/__hmr-consumer.tsx')

  const writeRecipe = (color: 'red600' | 'blue600') =>
    writeFileSync(
      recipe,
      `import { css, cva } from '../styled-system/css'
       export const navLink = cva({
         base: { display: 'flex' },
         variants: { active: { true: { color: '${color}' }, false: { color: 'gray500' } } },
       })
       export const heading = css({ fontWeight: 'bold' })
      `,
    )

  afterEach(() => {
    rmSync(recipe, { force: true })
    rmSync(consumer, { force: true })
  })

  test('a recipe edit reaches the module that compiled a call to it', async () => {
    writeRecipe('red600')
    writeFileSync(
      consumer,
      `import { heading, navLink } from './__hmr-recipe'
       export const title = heading
       export const link = (active: boolean) => navLink({ active })
      `,
    )

    const server = await createServer({
      root: cwd,
      configFile: false,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: false })],
      // A port of its own, so a stray dev server on Vite's default cannot make this hang. A
      // conflict here is logged and otherwise harmless: nothing below needs the socket.
      server: { middlewareMode: true, hmr: { port: 24788 } },
    })

    /**
     * Both environments, because the report was against server-rendered markup and the client
     * and SSR module graphs are invalidated separately.
     */
    const environments = ['client', 'ssr'] as const
    const codeOf = async (environment: (typeof environments)[number]) =>
      (await server.environments[environment].transformRequest('/src/__hmr-consumer.tsx'))?.code ?? ''

    try {
      for (const environment of environments) {
        expect(await codeOf(environment), environment).toContain('c_red600')
      }

      writeRecipe('blue600')
      // The watcher's own event, so the whole of Vite's update pipeline runs rather than the
      // one hook this is about. It is dispatched asynchronously and is not awaitable, hence
      // the poll — which cannot mask the defect: a stale read just polls again, and the
      // invalidation this tests is not something a read can consume.
      server.watcher.emit('change', recipe)

      for (const environment of environments) {
        const deadline = Date.now() + 10_000
        let code = ''
        do {
          code = await codeOf(environment)
        } while (!code.includes('c_blue600') && Date.now() < deadline)

        expect(code, `${environment}: the recipe edit never reached the module that calls it`).toContain('c_blue600')
        expect(code, environment).not.toContain('c_red600')
      }
    } finally {
      await server.close()
    }
  }, 120_000)
})

/**
 * The stylesheet requested before anything in its environment imports it.
 *
 * Vite attaches what a module's `load` registers with `addWatchFile` to that module's node in the
 * graph, and a request for a module the graph has no node for yet runs `load` first and creates
 * the node afterwards. The registrations were dropped, `vite:css-analysis` recorded no importer
 * edges, and an edit never reached the sheet in that environment: the component repainted with a
 * class whose rule never arrived, until a restart.
 *
 * TanStack Start does this on every page load when `__root.tsx` imports the stylesheet. Its
 * dev-only SSR style collection transforms the sheet in the client environment on the server,
 * before the browser's import has put a node there. A browser's own import does not, because the
 * importer's analysis creates the node first — which is why a plain Vite app never showed it.
 *
 * The consumer is transformed after the sheet on purpose. With a module of its own in the client
 * graph, the watcher leaves the update to Vite's propagation rather than forcing a reload, so the
 * edge is the only thing that can carry the edit to the sheet.
 */
describe('the stylesheet requested before its importer', () => {
  const consumer = join(cwd, 'src/__sheet-first-consumer.tsx')
  const writeConsumer = (width: string) =>
    writeFileSync(
      consumer,
      `import 'virtual:bamboo.css'\nimport { css } from '../styled-system/css'\nexport const title = css({ width: '[${width}]' })\n`,
    )

  afterEach(() => {
    rmSync(consumer, { force: true })
  })

  const cases: Array<[string, typeof createServer, number]> = [
    ['Vite 7', createServer, 24793],
    ['Vite 8', createVite8Server as unknown as typeof createServer, 24794],
  ]

  for (const [label, createDevServer, port] of cases) {
    test(`${label} still carries an edit to the sheet`, async () => {
      writeConsumer('731.1px')
      const server = await createDevServer({
        root: cwd,
        configFile: false,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd, reportSummary: false }) as never],
        server: { middlewareMode: true, hmr: { port } },
      })
      const sheet = async () => (await server.environments.client.transformRequest('virtual:bamboo.css'))?.code ?? ''

      try {
        expect(await sheet()).toContain('w_\\\\[731\\\\.1px\\\\]')
        await server.environments.client.transformRequest('/src/__sheet-first-consumer.tsx')

        writeConsumer('731.2px')
        // Dispatched asynchronously and not awaitable, hence the poll. A stale read cannot mask the
        // defect: it only polls again, and the invalidation this is about is not consumed by a read.
        server.watcher.emit('change', consumer)

        const deadline = Date.now() + 10_000
        let code = ''
        do {
          // A macrotask between reads. Vite 8 answers a cached module without leaving the microtask
          // queue, so a tight loop would starve the update it is waiting for.
          await new Promise((resolve) => setTimeout(resolve, 50))
          code = await sheet()
        } while (!code.includes('w_\\\\[731\\\\.2px\\\\]') && Date.now() < deadline)

        expect(code, 'the edit never reached the stylesheet').toContain('w_\\\\[731\\\\.2px\\\\]')
      } finally {
        await server.close()
      }
    }, 120_000)
  }
})

/**
 * A file added under an `include` outside the dev server's root.
 *
 * Vite watches its root, and a file outside it only once something has loaded it — the stylesheet
 * registers every file it was built from, so an edit to one was always seen. A file *added* there,
 * a new component in a workspace package `include` names as `../shared/**`, had nothing watching
 * its folder: no `add` reached the plugin, the inventory was never reconciled, and the stylesheet
 * went on without the file until the server restarted.
 */
/**
 * Until a project written an instant ago is past being reported. The watcher can still deliver the
 * writes that made it, and one of them is the config, which this plugin declares to Vite as a config
 * file: Vite restarts, and the request in flight fails with "The server is being restarted or
 * closed". Waiting this long took it from 2 failures in 16 runs to none.
 */
const settled = () => new Promise((resolve) => setTimeout(resolve, 300))

describe('a file added under an include outside the root', () => {
  const cases: Array<[string, typeof createServer, number]> = [
    ['Vite 7', createServer, 24797],
    ['Vite 8', createVite8Server as unknown as typeof createServer, 24798],
  ]

  for (const [label, createDevServer, port] of cases) {
    test(`${label} reaches the dev stylesheet`, async () => {
      const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-outside-root-')))
      onTestFinished(() => rmSync(root, { force: true, recursive: true }))
      const app = join(root, 'app')
      const shared = join(root, 'shared')
      mkdirSync(join(app, 'src'), { recursive: true })
      mkdirSync(shared, { recursive: true })
      writeFileSync(
        // CommonJS once bundled, so it is compiled in place rather than imported from a temporary file.
        join(app, 'bamboo.config.ts'),
        `export default { include: ['src/**/*.tsx', '../shared/**/*.tsx'], outdir: 'styled-system', preflight: false }\n`,
      )
      writeFileSync(
        join(app, 'src/app.tsx'),
        `import { css } from '../styled-system/css'\nexport const app = css({ width: '[741.1px]' })\n`,
      )
      await settled()

      const server = await createDevServer({
        root: app,
        configFile: false,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd: app, reportSummary: false }) as never],
        server: { middlewareMode: true, hmr: { port } },
      })
      const sheet = async () => (await server.environments.client.transformRequest('virtual:bamboo.css'))?.code ?? ''

      try {
        expect(await sheet()).toContain('w_\\\\[741\\\\.1px\\\\]')
        // The watcher has the folder: what appears in it can be seen.
        await vi.waitFor(() => expect(server.watcher.getWatched()).toHaveProperty([shared]), { timeout: 10_000 })

        // A fresh file each second until one is seen, since the watcher lists a folder before it
        // listens to it and a file landing between the two raises no `add` — a window a loaded
        // machine leaves wide enough to write into. Each is a new addition, so none can be seen
        // unless the folder is watched. Polled with a macrotask between reads, as Vite 8 answers a
        // cached module without leaving the microtask queue.
        const card = `import { css } from '../app/styled-system/css'\nexport const card = css({ width: '[741.2px]' })\n`
        const deadline = Date.now() + 20_000
        let code = ''
        for (let poll = 0; !code.includes('w_\\\\[741\\\\.2px\\\\]') && Date.now() < deadline; poll++) {
          if (poll % 20 === 0) writeFileSync(join(shared, `card-${poll}.tsx`), card)
          await new Promise((resolve) => setTimeout(resolve, 50))
          code = await sheet()
        }

        expect(code, 'no added file ever reached the stylesheet').toContain('w_\\\\[741\\\\.2px\\\\]')
      } finally {
        await server.close()
      }
    }, 120_000)
  }
})

/**
 * A source `include` reaches through a link: a workspace package linked into `node_modules`, as
 * pnpm links one. Vite names each of its modules by where it really is, which the inventory never
 * globbed, so a module looked like no source at all: the build refused the classes compiled for it
 * as outside the CSS extraction graph, and in dev its edits, and a file added beside it, never
 * reached the stylesheet.
 */
describe('a source include reached through a link', () => {
  const card = (width: string) =>
    `import { css } from '../../../app/styled-system/css'\nexport const card = css({ width: '[${width}]' })\n`

  const project = (packages = 'node_modules/@acme/ui/src/**/*.tsx') => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-linked-include-')))
    onTestFinished(() => rmSync(root, { force: true, recursive: true }))
    const app = join(root, 'app')
    const ui = join(root, 'packages/ui')
    mkdirSync(join(app, 'src'), { recursive: true })
    mkdirSync(join(app, 'node_modules/@acme'), { recursive: true })
    mkdirSync(join(ui, 'src'), { recursive: true })
    // A workspace, as Vite finds one: it serves the packages beside the app, not only the app.
    writeFileSync(join(root, 'pnpm-workspace.yaml'), `packages: ['app', 'packages/*']\n`)
    writeFileSync(join(ui, 'package.json'), JSON.stringify({ name: '@acme/ui', version: '0.0.0' }))
    writeFileSync(join(ui, 'src/card.tsx'), card('744.1px'))
    symlinkSync(ui, join(app, 'node_modules/@acme/ui'), process.platform === 'win32' ? 'junction' : 'dir')
    writeFileSync(
      // CommonJS once bundled, so it is compiled in place rather than imported from a temporary file.
      join(app, 'bamboo.config.ts'),
      // Readable, so the linked module's atom can be found by name in both outputs.
      `export default { include: ['src/**/*.tsx', '${packages}'], outdir: 'styled-system', preflight: false, hash: false }\n`,
    )
    writeFileSync(
      join(app, 'src/main.tsx'),
      `import 'virtual:bamboo.css'\nimport { card } from '@acme/ui/src/card'\nexport const main = card\n`,
    )
    return { app, ui }
  }

  const builds: Array<[string, typeof build]> = [
    ['Vite 7', build],
    ['Vite 8', buildVite8 as unknown as typeof build],
  ]
  for (const [label, buildWith] of builds) {
    test(`${label} builds it, with its rule in the stylesheet`, async () => {
      const { app } = project()

      const result = (await buildWith({
        root: app,
        configFile: false,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd: app, reportSummary: false }) as never],
        build: {
          write: false,
          minify: false,
          lib: { entry: join(app, 'src/main.tsx'), formats: ['es'], fileName: 'main' },
        },
      })) as Rollup.RollupOutput[]
      const outputs = result.flatMap((one) => one.output)

      const sheet = outputs.find((output) => output.type === 'asset' && output.fileName.endsWith('.css'))
      expect(sheet && String((sheet as Rollup.OutputAsset).source)).toContain('width: 744.1px')
      expect(outputs.map((output) => (output.type === 'chunk' ? output.code : '')).join('\n')).toContain('w_[744.1px]')
    }, 120_000)
  }

  // As written, and through a wildcard that reaches the link — which no pattern then names.
  const servers: Array<[string, typeof createServer, number, string]> = [
    ['Vite 7', createServer, 24801, 'node_modules/@acme/ui/src/**/*.tsx'],
    ['Vite 8', createVite8Server as unknown as typeof createServer, 24802, 'node_modules/@acme/ui/src/**/*.tsx'],
    ['Vite 7, through a wildcard,', createServer, 24803, 'node_modules/@acme/*/src/**/*.tsx'],
    [
      'Vite 8, through a wildcard,',
      createVite8Server as unknown as typeof createServer,
      24804,
      'node_modules/@acme/*/src/**/*.tsx',
    ],
  ]
  for (const [label, createDevServer, port, packages] of servers) {
    test(`${label} carries an edit to it, and a file added beside it, to the dev stylesheet`, async () => {
      const { app, ui } = project(packages)
      await settled()
      const server = await createDevServer({
        root: app,
        configFile: false,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins: [bamboocss({ cwd: app, reportSummary: false }) as never],
        server: { middlewareMode: true, hmr: { port } },
      })
      const sheet = async () => (await server.environments.client.transformRequest('virtual:bamboo.css'))?.code ?? ''
      /** Polled with a macrotask between reads, as Vite 8 answers a cached module without leaving the microtask queue. */
      const until = async (rule: string, poke: (poll: number) => void = () => {}) => {
        const deadline = Date.now() + 20_000
        let code = ''
        for (let poll = 0; !code.includes(rule) && Date.now() < deadline; poll++) {
          poke(poll)
          await new Promise((resolve) => setTimeout(resolve, 50))
          code = await sheet()
        }
        return code
      }

      try {
        expect(await sheet()).toContain('w_\\\\[744\\\\.1px\\\\]')
        // The module as Vite names it, by where it really is.
        await server.environments.client.transformRequest(posix.join('/@fs', slash(join(ui, 'src/card.tsx'))))

        // Before any edit, so only the first pass can have watched its folder: where it really is,
        // since Vite's watcher passes over `node_modules`. A fresh file each second until one is
        // seen: the watcher lists a folder before it listens to it.
        const added = await until('w_\\\\[744\\\\.3px\\\\]', (poll) => {
          if (poll % 20 === 0) writeFileSync(join(ui, `src/added-${poll}.tsx`), card('744.3px'))
        })
        expect(added, 'no added file ever reached the stylesheet').toContain('w_\\\\[744\\\\.3px\\\\]')

        // Seen by Vite's own watcher, under that name: written again each second until it is, as
        // the watcher can take a moment to listen to a module it has just been given.
        const edited = await until('w_\\\\[744\\\\.2px\\\\]', (poll) => {
          if (poll % 20 === 0) writeFileSync(join(ui, 'src/card.tsx'), card('744.2px') + `// ${poll}\n`)
        })
        expect(edited, 'the edit never reached the stylesheet').toContain('w_\\\\[744\\\\.2px\\\\]')
      } finally {
        await server.close()
      }
    }, 120_000)
  }
})

/**
 * With Vite's `css.devSourcemap` on, the served stylesheet carries a source map from each rule
 * to the call site that first wrote its atom, which is what DevTools shows beside a rule.
 *
 * Through the whole of Vite's pipeline rather than the plugin's hook alone: the map is
 * returned from `load`, and it is Vite that carries it through its CSS plugins, reads the
 * sources off disk into it and inlines it into the module the browser fetches. Each of those
 * is a place a virtual module's map can be dropped.
 */
describe.sequential("the served stylesheet's source map", () => {
  const consumer = join(cwd, 'src/__map-consumer.tsx')
  const source = `import 'virtual:bamboo.css'
import { css } from '../styled-system/css'
export const first = css({ width: '[913.1px]' })
export const second = css({ width: '[913.1px]', height: '[913.2px]' })
`
  /** 0-based column of the call on `line`, where the parser places a call's box. */
  const columnOf = (line: number) => source.split('\n')[line - 1]!.indexOf('css(')

  afterEach(() => {
    rmSync(consumer, { force: true })
  })

  const serve = async (createDevServer: typeof createServer, port: number) => {
    writeFileSync(consumer, source)
    return createDevServer({
      root: cwd,
      configFile: false,
      logLevel: 'silent',
      css: { postcss: { plugins: [] }, devSourcemap: true },
      plugins: [bamboocss({ cwd, reportSummary: false }) as never],
      server: { middlewareMode: true, hmr: { port } },
    })
  }

  /** 1-based line and 0-based column of the first `needle` in `text`. */
  const positionOf = (text: string, needle: string) => {
    const index = text.indexOf(needle)
    expect(index, `${needle} in the served sheet`).toBeGreaterThanOrEqual(0)
    const before = text.slice(0, index)
    return { line: before.split('\n').length, column: index - before.lastIndexOf('\n') - 1 }
  }

  const cases: Array<[string, typeof createServer, number]> = [
    ['Vite 7', createServer, 24790],
    ['Vite 8', createVite8Server as unknown as typeof createServer, 24791],
  ]

  for (const [label, createDevServer, port] of cases) {
    test(`${label} serves the sheet with a map to each atom's first call site`, async () => {
      const server = await serve(createDevServer, port)
      try {
        // The module the consumer imports, so the request runs through the module graph the
        // browser's does. Transforming the consumer first is what a page load does as well.
        await server.environments.client.transformRequest('/src/__map-consumer.tsx')
        const direct = await server.environments.client.transformRequest('virtual:bamboo.css?direct')
        expect(direct?.map, 'a map on the direct request').toBeTruthy()

        const map = direct!.map as { sources: string[]; sourcesContent?: (string | null)[]; mappings: string }
        const tracer = new TraceMap(map as never)
        const sheet = direct!.code

        const width = originalPositionFor(tracer, positionOf(sheet, '.w_\\[913\\.1px\\]'))
        expect(width.source, 'the file').toBe(slash(consumer))
        expect({ line: width.line, column: width.column }).toEqual({ line: 3, column: columnOf(3) })

        const height = originalPositionFor(tracer, positionOf(sheet, '.h_\\[913\\.2px\\]'))
        expect({ line: height.line, column: height.column }).toEqual({ line: 4, column: columnOf(4) })

        // Vite read the source in for DevTools, since a dev server serves no raw `.tsx`.
        expect(map.sourcesContent?.[map.sources.indexOf(slash(consumer))]).toBe(source)

        // And the module the browser actually fetches inlines it.
        const module = await server.environments.client.transformRequest('virtual:bamboo.css')
        expect(module?.code).toContain('sourceMappingURL=data:application/json;base64,')
      } finally {
        await server.close()
      }
    }, 120_000)
  }

  test('serves no map unless asked to', async () => {
    writeFileSync(consumer, source)
    const server = await createServer({
      root: cwd,
      configFile: false,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: false })],
      server: { middlewareMode: true, hmr: { port: 24792 } },
    })
    try {
      await server.environments.client.transformRequest('/src/__map-consumer.tsx')
      const module = await server.environments.client.transformRequest('virtual:bamboo.css')
      expect(module?.code).toContain('w_\\\\[913\\\\.1px\\\\]')
      expect(module?.code).not.toContain('sourceMappingURL')
    } finally {
      await server.close()
    }
  }, 120_000)
})

/**
 * A server bundle emits no CSS, and that is not a missing stylesheet.
 *
 * `build.ssrEmitAssets` is off by default, so Vite discards CSS assets from an SSR build — the
 * client build is what carries the sheet. A server bundle that imports `virtual:bamboo.css`
 * from shared code, which a root component or a layout does, therefore *serves* the stylesheet
 * and then emits nothing, and the guard against a vanished stylesheet read that as the failure
 * it exists to catch.
 *
 * It failed a build that was entirely correct. Qwik's `vite build --ssr` is the shape that
 * showed it: every call compiled, the client bundle carrying the stylesheet, and the server
 * bundle refusing to finish. React Router escapes it only because its plugin turns
 * `ssrEmitAssets` on.
 */
describe('an SSR bundle', () => {
  const entry = join(cwd, 'src/__ssr-no-assets.tsx')

  afterEach(() => {
    rmSync(entry, { force: true })
  })

  const buildSsr = (ssrEmitAssets: boolean) => {
    writeFileSync(
      entry,
      `import 'virtual:bamboo.css'\nimport { css } from '../styled-system/css'\nexport const cls = css({ width: '[912.3px]' })\n`,
    )

    return build({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: false })],
      build: {
        write: false,
        minify: false,
        ssr: entry,
        ssrEmitAssets,
        rollupOptions: { external: [/^react/] },
      },
    }) as Promise<Rollup.RollupOutput | Rollup.RollupOutput[]>
  }

  // An SSR build is not `lib` mode, so Vite hands back one result rather than one per format.
  const outputsOf = (result: Rollup.RollupOutput | Rollup.RollupOutput[]) =>
    (Array.isArray(result) ? result : [result]).flatMap((one) => one.output)

  // Vite drops what an SSR build emits as an asset, so its sheet is never written: what pruning it
  // would have removed was lost from no stylesheet, and a rebuild that starts using such a class is
  // not refused for it. It was, naming a class whose rule no sheet had ever been without.
  test('a watch rebuild using a class its first build did not is not refused for a sheet it never writes', async () => {
    const later = join(cwd, 'src/__ssr-watch-later.tsx')
    const outDir = join(cwd, '__ssr-watch-out')
    const source = (exports: string) =>
      `import 'virtual:bamboo.css'\nimport { css } from '../styled-system/css'\n${exports}export const cls = css({ width: '[912.4px]' })\n`
    rmSync(outDir, { force: true, recursive: true })
    writeFileSync(entry, source(''))
    writeFileSync(
      later,
      `import { css } from '../styled-system/css'\nexport const later = css({ width: '[912.5px]' })\n`,
    )
    await settled()

    const watcher = (await build({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: false })],
      build: {
        watch: {},
        minify: false,
        outDir,
        emptyOutDir: false,
        ssr: entry,
        rollupOptions: { external: [/^react/] },
      },
    })) as Rollup.RollupWatcher

    try {
      expect(await nextEnvironmentWatchBuild(watcher as never)).toBeUndefined()
      expect(readOutputFiles(outDir, '.js')).not.toContain('w_[912.5px]')

      const rebuilt = watchCycleUntil(
        watcher as never,
        () => readOutputFiles(outDir, '.js').includes('w_[912.5px]'),
        'rebuilding SSR to use the class',
      )
      await new Promise((settle) => setTimeout(settle, 800))
      writeFileSync(entry, source(`export { later } from './__ssr-watch-later'\n`))
      expect(await rebuilt).toBeUndefined()
    } finally {
      await watcher.close()
      rmSync(later, { force: true })
      rmSync(outDir, { force: true, recursive: true })
    }
  }, 120_000)

  test('compiles without being asked to carry the stylesheet', async () => {
    const outputs = outputsOf(await buildSsr(false))
    const js = outputs.map((output) => ('code' in output ? output.code : '')).join('\n')

    // The classes are real; it is the *asset* that an SSR build does not emit.
    expect(js).toContain('w_[912.3px]')
    expect(
      outputs.filter((output) => output.type === 'asset' && output.fileName.endsWith('.css')),
      'Vite drops CSS assets from an SSR build unless asked',
    ).toHaveLength(0)
  }, 120_000)

  test('still answers for the stylesheet when it does emit assets', async () => {
    const css = outputsOf(await buildSsr(true))
      .map((output) => ('source' in output && typeof output.source === 'string' ? output.source : ''))
      .join('\n')

    expect(css).toContain('--made-with-bamboo')
    expect(css).toContain('912.3px')
  }, 120_000)
})

/**
 * Before Vite 7.1.10, an SSR library writes its sheet after Vite's asset plugin has deleted what SSR
 * does not emit. Vite 7 and 8 emit none, so a plugin stands in: it keeps the stylesheet module's CSS
 * as Vite's CSS plugin leaves it, and emits it once the asset plugin has run, where the older Vite
 * emits it. Unannounced builds sharing one plugin instance reach the guard without a watch.
 */
describe('a sheet Vite writes though SSR discards its assets', () => {
  const lateSheet = (): VitePlugin => {
    let sheet: string | undefined
    return {
      name: 'test:emit-sheet-late',
      transform(code, id) {
        if (id.split('?')[0] === '\0virtual:bamboo.css') sheet = code
      },
      generateBundle() {
        if (sheet) this.emitFile({ type: 'asset', fileName: 'style.css', source: sheet })
      },
    }
  }
  const widths = { shared: '95.401px', later: '95.402px' }
  const files = {
    shared: join(cwd, 'src/__late-shared.tsx'),
    later: join(cwd, 'src/__late-later.tsx'),
    client: join(cwd, 'src/__late-client.tsx'),
    first: join(cwd, 'src/__late-first.tsx'),
    second: join(cwd, 'src/__late-second.tsx'),
  }
  const configPath = join(cwd, '__late.bamboo.config.ts')
  const outDirs = { client: join(cwd, '__late-client-out'), ssr: join(cwd, '__late-ssr-out') }

  beforeEach(() => {
    const entry = (imports: string) => `import 'virtual:bamboo.css'\n${imports}`
    writeFileSync(
      files.shared,
      `import { css } from '../styled-system/css'\nexport const shared = css({ width: '[${widths.shared}]' })\n`,
    )
    writeFileSync(
      files.later,
      `import { css } from '../styled-system/css'\nexport const later = css({ width: '[${widths.later}]' })\n`,
    )
    writeFileSync(files.client, entry(`export { shared } from './__late-shared'\n`))
    writeFileSync(files.first, entry(`export { shared } from './__late-shared'\n`))
    writeFileSync(
      files.second,
      entry(`export { shared } from './__late-shared'\nexport { later } from './__late-later'\n`),
    )
    writeIsolatedBambooConfig(
      configPath,
      Object.values(files).map((file) => `./src/${basename(file)}`),
    )
  })
  afterEach(() => {
    for (const file of [...Object.values(files), configPath]) rmSync(file, { force: true })
    for (const directory of Object.values(outDirs)) rmSync(directory, { force: true, recursive: true })
  })

  const buildWith = (plugins: VitePlugin[], entry: string, ssr: boolean) =>
    build({
      root: cwd,
      configFile: false,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins,
      build: {
        outDir: ssr ? outDirs.ssr : outDirs.client,
        emptyOutDir: true,
        ...(ssr ? { ssr: entry } : {}),
        rollupOptions: { ...(ssr ? {} : { input: entry }), external: [/^react/] },
      },
    })

  test('a rebuild is not refused for a class its own last sheet pruned', async () => {
    const bamboo = bamboocss({ cwd, configPath, reportSummary: false })
    await buildWith([...bamboo, lateSheet()], files.first, true)
    expect(readOutputFiles(outDirs.ssr, '.css')).toContain(widths.shared)
    expect(readOutputFiles(outDirs.ssr, '.css')).not.toContain(widths.later)

    await buildWith([...bamboo, lateSheet()], files.second, true)
    expect(readOutputFiles(outDirs.ssr, '.css')).toContain(widths.later)
  }, 120_000)

  // Whatever this environment writes, the page links the client's sheet, which does not hold it.
  test('a rebuild is still refused for a class the client sheet pruned', async () => {
    const bamboo = bamboocss({ cwd, configPath, reportSummary: false })
    await buildWith([...bamboo], files.client, false)
    await buildWith([...bamboo, lateSheet()], files.first, true)
    expect(readOutputFiles(outDirs.ssr, '.css')).toContain(widths.shared)

    await expect(buildWith([...bamboo, lateSheet()], files.second, true)).rejects.toThrow(
      'already pruned out of a stylesheet emitted by an earlier one',
    )
  }, 120_000)
})

/**
 * A project with no `styled-system/` on disk, built by the plugin alone.
 *
 * This is what the plugin's `emit` call has always claimed to cover, and it did not: `Builder`
 * read its own "have I emitted" flag before ever setting it, so the first call wrote nothing and
 * the artifacts appeared only after a *later* config change. Nothing noticed, because every real
 * project runs `bamboo codegen` from a `prepare` script or a build step, so the directory was
 * already there — and the cost of that is a whole extra process, ~600 ms of which is module
 * loading to do ~20 ms of work.
 *
 * Reaching `emit` through `load` would not have been enough either. A module's imports are all
 * resolved before any of them is loaded, so `app.tsx` importing both `styled-system/css` and the
 * virtual stylesheet has the first resolved while the directory is still absent — a react-router
 * build failed with "Rolldown failed to resolve import", and `vite dev` served an error overlay.
 * `buildStart` is the first hook Rollup calls, which is why the emit is anchored there.
 *
 * Its own project rather than this sandbox's, because the assertion is about an outdir that does
 * not exist yet and every other suite here reads the one that does.
 */
describe('a project with no generated output yet', () => {
  const projectDir = join(cwd, '__clean-tree-tmp')
  const outdir = join(projectDir, 'styled-system')
  const entry = join(projectDir, 'src/app.tsx')

  beforeEach(() => {
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(
      join(projectDir, 'bamboo.config.ts'),
      `export default { preflight: false, include: ['./src/**/*.tsx'], outdir: 'styled-system' }\n`,
    )
    writeFileSync(
      entry,
      `import 'virtual:bamboo.css'\n` +
        `import { css } from '../styled-system/css'\n` +
        `export const cls = css({ display: 'flex' })\n`,
    )
  })

  afterEach(() => rmSync(projectDir, { force: true, recursive: true }))

  test('generates it during the build, early enough to import from', async () => {
    expect(readdirSync(projectDir)).not.toContain('styled-system')

    const result = (await build({
      root: projectDir,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd: projectDir, reportSummary: false })],
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ['es'], fileName: 'clean-tree' },
      },
    })) as Rollup.RollupOutput[]

    // Written by the build itself, from nothing.
    expect(readdirSync(outdir)).toContain('css')

    // And reached: the import resolved, the call folded — to a hashed name, which is what a
    // build gives a project that sets no `hash` — and the sheet carries its rule. A build that
    // merely wrote the files late would still fail one of these.
    const outputs = [result].flat().flatMap((bundle) => bundle.output)
    const js = outputs.map((output) => ('code' in output ? output.code : '')).join('\n')
    const css = outputs.map((output) => ('source' in output ? String(output.source) : '')).join('\n')
    const className = js.match(/const cls = "([^"]+)"/)?.[1]

    expect(className).toMatch(/^[a-zA-Z]+$/)
    expect(css).toContain(`.${className}`)
    expect(css).toContain('display: flex')
  }, 120_000)

  /**
   * One set of plugin instances, built from twice with the output cleaned in between — as a tool
   * running several builds in one process does. Having written `styled-system/` once, the plugin
   * did not write it again, and the second build failed on `Could not load styled-system/css`.
   */
  test('generates it again for a later build in the same process that finds it gone', async () => {
    const plugins = [bamboocss({ cwd: projectDir, reportSummary: false })]
    const once = () =>
      build({
        root: projectDir,
        logLevel: 'silent',
        css: { postcss: { plugins: [] } },
        plugins,
        build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'clean-tree' } },
      })

    await once()
    rmSync(outdir, { force: true, recursive: true })
    await once()

    expect(readdirSync(outdir)).toContain('css')
  }, 120_000)
})

/**
 * Per-route stylesheets.
 *
 * An atom only one lazily loaded chunk uses goes into a sheet of that chunk's own, attached
 * where Vite's plumbing reads it: the manifest lists it under the chunk, and the preload helper
 * fetches it before the chunk runs. An atom two routes share, or one the entry reaches, stays
 * in the entry sheet, so nothing is downloaded twice. Precedence is unaffected because it lives
 * in the cascade layers and sublayers, and every chunk sheet repeats the order of both.
 */
describe.sequential('per-route stylesheets', () => {
  const html = join(cwd, '__split-index.html')
  const entry = join(cwd, 'src/__split-entry.tsx')
  const routeA = join(cwd, 'src/__split-route-a.tsx')
  const routeB = join(cwd, 'src/__split-route-b.tsx')

  beforeEach(() => {
    writeFileSync(html, `<script type="module" src="/src/__split-entry.tsx"></script>`)
    writeFileSync(
      entry,
      `import 'virtual:bamboo.css'\n` +
        `import { css } from '../styled-system/css'\n` +
        // A higher breakpoint than route b's, on the same property, kept in the entry sheet.
        `document.body.className = css({ color: 'red600', lg: { height: '[814.4px]' } })\n` +
        // Reached from a side effect, or tree-shaking would drop both routes with the exports.
        `window.addEventListener('hashchange', () => {\n` +
        `  const route = location.hash === '#a' ? import('./__split-route-a') : import('./__split-route-b')\n` +
        `  void route.then((m) => { document.body.className = Object.values(m).join(' ') })\n` +
        `})\n`,
    )
    writeFileSync(
      routeA,
      `import { css } from '../styled-system/css'\n` +
        `export const onlyA = css({ width: '[811.1px]', _hover: { width: '[811.2px]' } })\n` +
        // The global styles set `margin` on `*`, in a layer the utilities have to stay above.
        `export const spacedA = css({ margin: '[815.5px]' })\n` +
        `export const shared = css({ gap: '[812.2px]' })\n`,
    )
    writeFileSync(
      routeB,
      `import { css } from '../styled-system/css'\n` +
        `export const onlyB = css({ md: { height: '[813.3px]' } })\n` +
        `export const shared = css({ gap: '[812.2px]' })\n`,
    )
  })

  afterEach(() => {
    for (const file of [html, entry, routeA, routeB]) rmSync(file, { force: true })
  })

  const buildSplit = async (run: typeof build, options: { minify?: false } = { minify: false }) => {
    const result = (await run({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: false })],
      build: {
        write: false,
        manifest: true,
        ...options,
        rollupOptions: { input: html, output: { assetFileNames: 'assets/[name]-[hash][extname]' } },
      },
    })) as Rollup.RollupOutput
    const { output } = result
    const sheets = output.filter(
      (item): item is Rollup.OutputAsset => item.type === 'asset' && item.fileName.endsWith('.css'),
    )
    const source = (asset: Rollup.OutputAsset) => String(asset.source)
    const entrySheet = sheets.find((asset) => source(asset).includes('--made-with-bamboo'))
    const routeSheet = (marker: string) => sheets.find((asset) => source(asset).includes(marker))
    const chunkOf = (name: string) =>
      output.find((item): item is Rollup.OutputChunk => item.type === 'chunk' && item.name === name)
    const manifest = output.find((item) => item.type === 'asset' && item.fileName.endsWith('manifest.json'))
    const builtHtml = output.find((item) => item.type === 'asset' && item.fileName.endsWith('.html'))
    return { output, sheets, source, entrySheet, routeSheet, chunkOf, manifest, builtHtml }
  }

  const assertSplit = (built: Awaited<ReturnType<typeof buildSplit>>) => {
    const { sheets, source, entrySheet, routeSheet, chunkOf, manifest, builtHtml } = built
    expect(entrySheet, 'the entry sheet').toBeDefined()
    const entryCss = source(entrySheet!)
    expect(entryCss, 'an atom the entry uses').toContain('red600')
    expect(entryCss, 'an atom both routes use').toContain('812.2px')
    expect(entryCss, 'an atom only route a uses').not.toContain('811.1px')
    expect(entryCss, 'a conditional atom only route a uses').not.toContain('811.2px')
    expect(entryCss, 'an atom only route b uses').not.toContain('813.3px')

    const sheetA = routeSheet('811.1px')
    const sheetB = routeSheet('813.3px')
    expect(sheetA, 'route a has a sheet').toBeDefined()
    expect(sheetB, 'route b has a sheet').toBeDefined()
    expect(sheets, 'the entry sheet and one per route').toHaveLength(3)

    const cssA = source(sheetA!)
    expect(cssA, 'its conditional atom too, under its sublayer and selector').toContain('811.2px')
    expect(cssA, 'nothing shared').not.toContain('812.2px')
    expect(cssA, 'no sentinel: it is not a sheet the late pass should prune again').not.toContain('--made-with-bamboo')
    expect(cssA, 'the layer order, then the sublayer order, come first').toMatch(
      /^\s*@layer reset,base,tokens,utilities;\s*@layer utilities\s*\{\s*@layer s\d+-c\d+-p\d+(?:\s*,\s*s\d+-c\d+-p\d+)*\s*;/,
    )
    const cssB = source(sheetB!)
    expect(cssB, 'a breakpoint atom keeps its query').toMatch(/@media[^{]*\{[^}]*813\.3px/)
    expect(cssB).not.toContain('812.2px')

    // Route b's `md` height left the entry, and the entry's `lg` height stayed. Whichever sheet
    // the document parses first, `lg` has to come out on top.
    for (const sheets of [entryCss + cssB, cssB + entryCss]) {
      expect(cascadeOrder(sheets).height?.at(-1), 'the higher breakpoint wins across sheets').toContain('lg\\:h_')
    }
    // Route a's margin left with it, and the global `*` margin is in the entry. Whichever sheet
    // the document parses first, the utility has to come out on top.
    expect(entryCss).not.toContain('815.5px')
    for (const sheets of [entryCss + cssA, cssA + entryCss]) {
      expect(cascadeOrder(sheets).margin?.at(-1), 'a utility beats the global styles across sheets').toContain(
        '815\\.5px',
      )
    }

    const chunkA = chunkOf('__split-route-a')
    const chunkB = chunkOf('__split-route-b')
    expect(chunkA?.viteMetadata?.importedCss, 'attached to its chunk').toContain(sheetA!.fileName)
    expect(chunkB?.viteMetadata?.importedCss).toContain(sheetB!.fileName)

    const manifestText = String((manifest as Rollup.OutputAsset).source)
    expect(manifestText, 'the manifest lists the route sheet').toContain(sheetA!.fileName)
    expect(manifestText).toContain(sheetB!.fileName)

    const entryChunk = built.output.find((item): item is Rollup.OutputChunk => item.type === 'chunk' && item.isEntry)
    expect(entryChunk?.code, 'the preload helper fetches the route sheet with the route').toContain(sheetA!.fileName)
    expect(entryChunk?.code).toContain(sheetB!.fileName)

    const htmlText = String((builtHtml as Rollup.OutputAsset).source)
    expect(htmlText, 'the document links the entry sheet').toContain(entrySheet!.fileName)
    expect(htmlText, 'and not a route sheet').not.toContain(sheetA!.fileName)
  }

  test('Vite 7 gives each lazy route the atoms only it uses', async () => {
    assertSplit(await buildSplit(build))
  }, 60_000)

  test('Vite 8 gives each lazy route the atoms only it uses', async () => {
    assertSplit(await buildSplit(buildVite8 as unknown as typeof build))
  }, 60_000)

  // Vite 8 minifies CSS with LightningCSS by default, which removes the sublayer order statement
  // before Bamboo splits the sheet. Every split ran unminified above, so none saw that.
  test('Vite 8 keeps breakpoint order across route sheets under its default minifier', async () => {
    assertSplit(await buildSplit(buildVite8 as unknown as typeof build, {}))
  }, 60_000)

  test('splitCss: false keeps one sheet', async () => {
    const result = (await build({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: false, splitCss: false })],
      build: { write: false, minify: false, rollupOptions: { input: html } },
    })) as Rollup.RollupOutput
    const sheets = result.output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
    expect(sheets).toHaveLength(1)
    expect(String((sheets[0] as Rollup.OutputAsset).source)).toContain('811.1px')
  }, 60_000)
})

/**
 * Vendor-prefixed pairs, through the minifier a default Vite 8 build runs.
 *
 * LightningCSS reads a pair by its order. With the standard property first it kept only
 * `-webkit-backdrop-filter`, which Chrome, Edge and Firefox do not support, so a backdrop blur
 * rendered in Safari alone — in production builds only, since dev does not minify.
 */
describe.sequential('vendor-prefixed pairs', () => {
  const html = join(cwd, '__prefixed-index.html')
  const entry = join(cwd, 'src/__prefixed-entry.tsx')
  const pairs = {
    backdropFilter: ['blur(2px)', 'backdrop-filter'],
    appearance: ['none', 'appearance'],
    backfaceVisibility: ['hidden', 'backface-visibility'],
    clipPath: ['circle(50%)', 'clip-path'],
    hyphens: ['auto', 'hyphens'],
    mask: ['url(a.svg)', 'mask'],
    maskImage: ['url(a.svg)', 'mask-image'],
    maskSize: ['cover', 'mask-size'],
    textSizeAdjust: ['none', 'text-size-adjust'],
    backgroundClip: ['text', 'background-clip'],
    boxDecorationBreak: ['clone', 'box-decoration-break'],
    userSelect: ['none', 'user-select'],
  }

  beforeEach(() => {
    writeFileSync(html, `<script type="module" src="/src/__prefixed-entry.tsx"></script>`)
    writeFileSync(
      entry,
      `import 'virtual:bamboo.css'\n` +
        `import { css } from '../styled-system/css'\n` +
        Object.entries(pairs)
          .map(([property, [value]]) => `document.body.classList.add(css({ ${property}: '${value}' }))\n`)
          .join(''),
    )
  })

  afterEach(() => {
    for (const file of [html, entry]) rmSync(file, { force: true })
  })

  test('keep the standard declaration under Vite 8’s default minifier', async () => {
    const result = (await buildVite8({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, reportSummary: false })],
      build: { write: false, rollupOptions: { input: html } },
    })) as unknown as Rollup.RollupOutput
    const css = result.output
      .filter((item): item is Rollup.OutputAsset => item.type === 'asset' && item.fileName.endsWith('.css'))
      .map((asset) => String(asset.source))
      .join('\n')

    expect(css, 'minified, so the minifier ran').not.toMatch(/;\n\s/)
    for (const [, standard] of Object.values(pairs)) {
      expect(css, standard).toMatch(new RegExp(`[{;]${standard}:`))
    }
  }, 60_000)
})

/**
 * Mixins wherever they are applied, through a real build.
 *
 * The compiler writes every mixin out into ordinary atoms, which only works if the sheet has rules
 * for them — and extraction reads each call on its own, without seeing what it is composed with.
 * The sheet carries the atoms and the mixin's class at every application, and pruning drops the
 * class, which no output names.
 */
describe.sequential('composed mixins', () => {
  const html = join(cwd, '__mixin-index.html')
  const entry = join(cwd, 'src/__mixin-entry.tsx')
  const configPath = join(cwd, '__mixin.bamboo.config.ts')

  beforeEach(() => {
    writeFileSync(
      configPath,
      `import base from './bamboo.config'\n` +
        `export default { ...base, theme: { ...base.theme, extend: { mixins: {\n` +
        `  cardA: { value: { color: 'red', letterSpacing: '0.1em' } },\n` +
        `  cardB: { value: { color: 'blue' } },\n` +
        `  textSmall: { value: { fontSize: '14px' } },\n` +
        `  field: { value: { '& input': { fontSize: '14px' } } },\n` +
        `} } } }\n`,
    )
    writeFileSync(html, `<script type="module" src="/src/__mixin-entry.tsx"></script>`)
    writeFileSync(
      entry,
      `import 'virtual:bamboo.css'\n` +
        `import { css, cva } from '../styled-system/css'\n` +
        `const tone = cva({ base: { color: 'green' }, variants: { tone: { loud: { mixin: 'cardA' } } } })\n` +
        `document.body.className = tone({ tone: 'loud' })\n` +
        `document.documentElement.className = css({ mixin: 'cardB' })\n` +
        `const field = document.createElement('fieldset')\n` +
        `field.className = css({ '& input': { mixin: 'textSmall' } })\n` +
        `document.body.append(field)\n` +
        `const form = document.createElement('form')\n` +
        `form.className = css({ mixin: 'field' })\n` +
        `document.body.append(form)\n`,
    )
  })

  afterEach(() => {
    for (const file of [html, entry, configPath]) rmSync(file, { force: true })
  })

  test('compile to atoms the pruned sheet keeps, wherever they are applied, and no mixin class ships', async () => {
    const result = (await build({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, configPath, reportSummary: false })],
      build: { write: false, minify: false, rollupOptions: { input: html } },
    })) as Rollup.RollupOutput
    const js = result.output
      .filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
      .map((chunk) => chunk.code)
      .join('\n')
    const css = result.output
      .filter((item): item is Rollup.OutputAsset => item.type === 'asset' && item.fileName.endsWith('.css'))
      .map((asset) => String(asset.source))
      .join('\n')

    // The variant's mixin wins over the base, so the base colour is gone from the element.
    const variant = js.match(/document\.body\.className = "([^"]*)"/)?.[1]
    expect(variant?.split(' ')).toEqual(expect.arrayContaining(['c_red', 'ls_0.1em']))
    expect(variant).not.toContain('c_green')
    expect(variant).not.toContain('mixin_')
    expect(css).toMatch(/\.c_red\s*\{\s*color:\s*red/)
    expect(css).toMatch(/\.ls_0\\\.1em\s*\{\s*letter-spacing:\s*0\.1em/)

    // Alone too: its class ranked below every other utility on the element.
    expect(js.match(/document\.documentElement\.className = "([^"]*)"/)?.[1]).toBe('c_blue')
    expect(css).toMatch(/\.c_blue\s*\{\s*color:\s*blue/)

    // What no output names is pruned: the base colour the variant replaced.
    expect(css).not.toContain('.c_green')

    // Alone under a selector, a mixin is written out too: its declaration ranks in the selector's
    // specificity sublayer, over the selected element's own utilities, where its class sat in
    // `compositions` and lost to every one of them.
    expect(js.match(/field\.className = "([^"]*)"/)?.[1]).toBe('[&_input]:fs_14px')
    expect(css).toMatch(/@layer s011-c\d+-p3000\s*\{\s*\.\\\[\\&_input\\\]\\:fs_14px input\s*\{\s*font-size:\s*14px/)
    // So is one with the selector in it: the same declaration, the same atom.
    expect(js.match(/form\.className = "([^"]*)"/)?.[1]).toBe('[&_input]:fs_14px')

    // No output names a mixin's class, so none ships.
    expect(js).not.toContain('mixin_')
    expect(css).not.toContain('mixin_')
  }, 60_000)
})

/**
 * A class the compiler names has to have a rule, whether or not extraction saw the call.
 *
 * The two read a module separately: the compiler reads what Vite hands it, the stylesheet pass
 * reads the source through its parser hooks — for a single-file component, a conversion of it.
 * A call the conversion missed shipped as a class with no rule, unstyled and with no error: a
 * Svelte `{@const}`, an Astro client `<script>`. A parser hook that hides part of a call stands
 * in for any such conversion here, so the check holds whatever framework disagrees next.
 */
describe.sequential('a class the stylesheet pass never saw', () => {
  const html = join(cwd, '__unseen-index.html')
  const entry = join(cwd, 'src/__unseen-entry.tsx')
  const configPath = join(cwd, '__unseen.bamboo.config.ts')

  beforeEach(() => {
    writeFileSync(html, `<script type="module" src="/src/__unseen-entry.tsx"></script>`)
    writeFileSync(
      entry,
      `import 'virtual:bamboo.css'\n` +
        `import { css } from '../styled-system/css'\n` +
        `document.body.className = css({ color: 'red600', width: '[817.7px]' })\n`,
    )
  })

  afterEach(() => {
    for (const file of [html, entry, configPath]) rmSync(file, { force: true })
  })

  const buildWith = (hidden: boolean) => {
    writeFileSync(
      configPath,
      `import base from './bamboo.config'\n` +
        `export default {\n` +
        `  ...base,\n` +
        `  include: ['./src/__unseen-entry.tsx'],\n` +
        (hidden
          ? `  plugins: [{ name: 'hide-a-call', hooks: { 'parser:before': ({ filePath, content }) =>\n` +
            `    filePath.endsWith('__unseen-entry.tsx') ? content.replace("width: '[817.7px]'", '') : undefined } }],\n`
          : '') +
        `}\n`,
    )
    return build({
      root: cwd,
      logLevel: 'silent',
      css: { postcss: { plugins: [] } },
      plugins: [bamboocss({ cwd, configPath, reportSummary: false })],
      build: { write: false, minify: false, rollupOptions: { input: html } },
    })
  }

  test('fails the build, naming the file whose call produced it', async () => {
    await expect(buildWith(true)).rejects.toThrow(
      /w_\[817\.7px\]\n\s+\(NOT extracted, though src\/__unseen-entry\.tsx compiled a call to it; no rule in the sheet\)/,
    )
  }, 60_000)

  test('builds when the stylesheet pass sees every call', async () => {
    const result = (await buildWith(false)) as Rollup.RollupOutput
    const sheet = result.output.find(
      (item): item is Rollup.OutputAsset => item.type === 'asset' && item.fileName.endsWith('.css'),
    )

    expect(String(sheet?.source)).toContain('817.7px')
  }, 60_000)
})
