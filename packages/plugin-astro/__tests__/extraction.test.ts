// @vitest-environment node
// Astro's compiler loads its wasm relative to `import.meta.url`, which happy-dom rewrites away
// from `file:`. A build runs in Node, which is what this pins.

import { logger } from '@bamboocss/logger'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { type AstroCompiler, astroToTsx as convert, loadAstroCompiler } from '../src/astro-to-tsx'
import { loadConfigAndCreateContext } from '@bamboocss/node'
import { parseAndExtract, parseFile } from '../../node/__tests__/extraction/fixture'

const require = createRequire(import.meta.url)

/**
 * Both compilers a `.astro` file is read with: the one Astro 7 depends on, which Bamboo loads
 * first, and the one Astro 6 and before depend on. Each case is read with each.
 */
const compilers: Array<[string, AstroCompiler]> = [
  ['@astrojs/compiler-rs', { transform: require('@astrojs/compiler-rs').transform }],
  ['@astrojs/compiler', { convertToTSX: require('@astrojs/compiler/sync').convertToTSX }],
]

/** The red shades a component's css holds, in the order the sheet writes them. */
const reds = (tsx: string) =>
  [...parseAndExtract(tsx).css.matchAll(/color: var\(--colors-red-(\d+)\)/g)].map((match) => Number(match[1]))

/**
 * `.astro` components, which nothing converted before the Rust engine.
 *
 * The TypeScript parser read the raw file and recovered from the `---` fences and the template
 * well enough to find calls in it. Oxc rejects that text, so every Astro component failed its
 * build with `EXTRACT_FAILED` until the configured plugin handed it Astro's own TSX.
 */
const COMPONENT = `---
import { css } from '../styled-system/css'
import { center } from '../styled-system/patterns'
const tone = 'green.600'
---

<main class={css({ bg: tone, padding: '40px' })}>
  <span class={center({ size: '10', borderRadius: 'full' })}>{Astro.props.label}</span>
  {[1, 2].map((n) => <b class={css({ fontWeight: 'bold' })}>{n}</b>)}
</main>
<style>
  main { display: block; }
</style>
`

