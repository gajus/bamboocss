import { createContext } from '@bamboocss/fixture'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadNativeExtractor } from '../src/native-extractor'

/**
 * The token table crosses into the native engine once per context.
 *
 * `compileModules` runs once per transformed module, and the table is every token in the project.
 * Handed over with each call, it was converted into Rust every time: about 0.44 µs a token, which
 * under `preset-atlaskit`'s 1,655 tokens came to 0.9 ms a module — several times what analyzing
 * most modules takes. Counted rather than timed: how many tables are made, and what each call is
 * handed.
 */
describe('the token table the native engine reads', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('is made once per context, and handed to every call in place of the tokens', () => {
    const native = loadNativeExtractor()
    const made = vi.spyOn(native, 'tokenTable')
    const compiled = vi.spyOn(native, 'compileModules')
    const extracted = vi.spyOn(native, 'analyzeMany')

    const ctx = createContext()
    const source = `import { css } from 'styled-system/css'\nimport { token } from 'styled-system/tokens'\nexport const a = css({ color: token('colors.red.300') })\n`
    for (const name of ['a', 'b', 'c']) {
      const filename = ctx.runtime.path.abs(ctx.config.cwd, `src/${name}.ts`)
      const [analysis] = ctx.compileModules([{ filename, source }], { references: false })
      // Read through the table: the token's variable, where the call names it.
      expect(analysis!.calls.find((call) => call.kind === 'css')?.data).toEqual([{ color: 'var(--colors-red-300)' }])
    }
    ctx.project.addSourceFile('src/d.tsx', source)
    ctx.parseFile('src/d.tsx')

    expect(made).toHaveBeenCalledTimes(1)
    const table = made.mock.results[0]!.value
    expect(compiled).toHaveBeenCalledTimes(3)
    expect(extracted).toHaveBeenCalled()
    for (const [, , options, tokens] of [...compiled.mock.calls, ...extracted.mock.calls]) {
      expect(tokens).toBe(table)
      expect(options).not.toHaveProperty('tokens')
    }
  })
})
