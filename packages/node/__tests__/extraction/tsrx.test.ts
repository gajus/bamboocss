// @vitest-environment node
// `@tsrx/core` is an ES module a build `require`s in Node. happy-dom's module handling is not
// Node's, which is what this pins.

import { logger } from '@bamboocss/logger'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadConfigAndCreateContext } from '../../src/config'
import { tsrxToTsx } from '@bamboocss/plugin-tsrx'
import { parseAndExtract, parseFile } from './fixture'

const tsrx = (code: string) => {
  const tsx = tsrxToTsx(code, 'Component.tsrx')
  if (tsx === undefined) throw new Error('tsrxToTsx returned undefined')
  return tsx
}

/** Every `[name, data]` item a source's calls extract to. */
const items = (code: string) => parseAndExtract(tsrx(code)).json.map((item) => [item.name, item.data])

const COMPONENT = `import { css } from './styled-system/css'
export function Card(props: { items: string[] }) @{
  const label = css({ color: 'primary' })
  <div className={css({ padding: '4', borderRadius: 'lg' })}>
    @for (const item of props.items; key item) {
      <span className={css({ color: 'row' })}>{item}</span>
    }
  </div>
}
`

describe('a .tsrx file lowered to TSX', () => {
  test('`@{ }` as a function body, with an `@for` inside the JSX it renders', () => {
    expect(items(COMPONENT)).toEqual([
      ['css', [{ color: 'primary' }]],
      ['css', [{ padding: '4', borderRadius: 'lg' }]],
      ['css', [{ color: 'row' }]],
    ])
  })

  test('`=> @{ }` as an arrow body', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\nconst G = (p: { ok: boolean }) => @{\n  <p className={css({ color: 'arrow' })} />\n}\n`,
      ),
    ).toEqual([['css', [{ color: 'arrow' }]]])
  })

  test('`@{ }` as an expression and as a JSX child', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const a = @{ <i className={css({ color: 'expr' })} /> }\n` +
          `const b = <div>@{ <i className={css({ color: 'child' })} /> }</div>\n`,
      ),
    ).toEqual([
      ['css', [{ color: 'expr' }]],
      ['css', [{ color: 'child' }]],
    ])
  })

  test('`@if`/`@else if`/`@else` branches', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `export function F(p: { a: boolean; b: boolean }) @{\n` +
          `  <>\n` +
          `    @if (p.a) {\n      <i className={css({ color: 'a' })} />\n    }` +
          ` @else if (p.b) {\n      <i className={css({ color: 'b' })} />\n    }` +
          ` @else {\n      <i className={css({ color: 'c' })} />\n    }\n` +
          `  </>\n}\n`,
      ),
    ).toEqual([
      ['css', [{ color: 'a' }]],
      ['css', [{ color: 'b' }]],
      ['css', [{ color: 'c' }]],
    ])
  })

  test('`@for` with `index`, `key` and `@empty`', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const list = @for (const item of items; index i; key item) {\n` +
          `  <i className={css({ color: 'row' })}>{i}</i>\n` +
          `} @empty {\n  <i className={css({ color: 'none' })} />\n}\n`,
      ),
    ).toEqual([
      ['css', [{ color: 'row' }]],
      ['css', [{ color: 'none' }]],
    ])
  })

  // The index is declared without an initializer: a call reading it stays unevaluable, so the
  // property drops out rather than folding to a literal like 0.
  test('a `@for` index stays unevaluable', () => {
    const result = parseAndExtract(
      tsrx(
        `import { css } from './styled-system/css'\n` +
          `const list = @for (const item of items; index i) {\n  <i className={css({ order: i })} />\n}\n`,
      ),
    )
    expect(result.json.map((item) => [item.name, item.data])).toEqual([['css', [{}]]])
  })

  test('`@switch` with `@case` and `@default`', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const picked = @switch (v) {\n` +
          `  @case 'a': {\n    <i className={css({ color: 'ca' })} />\n  }\n` +
          `  @default: {\n    <i className={css({ color: 'df' })} />\n  }\n}\n`,
      ),
    ).toEqual([
      ['css', [{ color: 'ca' }]],
      ['css', [{ color: 'df' }]],
    ])
  })

  test('`@try`/`@pending`/`@catch`, with `error` and `reset` in scope', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const body = @try {\n  <i className={css({ color: 'main' })} />\n}` +
          ` @pending {\n  <i className={css({ color: 'wait' })} />\n}` +
          ` @catch (error, reset) {\n  <i className={css({ color: 'err' })}>{String(error)}{reset}</i>\n}\n`,
      ),
    ).toEqual([
      ['css', [{ color: 'main' }]],
      ['css', [{ color: 'wait' }]],
      ['css', [{ color: 'err' }]],
    ])
  })

  test('module-scope `css()` beside templates', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const tone = css({ color: 'scope' })\n` +
          `export function F() @{\n  <i className={tone} />\n}\n`,
      ),
    ).toEqual([['css', [{ color: 'scope' }]]])
  })

  test('`{attr}` shorthand and `<{expr}>` expression tags', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const title = 't'\n` +
          `const el = <{tag} {title} className={css({ color: 'dyn' })}>x</{tag}>\n`,
      ),
    ).toEqual([['css', [{ color: 'dyn' }]]])
  })

  // `//` and `/* */` directly among JSX children are TSRX comments, and a `{` or `<` inside one
  // is not syntax: the text lowers to whitespace, where a copy through would fail the TSX parse.
  test.each([
    ['a line comment', `    // a { comment } with < braces\n`],
    ['a block comment', `    /* a { comment } with < braces */\n`],
  ])('JSX children holding %s', (_, comment) => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const el = <div>\n${comment}  <i className={css({ color: 'cm' })} />\n</div>\n`,
      ),
    ).toEqual([['css', [{ color: 'cm' }]]])
  })

  test('a native `<style>` block, as a child and as a class-map initializer', () => {
    const result = parseAndExtract(
      tsrx(
        `import { css } from './styled-system/css'\n` +
          `const styles = <style>\n  .card { color: red }\n</style>\n` +
          `const el = <div className={styles.card}>\n` +
          `  <style>\n    p { color: blue }\n  </style>\n` +
          `  <i className={css({ color: 'ok' })} />\n` +
          `</div>\n`,
      ),
    )
    // The CSS text is not scanned: nothing carries 'red' or 'blue'.
    expect(result.json.map((item) => [item.name, item.data])).toEqual([['css', [{ color: 'ok' }]]])
    expect(result.css).not.toContain('red')
    expect(result.css).not.toContain('blue')
  })

  // A statement-position `<style>` is both replaced and preceded by `;` at the same offset: the
  // insert must not be dropped against the replacement it shares a start with, or the `(` would
  // read as a call on the line above.
  test('a `<style>` in statement position keeps its `;`', () => {
    const output = tsrx(
      `import { css } from './styled-system/css'\n` +
        `const x = f()\n` +
        `<style>\n  .card { color: red }\n</style>\n` +
        `<div className={css({ color: 'styled' })} />\n`,
    )
    expect(output).toContain(';({} as')
    expect(parseAndExtract(output).json.map((item) => [item.name, item.data])).toEqual([['css', [{ color: 'styled' }]]])
  })

  // An insert and a replacement at one offset, inside JSX children: the directive opens at the
  // exact offset its `;`-less wrap needs.
  test('a directive as the first JSX child, with no whitespace around it', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const el = <div>@if (c) {<i className={css({ color: 'red.100' })} />}</div>\n`,
      ),
    ).toEqual([['css', [{ color: 'red.100' }]]])
  })

  // A destructuring `@catch` parameter cannot be a `let …!: any` declaration; the handler lowers
  // to an arrow so any pattern binds.
  test('`@catch` with a destructured error parameter', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const body = @try {\n  <i className={css({ color: 'main' })} />\n}` +
          ` @catch ({ message }, reset) {\n  <p className={css({ color: 'red.200' })}>{message}</p>\n}\n`,
      ),
    ).toEqual([
      ['css', [{ color: 'main' }]],
      ['css', [{ color: 'red.200' }]],
    ])
  })

  test('a raw `<script>` body is not scanned', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const el = <div>\n` +
          `  <script>\n    const y = css({ color: 'never' })\n  </script>\n` +
          `  <i className={css({ color: 'ok' })} />\n` +
          `</div>\n`,
      ),
    ).toEqual([['css', [{ color: 'ok' }]]])
  })

  test('`await` in an `@{ }` expression makes its arrow `async`', () => {
    expect(
      items(
        `import { css } from './styled-system/css'\n` +
          `const g = @{\n  const x = await f()\n  <i className={css({ color: 'awaits' })} />\n}\n`,
      ),
    ).toEqual([['css', [{ color: 'awaits' }]]])
  })

  // Token accounting declines a `.tsrx` file whose parsed text differs from disk; a file that is
  // already TSX must come back identical or its calls are never attributed.
  test('a file that is already TSX converts to itself', () => {
    const source = `import { css } from './styled-system/css'\nexport const c = css({ color: 'plain' })\n`
    expect(tsrxToTsx(source, 'plain.tsrx')).toBe(source)
  })

  // Diagnostics point at `.tsrx` lines, so no edit may move one.
  test('every line survives: the output is the input line for line', () => {
    const input = COMPONENT
    const outputLines = tsrx(input).split('\n')
    expect(outputLines.length).toBe(input.split('\n').length)
    // Stronger: a call on a line stays on that line.
    input.split('\n').forEach((inputLine, index) => {
      for (const match of inputLine.matchAll(/css\([^)]*\)/g)) {
        expect(outputLines[index]).toContain(match[0])
      }
    })
  })

  // The file fails the framework's own compile too, whose message is the one worth seeing.
  test('TSRX `@tsrx/core` cannot parse comes back as undefined, not a throw', () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined)
    expect(tsrxToTsx('export function F() @{ const = \n', 'bad.tsrx')).toBeUndefined()
    expect(debug).toHaveBeenCalledWith('tsrx', expect.stringContaining('bad.tsrx'))
  })

  test('without `@tsrx/core` the file is read as it was', () => {
    expect(tsrxToTsx(COMPONENT, 'x.tsrx', null)).toBeUndefined()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})

