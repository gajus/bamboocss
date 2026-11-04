import { compile } from '@tsrx/react'
import { describe, expect, test } from 'vitest'
import { pluginTsrx } from '@bamboocss/plugin-tsrx'
import { compilerParsePath } from '../src/plugin'
import { createFoldFixture, selectorsFor } from './fixture'

/**
 * A `.tsrx` component, compiled as `@tsrx/vite-plugin-react` compiles it, and then by Bamboo.
 *
 * The stylesheet reads the `.tsrx` source itself, through the auto-injected TSRX plugin, while the
 * compiler folds what the framework's `enforce: 'pre'` plugin already turned into TSX under the
 * path the plugin gives it (`compilerParsePath`). A class the transform emits has a rule behind
 * it only when those two readings agree.
 */
const build = (source: string) => {
  const fixture = createFoldFixture({ plugins: [pluginTsrx()] })
  fixture.addFiles({ 'app/src/Component.tsrx': source })
  const sheet = fixture.getCss()
  const compiled = compile(source, '/app/src/Component.tsrx').code
  const parsePath = compilerParsePath('/app/src/Component.tsrx', compiled)
  const result = fixture.foldStrict(compiled, parsePath!)
  const classes = result.folded.flatMap((entry) => entry.classNames)
  return {
    parsePath,
    code: result.code,
    classes,
    skipped: result.skipped.map((entry) => [entry.name, entry.reason]),
    // Against the sheet the `.tsrx` source alone produced, before the compiled module was read.
    missing: classes.flatMap(selectorsFor).filter((selector) => !sheet.includes(selector)),
    sheet,
  }
}

describe('a .tsrx component, compiled by @tsrx/react and folded by bamboo', () => {
  test('an `@{ }` body with an `@for` inside', () => {
    const result = build(
      `import { css } from 'styled-system/css'\n` +
        `export function Card(props: { items: string[] }) @{\n` +
        `  const label = css({ color: 'red.100' })\n` +
        `  <div className={css({ padding: '4', borderRadius: 'lg' })}>\n` +
        `    @for (const item of props.items; key item) {\n` +
        `      <span className={css({ color: 'red.200' })}>{item}</span>\n` +
        `    }\n` +
        `  </div>\n` +
        `}\n`,
    )

    expect(result.parsePath).toBe('/app/src/Component.tsrx.__bamboo__.tsx')
    expect(result.skipped).toEqual([])
    expect(result.classes).toEqual(expect.arrayContaining(['c_red.100', 'p_4 bdr_lg', 'c_red.200']))
    expect(result.missing).toEqual([])
    for (const style of [`color: 'red.100'`, `padding: '4'`, `color: 'red.200'`]) {
      expect(result.code, 'compiled away').not.toContain(style)
    }
  })

  test('`@if`/`@else` branches', () => {
    const result = build(
      `import { css } from 'styled-system/css'\n` +
        `export function F(props: { a: boolean }) @{\n` +
        `  <>\n` +
        `    @if (props.a) {\n      <i className={css({ color: 'red.300' })} />\n    }` +
        ` @else {\n      <i className={css({ color: 'blue.300' })} />\n    }\n` +
        `  </>\n` +
        `}\n`,
    )

    expect(result.skipped).toEqual([])
    expect(result.classes).toEqual(expect.arrayContaining(['c_red.300', 'c_blue.300']))
    expect(result.missing).toEqual([])
  })

  test('module-scope `css()` beside the template', () => {
    const result = build(
      `import { css } from 'styled-system/css'\n` +
        `const tone = css({ color: 'green.300' })\n` +
        `export function F() @{\n  <i className={tone} />\n}\n`,
    )

    expect(result.skipped).toEqual([])
    expect(result.classes).toEqual(expect.arrayContaining(['c_green.300']))
    expect(result.missing).toEqual([])
  })

  test('`@switch` and `@try`', () => {
    const result = build(
      `import { css } from 'styled-system/css'\n` +
        `export function F(props: { v: string }) @{\n` +
        `  <>\n` +
        `    @switch (props.v) {\n` +
        `      @case 'a': {\n        <i className={css({ color: 'red.100' })} />\n      }\n` +
        `      @default: {\n        <i className={css({ color: 'red.200' })} />\n      }\n` +
        `    }\n` +
        `    @try {\n      <i className={css({ color: 'red.400' })} />\n    }` +
        ` @pending {\n      <i className={css({ color: 'red.500' })} />\n    }` +
        ` @catch (error) {\n      <i className={css({ color: 'red.600' })} />\n    }\n` +
        `  </>\n` +
        `}\n`,
    )

    expect(result.skipped).toEqual([])
    expect(result.classes).toEqual(
      expect.arrayContaining(['c_red.100', 'c_red.200', 'c_red.400', 'c_red.500', 'c_red.600']),
    )
    expect(result.missing).toEqual([])
  })

  // Raw TSRX handed to the compiler means the framework plugin did not run first; the real
  // plugin's error for that is pinned in tsrx-vite.test.ts, where `build` sees it.

  // A `.tsrx` file that is plain TSX needs no framework plugin either way.
  test('a TSX-shaped .tsrx folds as itself', () => {
    const fixture = createFoldFixture({ plugins: [pluginTsrx()] })
    const source =
      `import { css } from 'styled-system/css'\n` +
      `export const c = css({ color: 'yellow.300' })\n` +
      `export const el = <i className={c} />\n`
    fixture.addFiles({ 'app/src/Plain.tsrx': source })
    const parsePath = compilerParsePath('/app/src/Plain.tsrx', source)!
    const result = fixture.foldStrict(source, parsePath)
    expect(result.folded.flatMap((entry) => entry.classNames)).toContain('c_yellow.300')
  })
})
