// @vitest-environment node
// Astro's compiler loads its wasm relative to `import.meta.url`, which happy-dom rewrites away
// from `file:`. A build runs in Node, which is what this pins.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { astroToTsx } from '../../src/astro-to-tsx'
import { loadConfigAndCreateContext } from '../../src/config'
import { parseAndExtract, parseFile } from './fixture'

/**
 * `.astro` components, which nothing converted before the Rust engine.
 *
 * The TypeScript parser read the raw file and recovered from the `---` fences and the template
 * well enough to find calls in it. Oxc rejects that text, so every Astro component failed its
 * build with `EXTRACT_FAILED` until the built-in hook handed it Astro's own TSX.
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

describe('a client `<script>`', () => {
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

describe('extract astro components', () => {
  test('frontmatter, attribute expressions and template expressions', () => {
    expect(parseAndExtract(astroToTsx(COMPONENT)).json.map((item) => [item.name, item.data])).toEqual([
      ['css', [{ bg: 'green.600', padding: '40px' }]],
      ['center', [{ size: '10', borderRadius: 'full' }]],
      ['css', [{ fontWeight: 'bold' }]],
    ])
  })

  /** Built in: a `.astro` file in `include` just works. */
  test('a .astro file extracts through the auto-injected plugin', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bamboo-astro-'))
    try {
      mkdirSync(join(cwd, 'src'))
      writeFileSync(
        join(cwd, 'bamboo.config.mjs'),
        `export default { include: ['src/**/*.astro'], outdir: 'styled-system' }\n`,
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

  /** A component Astro cannot convert fails Astro's own build with a better message. */
  test('source Astro itself rejects converts to nothing rather than throwing', () => {
    expect(() => astroToTsx('---\nconst = \n---\n<div')).not.toThrow()
  })
})
