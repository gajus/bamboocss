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
