// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import type { FoldAnalysis, NativeFoldOptions, NativeSource } from '../index'

/**
 * Exported values and imported recipes are remembered across native calls, which is what makes
 * a module importing from a large barrel cheap to re-transform. Every test here edits a file the
 * cached answer came from — directly, through a barrel, by a file appearing or disappearing —
 * and requires the next call to see it. A cache that answers from stale bytes is a stale class
 * string in the browser.
 */
const { compileModules } = createRequire(import.meta.url)('../index.cjs') as {
  compileModules(sources: NativeSource[], auxiliary: NativeSource[], options: NativeFoldOptions): FoldAnalysis[]
}

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const project = (files: Record<string, string>) => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-cache-'))
  roots.push(cwd)
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(join(cwd, path, '..'), { recursive: true })
    writeFileSync(join(cwd, path), source)
  }
  const options: NativeFoldOptions = {
    cwd,
    paths: [],
    tokens: [],
    cssModules: ['styled-system/css'],
    tokenModules: ['styled-system/tokens'],
    recipeModules: ['styled-system/recipes'],
    patternModules: ['styled-system/patterns'],
    recipeNames: [],
    patternNames: [],
    references: false,
  }
  // A distinct size per write, so the edit is visible however coarse the file system's
  // modification times are — the case this pins is a real edit, not a same-tick race.
  const write = (path: string, source: string) => writeFileSync(join(cwd, path), source)
  const compile = (source: string, auxiliary: Array<{ filename: string; source: string }> = []) =>
    compileModules([{ filename: join(cwd, 'src/consumer.tsx'), source }], auxiliary, options)[0]!
  return { cwd, write, compile, remove: (path: string) => unlinkSync(join(cwd, path)) }
}

const CONSUMER = `import { css } from '../styled-system/css'\nimport { tone } from './ui'\nexport const a = css(tone)\n`
const dataOf = (analysis: FoldAnalysis) => analysis.calls.filter((call) => call.kind === 'css').map((call) => call.data)

describe('the cross-call export cache', () => {
  test('sees an edit to the module a value is declared in', () => {
    const p = project({
      'src/ui/index.ts': `export * from './a'\nexport * from './b'\n`,
      'src/ui/a.ts': `export const other = { color: 'blue' }\n`,
      'src/ui/b.ts': `export const tone = { color: 'red' }\n`,
    })
    expect(dataOf(p.compile(CONSUMER))).toEqual([[{ color: 'red' }]])
    p.write('src/ui/b.ts', `export const tone = { color: 'green.500' }\n`)
    expect(dataOf(p.compile(CONSUMER))).toEqual([[{ color: 'green.500' }]])
  })

  test('sees a barrel member that now exports the name first', () => {
    const p = project({
      'src/ui/index.ts': `export * from './a'\nexport * from './b'\n`,
      'src/ui/a.ts': `export const other = { color: 'blue' }\n`,
      'src/ui/b.ts': `export const tone = { color: 'red' }\n`,
    })
    expect(dataOf(p.compile(CONSUMER))).toEqual([[{ color: 'red' }]])
    p.write('src/ui/a.ts', `export const other = { color: 'blue' }\nexport const tone = { color: 'pink' }\n`)
    expect(dataOf(p.compile(CONSUMER))[0]).not.toEqual([{ color: 'red' }])
  })

  test('sees a value re-routed through a module that did not exist', () => {
    const p = project({
      'src/ui/index.ts': `export { tone } from './tone'\n`,
      'src/ui/tone.js': `export const tone = { color: 'red' }\n`,
    })
    expect(dataOf(p.compile(CONSUMER))).toEqual([[{ color: 'red' }]])
    // `./tone` now resolves to the higher-priority `.ts` spelling that did not exist before.
    p.write('src/ui/tone.ts', `export const tone = { color: 'purple' }\n`)
    expect(dataOf(p.compile(CONSUMER))).toEqual([[{ color: 'purple' }]])
  })

  test('sees a deleted declaring module', () => {
    const p = project({
      'src/ui/index.ts': `export * from './b'\n`,
      'src/ui/b.ts': `export const tone = { color: 'red' }\n`,
    })
    expect(dataOf(p.compile(CONSUMER))).toEqual([[{ color: 'red' }]])
    p.remove('src/ui/b.ts')
    expect(dataOf(p.compile(CONSUMER))).not.toEqual([[{ color: 'red' }]])
  })

  test('an overlay wins over the cached reading of the file on disk', () => {
    const p = project({
      'src/ui/index.ts': `export * from './b'\n`,
      'src/ui/b.ts': `export const tone = { color: 'red' }\n`,
    })
    expect(dataOf(p.compile(CONSUMER))).toEqual([[{ color: 'red' }]])
    const overlay = [{ filename: join(p.cwd, 'src/ui/b.ts'), source: `export const tone = { color: 'teal' }\n` }]
    expect(dataOf(p.compile(CONSUMER, overlay))).toEqual([[{ color: 'teal' }]])
    // And the overlay going away is an edit too.
    expect(dataOf(p.compile(CONSUMER))).toEqual([[{ color: 'red' }]])
  })

  test('a cached answer reports the same dependencies as a fresh one', () => {
    const p = project({
      'src/ui/index.ts': `export * from './a'\nexport * from './b'\n`,
      'src/ui/a.ts': `export const other = { color: 'blue' }\n`,
      'src/ui/b.ts': `export const tone = { color: 'red' }\n`,
    })
    const fresh = p.compile(CONSUMER).dependencies
    const cached = p.compile(CONSUMER).dependencies
    expect(cached).toEqual(fresh)
    expect(cached.some((path) => path.endsWith('/src/ui/b.ts'))).toBe(true)
  })

  test('sees an edit to an imported inline recipe', () => {
    const p = project({
      'src/ui/index.ts': `export * from './badge'\n`,
      'src/ui/badge.ts': `import { cva } from '../../styled-system/css'\nexport const badge = cva({ base: { color: 'red' } })\n`,
    })
    const consumer = `import { badge } from './ui'\nexport const a = badge()\n`
    const configOf = () => p.compile(consumer).importedRecipes.map((recipe) => recipe.config)
    expect(configOf()).toEqual([{ base: { color: 'red' } }])
    p.write(
      'src/ui/badge.ts',
      `import { cva } from '../../styled-system/css'\nexport const badge = cva({ base: { color: 'orange.500' } })\n`,
    )
    expect(configOf()).toEqual([{ base: { color: 'orange.500' } }])
  })

  test('a cycle does not freeze a partial answer', () => {
    const p = project({
      'src/ui/index.ts': `export * from './a'\n`,
      'src/ui/a.ts': `export * from './b'\nexport const tone = { color: 'red' }\n`,
      'src/ui/b.ts': `export * from './a'\n`,
    })
    expect(dataOf(p.compile(CONSUMER))).toEqual([[{ color: 'red' }]])
    expect(
      dataOf(
        p.compile(
          `import { css } from '../styled-system/css'\nimport { tone } from './ui/b'\nexport const a = css(tone)\n`,
        ),
      ),
    ).toEqual([[{ color: 'red' }]])
  })
})
