import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { createCompiledJsxContext } from '../src/compiled-jsx'

/**
 * How many times building the compiled-jsx context reads a module's whole AST.
 *
 * Two of its walks hunt for *bundler output* — Parcel's module registry, and Vue/Solid/Preact
 * runtime helpers a bundler inlined — and `extract` builds this context for every module it
 * processes. Hand-written source matches neither, so on an ordinary component both walks read the
 * entire tree, wrap every call and every function declaration in it, and find nothing.
 *
 * Counted rather than timed: wall-clock is machine-dependent and excluded from CI, while a
 * reintroduced walk is a number that fails anywhere. `extract.test.ts` holds the other half of
 * this — 158 fixtures of real bundler output across react, preact, vue and solid — so a guard that
 * skipped too much fails there rather than here.
 */
/**
 * The walk counter.
 *
 * ts-morph made every node an object of its own, so counting reads meant patching one method on
 * `Node.prototype`. TypeScript 7's nodes carry no such method — `getDescendantsOfKind` is a free
 * function in `@bamboocss/ts-ast` — so the count has to be taken where the function lives, which
 * is a module mock rather than a prototype patch. `vi.hoisted` is what lets the tally exist
 * before the hoisted factory closes over it.
 */
const tally = vi.hoisted(() => ({ walks: 0 }))

vi.mock('@bamboocss/ts-ast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bamboocss/ts-ast')>()
  return {
    ...actual,
    getDescendantsOfKind: (...args: Parameters<typeof actual.getDescendantsOfKind>) => {
      tally.walks++
      return actual.getDescendantsOfKind(...args)
    },
  }
})

const { Project } = await import('@bamboocss/ts-ast')

const root = mkdtempSync(path.join(tmpdir(), 'bamboo-walks-'))
writeFileSync(
  path.join(root, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { jsx: 'react', noEmit: true, noLib: true }, include: ['**/*'] }),
)
const project = new Project({ cwd: root, tsConfigFilePath: path.join(root, 'tsconfig.json') })

let counter = 0
const walksFor = (code: string) => {
  const sourceFile = project.createSourceFile(`walks-${counter++}.tsx`, code)
  if (!sourceFile) throw new Error('bamboo: the walk-counting project did not accept the source')

  tally.walks = 0
  createCompiledJsxContext(sourceFile)
  return tally.walks
}

/** What a person writes. Neither walk can match it. */
const HAND_WRITTEN = `
import { css } from 'styled-system/css'

export const Card = ({ tone, children }) => (
  <div className={css({ color: tone, padding: '4' })}>
    <span className={css({ fontWeight: 'bold' })}>{children}</span>
  </div>
)

export function helper(a, b) {
  return { ...a, ...b }
}
`

/** The shape the second walk exists for: Solid's `mergeProps`, inlined by a bundler. */
const BUNDLED_SOLID = `
function mergeProps(...sources) {
  const resolveSource = (s) => typeof s === 'function' ? s() : s
  return new Proxy({}, { get(_, k) { for (let i = sources.length - 1; i >= 0; i--) {} } })
}
export { mergeProps }
`

/** The shape the first walk exists for. */
const BUNDLED_PARCEL = `
parcelRegister("abc12", function(module, exports) {
  module.exports = { "Fragment": 1, "jsx": 2, "jsxs": 3 }
})
`

describe('the compiled-jsx context reads a module only when it could be bundler output', () => {
  test('hand-written source is not walked at all', () => {
    expect(walksFor(HAND_WRITTEN)).toBe(0)
  })

  test.each([
    ['inlined solid helper', BUNDLED_SOLID],
    ['parcel registry', BUNDLED_PARCEL],
  ])('%s is still walked', (_label, code) => {
    expect(walksFor(code)).toBeGreaterThan(0)
  })

  /**
   * The Parcel callee is compared through `getText()`, which resolves an identifier as the compiler
   * reads it — so the plain name appears nowhere in this source and the walk still matches it. The
   * guard has to let an escape through for the same reason `fold.ts` does.
   */
  test('an escaped `parcelRegister` is still walked', () => {
    expect(walksFor(`\\u0070arcelRegister("a", function (module, exports) { module.exports = {} })`)).toBeGreaterThan(0)
  })
})