describe.each(compilers)('a client `<script>`, read with %s', (_, compiler) => {
  const astroToTsx = (code: string, filename?: string) => convert(code, filename, compiler)

  // Astro bundles it as a module of its own and Vite compiles it, so its calls have to reach the
  // stylesheet too. Astro's TSX holds it only inside an arrow function, where its imports bind
  // nothing, and its calls went unseen: their classes shipped with no rule.
  test('with its own import, on a page with no frontmatter', () => {
    const result = parseAndExtract(
      astroToTsx(
        `<button id="b">x</button>\n<script>\n  import { css } from '../styled-system/css'\n` +
          `  document.getElementById('b')!.className = css({ color: 'red.300' })\n</script>\n`,
        'index.astro',
      ),
    )

    expect(result.css).toContain('color: var(--colors-red-300)')
  })

  test('beside a frontmatter importing the same thing, and declaring the same names', () => {
    const result = parseAndExtract(
      astroToTsx(
        `---\nimport { css } from '../styled-system/css'\nconst tone = css({ color: 'blue.300' })\n---\n` +
          `<h1 class={tone}>Hi</h1>\n` +
          `<script>\n  import { css } from '../styled-system/css'\n  const tone = css({ color: 'red.300' })\n` +
          `  document.body.className = tone\n</script>\n`,
        'index.astro',
      ),
    )

    expect(result.css).toContain('color: var(--colors-blue-300)')
    expect(result.css).toContain('color: var(--colors-red-300)')
  })

  test('an inline script, which Astro leaves as written, is not read as one', () => {
    const tsx = astroToTsx(`<script is:inline>window.x = 1</script>\n`, 'index.astro')

    expect(tsx).not.toMatch(/^\{\nwindow\.x/m)
  })
})

describe.each(compilers)('an astro component, read with %s', (_, compiler) => {
  const astroToTsx = (code: string, filename?: string) => convert(code, filename, compiler)

  test('frontmatter, attribute expressions and template expressions', () => {
    expect(parseAndExtract(astroToTsx(COMPONENT)).json.map((item) => [item.name, item.data])).toEqual([
      ['css', [{ bg: 'green.600', padding: '40px' }]],
      ['center', [{ size: '10', borderRadius: 'full' }]],
      ['css', [{ fontWeight: 'bold' }]],
    ])
  })

  /** A component Astro cannot convert fails Astro's own build with a better message. */
  test('source Astro itself rejects converts to nothing rather than throwing', () => {
    expect(() => astroToTsx('---\nconst = \n---\n<div')).not.toThrow()
  })

  // Astro's TSX conversion matched an expression's braces, quotes and backticks, and knew no
  // regex: the expression ended at the regex's `}`, and the file did not parse at all.
  test.each([
    ['a `}`', "{x.replace(/}/g, '')}"],
    ['a `{`', "{x.replace(/{/g, '')}"],
    ['a `{` after an escape', "{x.replace(/\\${/g, '')}"],
    ['a backtick', "{x.replace(/`/g, '')}"],
    ['a quote', `{x.replace(/'/g, "").replace(/"/g, '')}`],
    ['an attribute', '<span title={/}/.source} />'],
    ['an element in an expression', "{[x].map((s) => <b title={s.replace(/}/g, '')} />)}"],
    ['an arrow', '{[x].filter((s) => /}/.test(s))}'],
  ])('a regex holding %s in an expression', (_, expression) => {
    const tsx = astroToTsx(
      `---\nimport { css } from '../styled-system/css'\nconst x = 'a}'\n---\n` +
        `<p class={css({ color: 'red.100' })}>${expression}</p>\n<p class={css({ color: 'red.200' })} />\n`,
    )
    expect(reds(tsx)).toEqual([100, 200])
  })

  // Astro allows several nodes side by side in an expression. Its TSX put each element in a
  // fragment of its own, and two fragments side by side are no expression: the file did not parse.
  test.each([
    [
      'in parentheses',
      "{cond && (\n  <i class={css({ color: 'red.100' })} />\n  <b class={css({ color: 'red.200' })} />\n)}",
    ],
    [
      'in each branch',
      "{cond ? (\n  <i class={css({ color: 'red.100' })} /> <b />\n) : (\n  <b class={css({ color: 'red.200' })} />\n)}",
    ],
    ['alone', "{ <i class={css({ color: 'red.100' })} /> <b class={css({ color: 'red.200' })} /> }"],
    [
      'from a callback',
      "{[1].map(() => (\n  <i class={css({ color: 'red.100' })} />\n  <b class={css({ color: 'red.200' })} />\n))}",
    ],
  ])('nodes side by side %s', (_, expression) => {
    const tsx = astroToTsx(
      `---\nimport { css } from '../styled-system/css'\nconst cond = true\n---\n` +
        `<div>${expression}</div>\n<p class={css({ color: 'red.300' })} />\n`,
    )
    expect(reds(tsx)).toEqual([100, 200, 300])
  })
})

// Astro 6 and before take text and expressions among them as well, which Astro 7's compiler
// rejects, and so does its build.
test('nodes side by side with text and expressions among them, read with @astrojs/compiler', () => {
  const tsx = convert(
    `---\nimport { css } from '../styled-system/css'\nconst cond = true\n---\n` +
      `<div>{cond ? (\n  <i class={css({ color: 'red.100' })} /> text {cond}\n) : (\n  <b /> (more) text\n)}</div>\n` +
      `<p class={css({ color: 'red.200' })} />\n`,
    undefined,
    compilers[1]![1],
  )
  expect(reds(tsx)).toEqual([100, 200])
})

describe('the compiler a `.astro` file is read with', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const requiring = (available: Record<string, unknown>) =>
    ((id: string) => {
      if (id in available) return available[id]
      throw new Error(`Cannot find module '${id}'`)
    }) as unknown as NodeJS.Require

  test('is either that loads, or both', () => {
    const transform = () => ({ code: '' })
    const convertToTSX = () => ({ code: '' })
    const both = requiring({ '@astrojs/compiler-rs': { transform }, '@astrojs/compiler/sync': { convertToTSX } })
    expect(loadAstroCompiler(both)).toEqual({ transform, convertToTSX })
    expect(loadAstroCompiler(requiring({ '@astrojs/compiler/sync': { convertToTSX } }))).toEqual({ convertToTSX })
  })

  // A platform binary missing, or a Node that cannot `require` an ES module: the package is there,
  // and asking for it to be installed would send the reader the wrong way.
  test('says why one that is installed failed to load', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const broken = ((id: string) => {
      if (id === '@astrojs/compiler-rs') throw new Error('Cannot find native binding for linux-x64-musl')
      throw Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' })
    }) as unknown as NodeJS.Require
    expect(loadAstroCompiler(broken)).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      'astro',
      expect.stringContaining('`@astrojs/compiler-rs` is installed and failed to load: Cannot find native binding'),
    )
  })

  // Astro 7's compiler rejects templates Astro 6 takes — text among nodes side by side — and a
  // project on Astro 6 can have it too, through another package.
  test('reads with `@astrojs/compiler` what `@astrojs/compiler-rs` cannot', () => {
    const [[, rust], [, go]] = compilers
    const source =
      `---\nimport { css } from '../styled-system/css'\nconst cond = true\n---\n` +
      `<div>{cond && (\n  <i class={css({ color: 'red.100' })} /> text\n)}</div>\n`
    expect(convert(source, 'Page.astro', rust)).toBe('')
    expect(reds(convert(source, 'Page.astro', { ...rust, ...go }))).toEqual([100])
  })

  // The template is prepared only for a conversion that does not parse, so one that converts
  // today is converted as it was, whatever the preparation would have made of it.
  test('converts a template that converts as it is once, as it is', () => {
    const sources: string[] = []
    const convertToTSX = (source: string) => {
      sources.push(source)
      return { code: source.includes('/}/') ? 'export {}' : 'export const = ' }
    }
    convert(`<p>{x.replace(/}/g, '')}</p>`, 'Page.astro', { convertToTSX })
    expect(sources).toEqual([`<p>{x.replace(/}/g, '')}</p>`])
    sources.length = 0
    convert(`<p>{x.replace(/{/g, '')}</p>`, 'Page.astro', { convertToTSX })
    expect(sources, 'and again, prepared, when it does not').toEqual([
      `<p>{x.replace(/{/g, '')}</p>`,
      `<p>{x.replace(/\\x7b/g, '')}</p>`,
    ])
  })

  // Every `.astro` file was read as empty, without a word.
  test('says when there is none, and reads a component as nothing', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    expect(loadAstroCompiler(requiring({}))).toBeNull()
    expect(warn).toHaveBeenCalledWith('astro', expect.stringContaining('@astrojs/compiler-rs'))
    expect(convert(COMPONENT, 'Page.astro', null)).toBe('')
  })
})

describe('extract astro components', () => {
  test('a .astro file extracts through the explicitly configured plugin', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bamboo-astro-'))
    try {
      mkdirSync(join(cwd, 'src'))
      writeFileSync(
        join(cwd, 'bamboo.config.mjs'),
        `import { pluginAstro } from ${JSON.stringify(resolve(__dirname, '../src/index.ts'))}
export default { plugins: [pluginAstro()], include: ['src/**/*.astro'], outdir: 'styled-system' }\n`,
      )
      writeFileSync(join(cwd, 'src/Page.astro'), COMPONENT)
      const ctx = await loadConfigAndCreateContext({ cwd })
      const result = parseFile(ctx, 'src/Page.astro')

      expect(result.css.size).toBe(2)
      expect(result.pattern.get('center')?.size).toBe(1)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 60_000)
})
