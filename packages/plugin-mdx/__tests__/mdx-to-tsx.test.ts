import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterAll, describe, expect, test } from 'vitest'
import { Builder } from '@bamboocss/node'
import { mdxToTsx, pluginMdx } from '../src/mdx-to-tsx'

/** What the TSX keeps, with the blanks between it run together. */
const kept = (source: string) => mdxToTsx(source).replace(/\s+/g, ' ').trim()

const lines = (text: string) => text.split('\n').length

describe('mdxToTsx', () => {
  test('keeps imports, exports, tags and expressions where they stand, and blanks the rest', () => {
    const source = [
      `---`,
      `title: A {title}`,
      `---`,
      `import { css } from 'styled-system/css'`,
      ``,
      `# It's a title`,
      ``,
      `Prose, with \`css({ color: 'green.300' })\` in it.`,
      ``,
      `<div className={css({ color: 'red.300' })}>Hello, {name}</div>`,
      ``,
      '```tsx',
      `css({ color: 'yellow.300' })`,
      '```',
      ``,
    ].join('\n')

    const tsx = mdxToTsx(source)

    expect(lines(tsx), 'every line where it was').toBe(lines(source))
    expect(tsx.split('\n')[3]).toBe(`import { css } from 'styled-system/css'`)
    expect(kept(source)).toBe(
      `import { css } from 'styled-system/css' ;<><div className={css({ color: 'red.300' })}> {name}</div> </>`,
    )
  })

  test('a line starting `import ` inside a paragraph is prose', () => {
    expect(kept(`Some prose, saying to\nimport the package first.\n`)).toBe('')
  })

  test('after a heading, a break or an element, it is an import', () => {
    expect(kept(`# Title\nimport { css } from 'x'\n`)).toBe(`import { css } from 'x'`)
    expect(kept(`Title\n=====\nimport { css } from 'x'\n`), 'a setext heading').toBe(`import { css } from 'x'`)
    expect(kept(`Prose.\n\n***\nimport { css } from 'x'\n`), 'a thematic break').toBe(`import { css } from 'x'`)
    expect(kept(`<Note />\nimport { css } from 'x'\n`)).toBe(`;<><Note /> </>;import { css } from 'x'`)
  })

  // MDX hoists it: the compiled module imports what the element's children call.
  test('an import among the children of an element is moved to the end, where it binds the same', () => {
    const source = `<Foo>\n\nimport { css } from 'x'\n\n<div className={css({ color: 'red.300' })} />\n\n</Foo>\n`
    const tsx = mdxToTsx(source)

    expect(tsx.split('\n')[2]!.trim(), 'blank where it stood').toBe('')
    expect(kept(source)).toBe(
      `;<><Foo> <div className={css({ color: 'red.300' })} /> </Foo> </>; import { css } from 'x'`,
    )
  })

  // MDX reads past one, and an import behind it was blanked.
  test('a byte order mark is passed over', () => {
    const tsx = mdxToTsx(`﻿import { css } from 'x'\n`)
    expect(tsx).toBe(`﻿import { css } from 'x'\n`)
  })

  test('an export runs to the blank line after it, once nothing it opened is open', () => {
    const braces = `export const a = {\n  b: 1,\n\n  c: 2,\n}\n\nProse.\n`
    const parentheses = `export const a = f(\n  1,\n\n  2,\n)\n\nProse.\n`

    expect(kept(braces)).toBe(`export const a = { b: 1, c: 2, }`)
    expect(kept(parentheses)).toBe(`export const a = f( 1, 2, )`)
  })

  // `export const a = 'b'` and a `<` on the line after read as a comparison.
  test('an export without a semicolon is not continued by the fragment after it', () => {
    expect(kept(`export const a = 'b'\n\n<p />\n`)).toBe(`export const a = 'b' ;<><p /> </>`)
  })

  test('an expression runs to its own brace, past braces in strings, regular expressions and comments', () => {
    for (const expression of [
      `{'a}b'.replace(/}/g, '')}`,
      '{`a ${ {b: 1}.b } }`}',
      `{/* a } comment */}`,
      `{cond && <p>It's here, isn't it? {x}</p>}`,
    ]) {
      expect(kept(`Before ${expression} after.\n`)).toBe(`;<>${expression} </>`)
    }
  })

  // MDX leaves a blockquote's markers out of what runs across its lines.
  test('a tag or an expression across the lines of a blockquote is read without its markers', () => {
    expect(kept(`> {1 +\n> 2}\n`)).toBe(`;<>{1 + 2} </>`)
    expect(kept(`> <Foo\n>   className={css({ color: 'red.300' })}>\n> hi\n> </Foo>\n`)).toBe(
      `;<><Foo className={css({ color: 'red.300' })}> </Foo> </>`,
    )
  })

  test('a tag keeps its attributes whole, a `>` in one closing nothing', () => {
    const tag = `<Box title="a > b" data={{ x: '}' }} />`
    expect(kept(`${tag}\n`)).toBe(`;<>${tag} </>`)
  })

  // An unbalanced brace in one read the rest of the document as an expression.
  test('a link reference definition is prose, but not in a paragraph it continues', () => {
    expect(kept(`[a]: http://x/{\n\nText {z}\n`)).toBe(`;<>{z} </>`)
    expect(kept(`[a]: /url\n  'a title {x}'\n`), 'its title on the line after').toBe('')
    expect(kept(`[a]: http://x 'title'\n'{z}'\n`), 'not a second title').toBe(`;<>{z} </>`)
    expect(kept(`[a]: http://x\n> "{y}"\n`), 'not one in a blockquote').toBe(`;<>{y} </>`)
    expect(kept(`- [a]: {x}\n`), 'on a list item').toBe('')
    expect(kept(`Text\n[a]: {z}\n`)).toBe(`;<>{z} </>`)
  })

  // As MDX reads them, these are paragraphs.
  test('a line that only starts like a definition is Markdown', () => {
    expect(kept(`[Note]: use <Box /> here\n`)).toBe(`;<><Box /> </>`)
    expect(kept(`[^1]: See {note}\n`), 'a footnote').toBe(`;<>{note} </>`)
  })

  test('a `](` that opens no link leaves what follows it', () => {
    expect(kept(`[a](b {value})\n`)).toBe(`;<>{value} </>`)
  })

  test('code spans, escapes, links and autolinks are prose', () => {
    expect(kept('Call `css({ a: "<b>" })` or ``a ` {b}`` here.\n')).toBe('')
    expect(kept(`Write \\{ and \\< literally.\n`)).toBe('')
    expect(kept(`See [docs](https://example.com/{id}) and <https://example.com>.\n`)).toBe('')
  })

  // As MDX ends it, with the container: not at the end of the file.
  // A blockquote cannot interrupt code: the `>` lines are what the example shows.
  test('a fence is closed only at the depth it was opened', () => {
    const nested = '```md\n> ```js\n> css({ a: 1 })\n> ```\n```\n\n<Box />\n'
    expect(kept(nested)).toBe(`;<><Box /> </>`)
  })

  // MDX lets them interrupt a paragraph: a stray backtick before one left the tag unbalanced.
  test('a code span ends where a tag or an expression opens a line', () => {
    expect(kept('<Box>\na `b\n</Box>\nc`\n')).toBe(`;<><Box> </Box> </>`)
    expect(kept('Install with `npm\n<Badge />\nthen `y`\n')).toBe(`;<><Badge /> </>`)
    expect(kept('a `b\n{x}\nc` d\n')).toBe(`;<>{x} </>`)
  })

  // An empty `>` line ends the paragraph, as a heading in the outer blockquote does.
  test('a code span ends with its blockquote paragraph', () => {
    expect(kept('> > a `b\n>\n> {x} c`\n')).toBe(`;<>{x} </>`)
    expect(kept('> > a `b\n> # h {y}\n> c`\n')).toBe(`;<>{y} </>`)
  })

  // Only an item numbered 1 interrupts a paragraph: a span runs on past one numbered 2.
  test('a code span runs past a list marker that cannot interrupt it', () => {
    expect(kept('Use `x\n2. {y}` here\n')).toBe('')
  })

  test('a code span ends with its paragraph, where a fence or a heading begins', () => {
    const fence = 'Press the ` key\n```js\nconst a = `x`\n```\n\n<Box />\n'
    expect(kept(fence)).toBe(`;<><Box /> </>`)
    expect(kept('a `b\n# H {x} `c`\n')).toBe(`;<>{x} </>`)
  })

  test('a fence in a blockquote or a list item ends with it', () => {
    expect(kept('> ```js\n> css({})\n\n<div className={css({})} />\n')).toBe(`;<><div className={css({})} /> </>`)
    expect(kept('- ```js\n  css({})\nleft\n\n<p />\n')).toBe(`;<><p /> </>`)
    expect(kept('- item\n\n  ```js\n  css({})\n\nafter <Box />\n'), 'on a later line of the item').toBe(
      `;<><Box /> </>`,
    )
    expect(kept('- a\n\n  > q\n\n  ```js\n  x\n- {ok}\n'), 'past a blockquote in the item').toBe(`;<>{ok} </>`)
    expect(kept('- > ```js\n  > {x}\n  > ```\n'), 'in a blockquote in the item').toBe('')
    // Past all five spaces, as MDX reads it, so the fence indented two is not in the item.
    expect(kept('-     a\n\n  ```js\n  x\n\nb {y}\n'), 'past the spaces after the marker').toBe('')
  })

  test('a fence is code, in a list or an element as at the top', () => {
    const list = `- item\n\n  \`\`\`js\n  css({ a: '{' })\n  \`\`\`\n`
    const element = `<Tabs>\n  <Tab>\n\n    ~~~tsx\n    <div className={css({ a: 1 })} />\n    ~~~\n\n  </Tab>\n</Tabs>\n`

    expect(kept(list)).toBe('')
    expect(kept(element)).toBe(`;<><Tabs> <Tab> </Tab> </Tabs> </>`)
  })

  // As `remark-math` reads it: `{\text{max}}` is no expression.
  test('math is text, where it holds LaTeX', () => {
    expect(kept(`$$\n\\frac{a}{b}\n$$\n`)).toBe('')
    expect(kept(`$$\n{css({})}\n$$\n`), 'no LaTeX, no math').toBe(`;<>{css({})} </>`)
    expect(kept(`$$\\frac{a}{b}$$ <Box />\n`), 'on one line, inline').toBe(`;<><Box /> </>`)
    expect(kept(`> $$\n> \\alpha\n\n<Box />\n`), 'ended with its blockquote').toBe(`;<><Box /> </>`)
    expect(kept(`Costs $5 {css({})} and \\$10, or $20.\n`), 'an escaped dollar').toBe(`;<>{css({})} </>`)
    expect(kept(`$$\n\\begin{aligned}\na &= {b}\n\nc &= {d}\n\\end{aligned}\n$$\n`), 'a blank line in it').toBe('')
    expect(kept(`Where $\\alpha_{\\text{max}}$ holds.\n`)).toBe('')
    expect(kept(`From $5 <Badge /> to $10.\n`)).toBe(`;<><Badge /> </>`)
  })
})

