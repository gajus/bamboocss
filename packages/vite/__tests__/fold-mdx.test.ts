import { compile } from '@mdx-js/mdx'
import { describe, expect, test } from 'vitest'
import { pluginMdx } from '../../plugin-mdx/src'
import { compilerParsePath } from '../src/plugin'
import { createFoldFixture, selectorsFor } from './fixture'

/**
 * An `.mdx` document, compiled as `@mdx-js/rollup` compiles it, and then by Bamboo.
 *
 * Neither read it. The stylesheet handed the document to the parser as it was, and the first
 * apostrophe in its prose failed it; the compiler did not take `.mdx` modules at all, so the
 * page kept a `css()` call, which throws when it runs.
 */
const doc = [
  `import { css } from 'styled-system/css'`,
  `export const accent = css({ color: 'blue.300' })`,
  ``,
  `# It's a title`,
  ``,
  `Prose, with \`css({ color: 'green.300' })\` in it as code.`,
  ``,
  `<div className={css({ color: 'red.300' })}>Hello, it's {css({ margin: '4' }) && 'here'}</div>`,
  ``,
  '```tsx',
  `const example = css({ color: 'yellow.300' })`,
  '```',
  ``,
].join('\n')

const build = async (source: string, development: boolean) => {
  const fixture = createFoldFixture({ plugins: [pluginMdx()] })
  // The stylesheet reads the document, through the MDX converter; the compiler reads what MDX
  // compiled it to, under the path the plugin gives it (`compilerParsePath`).
  fixture.addFiles({ 'app/src/Doc.mdx': source })
  const sheet = fixture.getCss()
  const compiled = String(await compile({ value: source, path: '/app/src/Doc.mdx' }, { development }))
  const parsePath = compilerParsePath('/app/src/Doc.mdx', compiled)
  const result = fixture.foldStrict(compiled, parsePath!)
  const classes = result.folded.flatMap((entry) => entry.classNames)
  return {
    parsePath,
    code: result.code,
    classes,
    skipped: result.skipped.map((entry) => [entry.name, entry.reason]),
    // Against the sheet the document alone produced, before the compiled module was read.
    missing: classes.flatMap(selectorsFor).filter((selector) => !sheet.includes(selector)),
    sheet,
  }
}

describe.each([false, true])('an MDX document, compiled with development: %s', (development) => {
  test('its `css()` calls compile, to classes the document gave the sheet rules for', async () => {
    const result = await build(doc, development)

    expect(result.parsePath).toBe('/app/src/Doc.mdx.__bamboo__.tsx')
    expect(result.skipped).toEqual([])
    expect(result.classes).toEqual(expect.arrayContaining(['c_blue.300', 'c_red.300', 'm_4']))
    expect(result.missing).toEqual([])
    for (const style of [`color: 'blue.300'`, `color: 'red.300'`, `margin: '4'`]) {
      expect(result.code, 'compiled away').not.toContain(style)
    }
  })

  test('a call in code stays code', async () => {
    const result = await build(doc, development)

    expect(result.sheet).not.toContain('yellow')
    expect(result.sheet).not.toContain('green')
    expect(result.code).toContain(`const example = css({ color: 'yellow.300' })`)
  })
})

test('a document MDX has not compiled yet is left to it', () => {
  expect(compilerParsePath('/app/src/Doc.mdx', doc)).toBeNull()
  // Naming what MDX compiles to in its prose.
  expect(compilerParsePath('/app/src/About.mdx', 'MDX defines `function MDXContent()` for it.\n')).toBeNull()
})

// A fence in the document's own exports, as a live editor's snippet: it is the compiled module's too.
test('a compiled document is compiled, whatever its exports hold', async () => {
  const source = 'export const snippet = `\n~~~js\nlet a = 1\n~~~\n`\n\n# Title\n'
  const compiled = String(await compile({ value: source, path: '/app/src/Snippet.mdx' }))
  expect(compilerParsePath('/app/src/Snippet.mdx', compiled)).toBe('/app/src/Snippet.mdx.__bamboo__.tsx')
})
