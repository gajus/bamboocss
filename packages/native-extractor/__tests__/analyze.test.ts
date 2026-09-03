import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { NativeAnalysis, NativeEntrypoint, NativeFileAnalysis, NativeProjectOptions, NativeSource } from '../index'

const require = createRequire(import.meta.url)
const { analyze, analyzeMany } = require('../index.cjs') as {
  analyze(filename: string, source: string, entrypoints: NativeEntrypoint[]): NativeAnalysis
  analyzeMany(
    sources: NativeSource[],
    entrypoints: NativeEntrypoint[],
    options?: NativeProjectOptions,
  ): NativeFileAnalysis[]
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

    expect(analyze('source.ts', source, entrypoints)).toMatchObject({
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
    })
  })

  test('ignores calls from unrelated entrypoints during the stylesheet-only pass', () => {
    const source = `
      import { css } from 'styled-system/css'
      import { useValue } from 'some-library'
      useValue()
      css({ color: 'red' })
    `

    expect(analyze('source.ts', source, entrypoints)).toMatchObject({ calls: expect.any(Array), errors: [] })
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
      errors: [],
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

  test('evaluates destructured constants and defaults as their selected values', () => {
    const result = analyze(
      'source.ts',
      `import { css } from 'styled-system/css'
       const theme = { colors: ['red'] }
       const { colors: [color], missing = 'blue' } = theme
       css({ color, background: missing })`,
      entrypoints,
    )

    expect(result).toMatchObject({
      calls: [{ arguments: [{ background: 'blue', color: 'red' }], complete: true }],
      errors: [],
    })
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
    expect(result).toMatchObject({ calls: [{ arguments: [{ color: 'red' }] }], errors: [] })
  })

  test('fails open when an argument needs JavaScript evaluation', () => {
    const source = `import { css } from 'styled-system/css'; css({ color })`

    expect(analyze('source.ts', source, entrypoints).calls).toMatchObject([
      {
        arguments: [{}],
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

  test('evaluates helpers, re-exports, and cross-file values in one native project', () => {
    const sources = [
      {
        filename: '/project/base.ts',
        source: `export const base = { display: 'flex' }`,
      },
      {
        filename: '/project/theme.ts',
        source: `export { base as shared } from './base'`,
      },
      {
        filename: '/project/app.ts',
        source: `import { css } from 'styled-system/css'
          import { shared } from './theme'
          const create = (color: string) => ({ ...shared, color, width: 2 * 4 })
          css(create('purple'))`,
      },
    ]
    const [base, theme, app] = analyzeMany(sources, entrypoints, {
      cwd: '/project',
      paths: [],
      tokens: [],
      jsx: false,
    })

    expect(base.calls).toEqual([])
    expect(theme.calls).toEqual([])
    expect(app.calls).toMatchObject([{ arguments: [{ color: 'purple', display: 'flex', width: 8 }], complete: true }])
    expect(app.dependencies).toEqual(['/project/base.ts', '/project/theme.ts'])
  })

  test('uses the most specific tsconfig path mapping for hash-prefixed aliases', () => {
    const sources = [
      { filename: '/project/#app/theme.ts', source: `export const shared = { color: 'blue' }` },
      { filename: '/project/src/theme.ts', source: `export const shared = { color: 'red' }` },
      {
        filename: '/project/app.ts',
        source: `import { css } from 'styled-system/css'\nimport { shared } from '#app/theme.js'\ncss(shared)`,
      },
    ]
    const analysis = analyzeMany(sources, entrypoints, {
      cwd: '/project',
      paths: [
        { pattern: '*', paths: ['./*'] },
        { pattern: '#app/*', paths: ['./src/*'] },
      ],
      tokens: [],
      jsx: false,
    })[2]

    expect(analysis.calls).toMatchObject([{ arguments: [{ color: 'red' }], complete: true }])
    expect(analysis.dependencies).toEqual(['/project/src/theme.ts'])
  })

  test('resolves package import maps and package export wildcards above cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'bamboo-native-packages-'))
    const cwd = join(root, 'apps/web')
    const dependencyRoot = join(root, 'node_modules/example')
    mkdirSync(join(cwd, 'src'), { recursive: true })
    mkdirSync(dependencyRoot, { recursive: true })
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ imports: { '#theme/*': './generated/*.ts' } }))
    writeFileSync(
      join(dependencyRoot, 'package.json'),
      JSON.stringify({ exports: { './theme/*': { import: './src/*.ts' } } }),
    )
    try {
      const app = join(cwd, 'src/app.ts')
      const local = join(cwd, 'generated/color.ts')
      const dependency = join(dependencyRoot, 'src/color.ts')
      const analysis = analyzeMany(
        [
          { filename: local, source: `export const local = { color: 'red' }` },
          { filename: dependency, source: `export const external = { background: 'blue' }` },
          {
            filename: app,
            source: `import { css } from 'styled-system/css'
              import { local } from '#theme/color'
              import { external } from 'example/theme/color'
              css({ ...local, ...external })`,
          },
        ],
        entrypoints,
        { cwd, paths: [], tokens: [], jsx: false },
      )[2]

      expect(analysis.calls).toMatchObject([{ arguments: [{ background: 'blue', color: 'red' }], complete: true }])
      expect(analysis.dependencies).toEqual([dependency, local].sort())
      expect(analysis.configurationFiles).toEqual(
        [join(cwd, 'package.json'), join(dependencyRoot, 'package.json')].sort(),
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('tracks every source spelling that can satisfy a missing emitted import', () => {
    const [analysis] = analyzeMany(
      [
        {
          filename: '/project/app.ts',
          source: `import { css } from 'styled-system/css'\nimport { shared } from './missing.js'\ncss(shared)`,
        },
      ],
      entrypoints,
      { cwd: '/project', paths: [], tokens: [], jsx: false },
    )

    expect(analysis.pendingCandidates).toContain('/project/missing.ts')
    expect(analysis.pendingCandidates).toContain('/project/missing.tsx')
    expect(analysis.pendingCandidates).toContain('/project/missing.js')
  })

  test('resolves token values and captures JSX recipe props', () => {
    const tokenEntrypoints: NativeEntrypoint[] = [
      ...entrypoints,
      { kind: 'token', modules: ['styled-system/tokens'], names: ['token'] },
    ]
    const [analysis] = analyzeMany(
      [
        {
          filename: '/project/app.tsx',
          source: `import { token } from 'styled-system/tokens'
            import { button as Button } from 'styled-system/recipes'
            token('colors.brand')
            token.value('colors.brand')
            export const element = <Button size="sm" disabled />`,
        },
      ],
      tokenEntrypoints,
      {
        cwd: '/project',
        paths: [],
        tokens: [{ path: 'colors.brand', value: '#123456', variable: 'var(--colors-brand)' }],
        jsx: true,
      },
    )

    expect(analysis.calls).toMatchObject([
      { kind: 'token', arguments: ['colors.brand'] },
      { kind: 'tokenValue', arguments: ['colors.brand'] },
      { kind: 'jsx', importedName: 'button', arguments: [{ disabled: true, size: 'sm' }] },
    ])
  })

  test('reports recipe raw composition that cannot be extracted as atomic styles', () => {
    const source = `import { css } from 'styled-system/css'
      import { button } from 'styled-system/recipes'
      css(button.raw({ size: 'sm' }))`

    expect(analyze('source.ts', source, entrypoints).calls).toMatchObject([
      { kind: 'css', losses: [{ prop: 'button', reason: 'unresolved-raw' }] },
      { kind: 'recipe', importedName: 'button' },
    ])
  })

  test('reports unresolved object shape without invoking JavaScript', () => {
    const source = `import { css, cva } from 'styled-system/css'
      css({ ...props, color: 'red' })
      cva({ base: { color } })`
    const result = analyze('source.ts', source, entrypoints)

    expect(result.calls).toMatchObject([
      { complete: false, losses: [{ reason: 'unenumerable-keys' }] },
      { complete: false, losses: [{ prop: 'base.color', reason: 'missing-property' }] },
    ])
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
    ).toMatchObject([
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
      },
      { calls: [], errors: [], filename: 'b.ts' },
    ])
  })
})
