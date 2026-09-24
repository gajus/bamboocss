import { describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

/**
 * Facts the native analysis has to answer for the fold to rewrite a module correctly.
 *
 * `fold.bench.ts` owns the question of whether a change is faster.
 */
/** The common shape: styles, no `cx`, no `splitVariantProps`, no runtime binding. */
const PLAIN = `
import { css } from 'styled-system/css'

export const a = css({ color: 'red.300', padding: '4' })
export const View = () => <div className={css({ display: 'flex' })}>x</div>
`

/** The same module, plus the one import that gives the `cx` composition something to match. */
const WITH_CX = `
import { css, cx } from 'styled-system/css'

export const a = css({ color: 'red.300', padding: '4' })
export const View = () => <div className={cx(css({ display: 'flex' }), 'extra')}>x</div>
`

describe('what the analysis answers', () => {
  test('a module holding only a runtime binding reports it', () => {
    const { foldStrict } = createFoldFixture()
    const result = foldStrict(`const { css } = require('styled-system/css')\nexport const a = css({})\n`)

    expect(result.skipped.some((entry) => entry.reason === 'runtime-binding')).toBe(true)
  })

  /**
   * An identifier is its name however it is spelled, so `badge.\u0073plitVariantProps` is the
   * same member as the plain spelling. Guarding on the source text alone once left this call
   * unlowered against an erased binding, which a review caught and this pins.
   */
  test('an escaped `splitVariantProps` is still lowered', () => {
    const escaped = [
      `import { cva } from 'styled-system/css'`,
      `const badge = cva({ base: { display: 'flex' }, variants: { tone: { info: { color: 'blue.500' } } } })`,
      `export const B = (p) => { const [v, r] = badge.\\u0073plitVariantProps(p); return [badge(v), r] }`,
    ].join('\n')

    const result = createFoldFixture().fold(escaped)

    expect(result.code).toContain('splitProps')
    expect(result.code).not.toContain('\\u0073plitVariantProps')
  })

  test('folding compiles every call whether or not the module composes', () => {
    const { fold } = createFoldFixture()
    const plain = fold(PLAIN)
    const withCx = fold(WITH_CX, 'app/src/with-cx.tsx')

    expect(plain.code).not.toContain('css({')
    expect(withCx.code).toContain('extra')
    expect(withCx.code).not.toContain('css({')
  })
})
