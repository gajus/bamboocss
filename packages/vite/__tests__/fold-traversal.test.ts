import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

/**
 * What compiling a module costs, counted rather than timed.
 *
 * This used to count whole-tree reads of the TypeScript AST, because that was where a dev
 * server's per-edit time went: profiling 24 real edits put ts-morph at 87ms per edit against
 * 2.4ms of extraction. The fold no longer holds a TypeScript tree at all — one native pass
 * returns every fact it asks about — so the property worth pinning is the stronger one: the
 * compiler is never started, whatever the module contains. A wall-clock threshold would fail
 * on a busy runner; whether a Go process exists does not.
 *
 * `fold.bench.ts` still owns the question of whether a change is faster.
 */
const here = dirname(fileURLToPath(import.meta.url))

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

/** A module the sandbox actually ships, rather than one written to be compiled. */
const SANDBOX = (() => {
  try {
    return readFileSync(join(here, '../../../sandbox/vite-ts/src/App.tsx'), 'utf8')
  } catch {
    return null
  }
})()

describe('compiling a module never starts the TypeScript compiler', () => {
  test.each([
    ['plain styles', PLAIN, false],
    ['a cx composition', WITH_CX, false],
    ['survivor reporting', PLAIN, true],
    [
      'a runtime binding and nothing else',
      `const { css } = require('styled-system/css')\nexport const a = css({})\n`,
      true,
    ],
  ])('%s', (_, code, reportSurvivors) => {
    const { ctx, fold } = createFoldFixture()
    fold(code, undefined, reportSurvivors)
    expect(ctx.project.hasMaterializedCompiler()).toBe(false)
  })

  /**
   * Asserted rather than skipped when missing: a `runIf` that silently stops running is the
   * same as not having written it.
   */
  test('a real sandbox module', () => {
    expect(SANDBOX, 'sandbox/vite-ts/src/App.tsx moved — repoint this fixture').not.toBeNull()
    const { ctx, fold } = createFoldFixture()
    fold(SANDBOX!, undefined, true)
    expect(ctx.project.hasMaterializedCompiler()).toBe(false)
  })
})

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
