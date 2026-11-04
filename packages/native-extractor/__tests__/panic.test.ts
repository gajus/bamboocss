// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import type * as Native from '../index'

/**
 * A panic in Rust used to unwind into N-API, which ends the process: the dev server, for whatever
 * bug a module happened to reach. Each export catches it now, and throws it as an error from the
 * call that hit it. No input is known to panic, so the binary takes `__panicNext` from a test.
 */
const native = createRequire(import.meta.url)('../index.cjs') as typeof Native & {
  __panicNext(): void
  __poisonCaches(): void
  __cacheHits(): number
}

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const SOURCE = `import { css } from 'styled-system/css'\nexport const a = css({ color: 'red' })\n`
const ENTRYPOINTS: Native.NativeEntrypoint[] = [{ kind: 'css', modules: ['styled-system/css'], names: ['css'] }]
const fold = (cwd: string): Native.NativeFoldOptions => ({
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
})

describe('a panic in the native extractor', () => {
  /** An export added without `catch_unwind` would end the process on a panic again. */
  test('is caught by every function the binary exports', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '../src')
    const uncaught = readdirSync(src, { recursive: true })
      .filter((file) => String(file).endsWith('.rs'))
      .flatMap((file) => [
        ...readFileSync(join(src, String(file)), 'utf8').matchAll(/#\[napi(\([^)]*\))?\]\s*pub fn (\w+)/g),
      ])
      .filter(([, attribute]) => !attribute?.includes('catch_unwind'))
      .map(([, , name]) => name)

    expect(uncaught).toEqual([])
  })

  test.each([
    ['analyze', () => native.analyze('/a.ts', SOURCE, ENTRYPOINTS)],
    ['analyzeMany', () => native.analyzeMany([{ filename: '/a.ts', source: SOURCE }], ENTRYPOINTS)],
    ['accountTokens', () => native.accountTokens('/a.ts', SOURCE, ['styled-system/tokens'])],
    ['compileModules', () => native.compileModules([{ filename: '/a.tsx', source: SOURCE }], [], fold('/'))],
  ])('is thrown from %s as an error, and the next call runs', (_, call) => {
    native.__panicNext()

    expect(call).toThrow('a panic `__panicNext` asked for')
    expect(call).not.toThrow()
  })

  /**
   * A panic while a call holds one of the caches native calls share poisons its lock. Each cache
   * answered a poisoned lock with nothing, which kept the process going with the cache switched
   * off: every transform afterwards re-read a barrel's members, and nothing said why.
   */
  test('leaves the caches native calls share answering', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-panic-'))
    roots.push(cwd)
    const files = {
      'src/ui/index.ts': `export * from './tone'\nexport * from './button'\n`,
      'src/ui/tone.ts': `export const tone = { color: 'red' }\n`,
      'src/ui/button.ts': `import { cva } from '../../styled-system/css'\nexport const button = cva({ base: { color: 'blue' } })\n`,
    }
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(join(cwd, path, '..'), { recursive: true })
      writeFileSync(join(cwd, path), source)
    }
    const consumer = `import { css } from '../styled-system/css'\nimport { button, tone } from './ui'\nexport const a = css(tone)\nexport const b = button()\n`
    const compile = () =>
      native.compileModules([{ filename: join(cwd, 'src/consumer.tsx'), source: consumer }], [], fold(cwd))

    compile()
    native.__poisonCaches()
    compile()
    const hits = native.__cacheHits()
    compile()

    expect(native.__cacheHits()).toBeGreaterThan(hits)
  })
})