describe('extract tsrx components', () => {
  test.each([true, false])(
    'extracts templates only with explicit registration (configured: %s)',
    async (configured) => {
      const cwd = mkdtempSync(join(tmpdir(), 'bamboo-tsrx-'))
      try {
        mkdirSync(join(cwd, 'src'))
        writeFileSync(
          join(cwd, 'bamboo.config.mjs'),
          (configured
            ? `import { pluginTsrx } from ${JSON.stringify(fileURLToPath(new URL('../../../plugin-tsrx/src/index.ts', import.meta.url)))}\n`
            : '') +
            `export default { include: ['src/**/*.tsrx'], outdir: 'styled-system', plugins: [${configured ? 'pluginTsrx()' : ''}] }\n`,
        )
        writeFileSync(join(cwd, 'src/Card.tsrx'), COMPONENT)
        const ctx = await loadConfigAndCreateContext({ cwd })
        expect(ctx.config.plugins?.some((plugin) => plugin.name === '@bamboocss/plugin-tsrx')).toBe(configured)
        if (configured) {
          expect(parseFile(ctx, 'src/Card.tsrx').css.size).toBe(3)
        } else {
          expect(ctx.parseFile('src/Card.tsrx')).toBeUndefined()
          expect(ctx.parseFailures.size).toBe(1)
        }
      } finally {
        rmSync(cwd, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
