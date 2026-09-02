import { createContext } from '@bamboocss/fixture'
import type { Config } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'

const filePath = 'app/src/origins.tsx'

const source = `import { css, cva } from 'styled-system/css'
import { flex } from 'styled-system/patterns'
export const first = css({ color: 'red.200', padding: '2' })
export const again = css({ color: 'red.200', margin: '3' })
export const badge = cva({ base: { fontSize: 'sm' }, variants: { tone: { loud: { fontWeight: 'bold' } } } })
export const row = flex({ gap: '4' })
`

/** 1-based column of the call on `line`, which is where the parser places a call's box. */
const columnOf = (line: number) => source.split('\n')[line - 1]!.indexOf(' = ') + 4

const extract = (userConfig?: Config, code = source) => {
  const ctx = createContext(userConfig)
  ctx.encoder.recordOrigins = true
  ctx.project.addSourceFile(filePath, code)
  ctx.encoder.withOwner('extract', filePath, () => ctx.project.parseSourceFile(filePath))
  // What a build does once every file is read: an inline recipe's atoms are written here.
  ctx.encoder.atomizeObservedRecipes()
  return ctx.getAtomOrigins()
}

const at = (line: number) => ({
  filePath: expect.stringMatching(/app\/src\/origins\.tsx$/),
  line,
  column: columnOf(line),
})

/**
 * Each atom is attributed to the call that first wrote it, at the position of its style
 * object — the same place diagnostics name. Read back by class name, which is what a
 * stylesheet's rule carries.
 */
describe('atom origins from the parser', () => {
  test('a css() call, a cva() and a pattern each attribute their atoms', () => {
    const origins = extract()

    expect(origins.get('c_red\\.200')).toEqual(at(3))
    expect(origins.get('p_2')).toEqual(at(3))
    // The same atom again, one line down: the first call keeps it.
    expect(origins.get('m_3')).toEqual(at(4))
    // An inline recipe's atoms, base and variant alike, belong to the call that declared it.
    expect(origins.get('fs_sm')).toEqual(at(5))
    expect(origins.get('fw_bold')).toEqual(at(5))
    expect(origins.get('gap_4')).toEqual(at(6))
    expect(origins.get('d_flex')).toEqual(at(6))
  })

  test('records nothing unless the encoder was asked to', () => {
    const ctx = createContext()
    ctx.project.addSourceFile(filePath, source)
    ctx.encoder.withOwner('extract', filePath, () => ctx.project.parseSourceFile(filePath))

    expect(ctx.encoder.atomic.size).toBeGreaterThan(0)
    expect(ctx.getAtomOrigins().size).toBe(0)
  })

  /**
   * A `parser:before` hook's output has positions of its own. Pointing DevTools at a line of
   * the file for a call that sits elsewhere in it is worse than pointing nowhere.
   */
  test('a source a hook rewrote is not attributed', () => {
    const origins = extract({
      plugins: [
        {
          name: 'rewrite',
          hooks: {
            'parser:before': ({ content }) => `// added by a hook\n${content}`,
          },
        },
      ],
    })

    expect(origins.size).toBe(0)
  })
})
