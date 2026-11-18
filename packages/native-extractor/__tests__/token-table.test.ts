// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type {
  FoldAnalysis,
  NativeEntrypoint,
  NativeFileAnalysis,
  NativeFoldOptions,
  NativeProjectOptions,
  NativeSource,
  NativeToken,
  NativeTokenTable,
} from '../index'

const native = createRequire(import.meta.url)('../index.cjs') as {
  analyzeMany(
    sources: NativeSource[],
    entrypoints: NativeEntrypoint[],
    options?: NativeProjectOptions,
    tokens?: NativeTokenTable,
  ): NativeFileAnalysis[]
  compileModules(
    sources: NativeSource[],
    auxiliary: NativeSource[],
    options: NativeFoldOptions,
    tokens?: NativeTokenTable,
  ): FoldAnalysis[]
  tokenTable(tokens: NativeToken[]): NativeTokenTable
}

/**
 * The project's token table is made once and handed to each call, in place of the tokens.
 *
 * What a call answers with it has to be what it answered with the tokens themselves, and an
 * answer the calls share — an imported value, cached across them — has to be the one its own
 * table gives: two tables are two projects, as far as `token()` can tell.
 */
describe('a token table made once', () => {
  let root: string
  let filename: string
  const consumer =
    `import { css } from '../styled-system/css'\n` +
    `import { token } from '../styled-system/tokens'\n` +
    `import { tone } from './ui/tone'\n` +
    `export const a = css({ color: token('colors.brand') })\n` +
    `export const b = css(tone)\n`
  const brand = (variable: string): NativeToken[] => [{ path: 'colors.brand', value: '#123456', variable }]
  const options = (): NativeFoldOptions => ({
    cwd: root,
    paths: [],
    cssModules: ['styled-system/css'],
    tokenModules: ['styled-system/tokens'],
    recipeModules: ['styled-system/recipes'],
    patternModules: ['styled-system/patterns'],
    recipeNames: [],
    patternNames: [],
    references: false,
  })
  const compile = (extra: Partial<NativeFoldOptions>, table?: NativeTokenTable) =>
    native
      .compileModules([{ filename, source: consumer }], [], { ...options(), ...extra }, table)[0]!
      .calls.filter((call) => call.kind === 'css')
      .map((call) => call.data)

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-token-table-')))
    filename = join(root, 'src/consumer.ts')
    const file = join(root, 'src/ui/tone.ts')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      `import { token } from '../../styled-system/tokens'\nexport const tone = { color: token('colors.brand') }\n`,
    )
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('answers token() as the tokens it was made of did, in the compiler and in extraction', () => {
    const table = native.tokenTable(brand('var(--colors-brand)'))
    const expected = [[{ color: 'var(--colors-brand)' }], [{ color: 'var(--colors-brand)' }]]

    expect(compile({ tokens: brand('var(--colors-brand)') })).toEqual(expected)
    expect(compile({}, table)).toEqual(expected)
    const [extracted] = native.analyzeMany(
      [{ filename, source: consumer }],
      [
        { kind: 'css', modules: ['styled-system/css'], names: ['css'] },
        { kind: 'token', modules: ['styled-system/tokens'], names: ['token'] },
      ],
      { cwd: root, paths: [], jsx: false },
      table,
    )
    expect(extracted!.calls.filter((call) => call.kind === 'css').map((call) => call.arguments)).toEqual(expected)
  })

  test('is not answered from what another table cached', () => {
    expect(compile({}, native.tokenTable(brand('var(--first)')))).toEqual([
      [{ color: 'var(--first)' }],
      [{ color: 'var(--first)' }],
    ])
    // `tone` comes from another module, whose value the first call cached.
    expect(compile({}, native.tokenTable(brand('var(--second)')))).toEqual([
      [{ color: 'var(--second)' }],
      [{ color: 'var(--second)' }],
    ])
  })
})