// Linear, and no deeper a stack for a deeper document.
test('a long line or a deep document is read in one pass', () => {
  const start = performance.now()
  mdxToTsx('[' + '](a'.repeat(40_000))
  mdxToTsx('a](b\n'.repeat(100_000))
  mdxToTsx('`a``b'.repeat(20_000))
  expect(performance.now() - start).toBeLessThan(2_000)

  expect(() => mdxToTsx('<a '.repeat(10_000))).not.toThrow()
  expect(() => mdxToTsx(`{${'<a>'.repeat(20_000)}}`)).not.toThrow()
})

describe('pluginMdx', () => {
  const hook = pluginMdx().hooks!['parser:before']!
  const configure = () => {}

  test('converts an `.mdx` file', () => {
    expect(hook({ filePath: '/app/Doc.mdx', content: '# Hi\n', original: '# Hi\n', configure })).toBe('    \n')
    expect(hook({ filePath: '/app/Card.tsx', content: 'x', original: 'x', configure })).toBeUndefined()
  })

  // A project that converts its MDX itself keeps its own.
  test('unless a hook before it made something of the file', () => {
    expect(hook({ filePath: '/app/Doc.mdx', content: 'const a = 1', original: '# Hi\n', configure })).toBeUndefined()
  })
})

const directories: string[] = []
afterAll(() => {
  for (const directory of directories) rmSync(directory, { force: true, recursive: true })
})

