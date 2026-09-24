import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/**
 * How a file is parsed, decided by its extension rather than assumed to be tsx.
 *
 * `TSX` is not a superset of `TS`. They disagree wherever `<` is ambiguous: under `TSX` a
 * generic arrow `<T>(x: T) => x` and an old-style assertion `<HTMLElement>node` parse as a JSX
 * element, whose children then swallow the rest of the file. Nothing about the source looks
 * wrong and the bytes are untouched — the tree is simply missing everything after that line.
 *
 * For extraction that means styles that silently never get emitted, which is the failure this
 * pins. It surfaced from the other end: an accounting pass over `.ts` files reported no token
 * calls at all in files that plainly had them.
 */
const parse = (file: string, code: string) => {
  const ctx = createContext()
  ctx.project.addSourceFile(file, code)

  const result = ctx.parseFile(file)

  return {
    css: Array.from(result?.css ?? []).flatMap((item) => item.data),
    // The native engine fails a file with any parse diagnostic, and `parseFile` records that
    // failure rather than throwing. So a clean parse is a result with no recorded failure.
    parseErrors: result ? ctx.parseFailures.size : Math.max(1, ctx.parseFailures.size),
  }
}

// No trailing comma after `T`. `<T,>` is the tsx-compatible spelling and parses either way,
// so it would pin nothing; `<T>` is exactly the construct the two script kinds disagree on.
const withGenericArrow = `
  import { css } from 'styled-system/css'
  export const identity = <T>(value: T) => value
  export const cls = css({ color: 'red.300' })
`

const withTypeAssertion = `
  import { css } from 'styled-system/css'
  const node = <HTMLElement>document.body
  export const cls = css({ color: 'red.300' })
`

describe('a .ts file parses as TypeScript', () => {
  test.each([
    ['a generic arrow', withGenericArrow],
    ['an old-style type assertion', withTypeAssertion],
  ])('extracts styles written after %s', (_label, code) => {
    const { css, parseErrors } = parse('app/src/util.ts', code)

    expect(parseErrors).toBe(0)
    expect(css).toEqual([{ color: 'red.300' }])
  })

  /**
   * `.mts` and `.cts` parse as TypeScript too. `<T>(x: T) => x` is an error there — TypeScript
   * reserves it (TS7060) and asks for `<T,>` — so the valid spelling is what is pinned.
   */
  test.each([
    ['.mts', 'app/src/util.mts'],
    ['.cts', 'app/src/util.cts'],
  ])('%s too, with source valid there', (_label, file) => {
    const { css, parseErrors } = parse(
      file,
      `
  import { css } from 'styled-system/css'
  export const identity = <T,>(value: T) => value
  export const cls = css({ color: 'red.300' })
`,
    )

    expect(parseErrors).toBe(0)
    expect(css).toEqual([{ color: 'red.300' }])
  })
})

/**
 * The other half, and the reason this is keyed on `.ts` alone: a `.ts` file cannot legally
 * contain JSX, but `.js` routinely does in projects that never adopted TypeScript, and a
 * single-file component is stored under its own extension after being rewritten to tsx.
 */
describe('everything else still parses as tsx', () => {
  const jsx = `
    import { css } from 'styled-system/css'
    export const El = () => <div className={css({ color: 'red.300' })} />
  `

  test.each([
    ['.tsx', 'app/src/a.tsx'],
    ['.jsx', 'app/src/a.jsx'],
    ['.js', 'app/src/a.js'],
    ['.vue', 'app/src/a.vue'],
  ])('%s', (_label, file) => {
    const { css, parseErrors } = parse(file, jsx)

    expect(parseErrors).toBe(0)
    expect(css).toEqual([{ color: 'red.300' }])
  })
})
