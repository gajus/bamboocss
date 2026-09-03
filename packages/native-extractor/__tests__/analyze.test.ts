import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import type { NativeAnalysis, NativeEntrypoint, NativeFileAnalysis, NativeSource } from '../index'

const require = createRequire(import.meta.url)
const { analyze, analyzeMany } = require('../index.cjs') as {
  analyze(filename: string, source: string, entrypoints: NativeEntrypoint[]): NativeAnalysis
  analyzeMany(sources: NativeSource[], entrypoints: NativeEntrypoint[]): NativeFileAnalysis[]
}

const entrypoints: NativeEntrypoint[] = [
  { kind: 'css', modules: ['styled-system/css'], names: ['css', 'cva', 'sva'] },
  { kind: 'recipe', modules: ['styled-system/recipes'], names: ['button'] },
]

describe('native extraction analysis', () => {
  test('resolves named aliases from configured entrypoints', () => {
    const source = `
      import { css as c, other } from 'styled-system/css'
      import { button as b } from 'styled-system/recipes'
      c({ color: 'red', nested: { px: 2 }, enabled: true })
      b({ size: 'sm' })
      other({ ignored: true })
    `

    expect(analyze('source.ts', source, entrypoints)).toEqual({
      calls: [
        {
          arguments: [{ color: 'red', enabled: true, nested: { px: 2 } }],
          complete: true,
          end: source.indexOf('\n      b'),
          importedName: 'css',
          kind: 'css',
          line: 4,
          column: 7,
          name: 'c',
          start: source.indexOf('c({'),
        },
        {
          arguments: [{ size: 'sm' }],
          complete: true,
          end: source.indexOf('\n      other'),
          importedName: 'button',
          kind: 'recipe',
          line: 5,
          column: 7,
          name: 'b',
          start: source.indexOf('b({'),
        },
      ],
      errors: [],
      fallbackReason: 'unknown-entrypoint-call',
      safe: false,
    })
  })

  test('ignores calls from unrelated entrypoints during the stylesheet-only pass', () => {
    const source = `
      import { css } from 'styled-system/css'
      import { useValue } from 'some-library'
      useValue()
      css({ color: 'red' })
    `

    expect(analyze('source.ts', source, entrypoints)).toMatchObject({ safe: true })
  })

  test('does not mistake a shadowed import for a Bamboo call', () => {
    const source = `
      import { css } from 'styled-system/css'
      css({ color: 'red' })
      function nested(css: (value: unknown) => void) {
        css({ not: 'bamboo' })
      }
    `

    expect(analyze('source.ts', source, entrypoints).calls).toHaveLength(1)
  })

  test('evaluates immutable local constants without JavaScript', () => {
    const source = `
      import { css } from 'styled-system/css'
      const color = 'red'
      const base = { color }
      const spacing = [1, 2]
      const styles = { ...base, gridTemplateAreas: \`'a'\n        'b'\`, padding: [0, ...spacing] }
      css(styles)
    `

    expect(analyze('source.ts', source, entrypoints).calls[0]).toMatchObject({
      complete: true,
      arguments: [{ color: 'red', gridTemplateAreas: "'a' 'b'", padding: [0, 1, 2] }],
    })
  })

  test('accepts files without bamboo entrypoints as complete empty results', () => {
    expect(
      analyze('source.ts', `import { value } from './other'; export const doubled = value * 2`, entrypoints),
    ).toMatchObject({
      calls: [],
      safe: true,
    })
  })

  test('reports JavaScript-compatible source locations', () => {
    const result = analyze(
      'source.ts',
      `import { css } from 'styled-system/css'\n/* 😀 */  css({ color: 'red' })\u2028css({ color: 'blue' })`,
      entrypoints,
    )
    expect(result.calls[0]).toMatchObject({ line: 2, column: 11 })
    expect(result.calls[1]).toMatchObject({ line: 3, column: 1 })
  })

  test('reads const initializers like the TypeScript extractor rather than executing mutations', () => {
    const result = analyze(
      'source.ts',
      `import { css } from 'styled-system/css'
       const styles = { color: 'red' }
       styles.color = 'blue'
       css(styles)`,
      entrypoints,
    )
    expect(result).toMatchObject({ calls: [{ arguments: [{ color: 'red' }] }], safe: true })
  })

  test('fails open when an argument needs JavaScript evaluation', () => {
    const source = `import { css } from 'styled-system/css'; css({ color })`

    expect(analyze('source.ts', source, entrypoints).calls).toEqual([
      {
        arguments: [],
        complete: false,
        end: source.length,
        importedName: 'css',
        kind: 'css',
        line: 1,
        column: source.indexOf('css({') + 1,
        name: 'css',
        start: source.indexOf('css({'),
      },
    ])
  })

  test('reports parser diagnostics instead of accepting incomplete syntax', () => {
    const result = analyze('source.ts', `import { css } from 'styled-system/css'; css({`, entrypoints)

    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('keeps a cold inventory behind one native call', () => {
    const source = `import { css } from 'styled-system/css'; css({ p: 1 })`

    expect(
      analyzeMany(
        [
          { filename: 'a.ts', source },
          { filename: 'b.ts', source: `export const value = 1` },
        ],
        entrypoints,
      ),
    ).toEqual([
      {
        calls: [
          {
            arguments: [{ p: 1 }],
            complete: true,
            end: source.length,
            importedName: 'css',
            kind: 'css',
            line: 1,
            column: source.indexOf('css({') + 1,
            name: 'css',
            start: source.indexOf('css({'),
          },
        ],
        errors: [],
        filename: 'a.ts',
        safe: true,
      },
      { calls: [], errors: [], filename: 'b.ts', safe: true },
    ])
  })
})