/**
 * The document reached the parser as it was, and the first apostrophe in its prose failed it,
 * taking every style in it out of the stylesheet. One with JSX and nothing else parsed, and had
 * the `css()` in a code example read as a call.
 */
test('an `.mdx` file in `include` reaches the stylesheet, without its code', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-mdx-'))
  directories.push(cwd)
  mkdirSync(join(cwd, 'src'))
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    `import { pluginMdx } from ${JSON.stringify(resolve(__dirname, '../src/index.ts'))}
export default { plugins: [pluginMdx()], preflight: false, include: ['src/**/*.mdx'], outdir: 'styled-system' }\n`,
  )
  writeFileSync(
    join(cwd, 'src/doc.mdx'),
    [
      `import { css } from '../styled-system/css'`,
      `export const accent = css({ width: '[1.111px]' })`,
      ``,
      `# It's a title`,
      ``,
      `Prose, with \`css({ width: '[2.222px]' })\` in it.`,
      ``,
      `<div className={css({ width: '[3.333px]' })}>It's {css({ width: '[4.444px]' }) && 'here'}</div>`,
      ``,
      '```tsx',
      `const example = css({ width: '[5.555px]' })`,
      '```',
      ``,
    ].join('\n'),
  )

  const builder = new Builder()
  await builder.setup({ cwd })
  builder.extract()
  const css = builder.toCss()

  for (const width of ['1.111px', '3.333px', '4.444px']) expect(css).toContain(width)
  for (const width of ['2.222px', '5.555px']) expect(css, 'code').not.toContain(width)
})
