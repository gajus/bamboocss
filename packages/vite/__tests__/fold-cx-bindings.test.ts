import { describe, expect, test } from 'vitest'
import { MAX_CX_COMBINATIONS } from '../src/fold'
import { createFoldFixture, selectorsFor } from './fixture'

/**
 * `cx()` over the bindings a component declares its styles in, picked by conditions:
 * `cx(badge, high && badgeHigh)`.
 *
 * These were left to the runtime `cx` — a string join on every render, of strings it had to build
 * again each time — because an argument naming a binding was opaque to the fold, and so was a
 * condition. Composed at build time, each combination of answers is a literal, and the call is a
 * ternary choosing one. They compose as a `cx()` of the `css()` calls themselves always has: the
 * declarations merge and later arguments win, so an overridden atom never reaches the markup.
 */

const STYLES = `
  const base = css({ display: 'flex', color: 'red.300' })
  const loud = css({ color: 'blue.500' })
  const small = css({ fontSize: 'sm' })
  const large = css({ fontSize: 'lg' })
`

const module = (body: string) => `import { css, cx } from 'styled-system/css'\n${STYLES}\n${body}\n`

/**
 * A folded module's exports, evaluated. Its imports are dropped, so a call left uncompiled throws
 * for want of `cx` rather than passing for one that compiled — unless `runtime` names the bindings
 * a call the fold left standing is meant to reach, which are given the runtime join.
 */
const evaluate = (code: string, names: string[], runtime: string[] = []) =>
  new Function(
    `${runtime.map((name) => `const ${name} = (...args) => args.filter((arg) => typeof arg === 'string' && arg).join(' ')`).join('\n')}\n` +
      `${code.replace(/^import .*$/gm, '').replaceAll('export const ', 'const ')}\nreturn { ${names.join(', ')} }`,
  )() as Record<string, (...args: unknown[]) => string>

describe('cx() over module-scope style bindings', () => {
  test('composes them as it composes the calls they hold', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(module(`export const className = cx(base, loud)`))

    expect(result.skipped).toEqual([])
    expect(result.code).toContain(
      `export const className = ${JSON.stringify(fixture.runtimeCss({ display: 'flex', color: 'blue.500' }))}`,
    )
  })

  test('a condition chooses between complete compositions', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(module(`export const pick = (on) => cx(base, on && loud)`))

    expect(result.skipped).toEqual([])
    expect(result.code).not.toContain('cx(')
    const { pick } = evaluate(result.code, ['pick'])
    expect(pick!(true)).toBe(fixture.runtimeCss({ display: 'flex', color: 'blue.500' }))
    expect(pick!(false)).toBe(fixture.runtimeCss({ display: 'flex', color: 'red.300' }))
    // The overridden color is not joined beside the one that wins it.
    expect(pick!(true).split(' ')).not.toContain('c_red.300')
  })

  test('a ternary chooses between its arms', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(module(`export const pick = (sm) => cx(base, sm ? small : large)`))

    expect(result.code).not.toContain('cx(')
    const { pick } = evaluate(result.code, ['pick'])
    expect(pick!(1)).toBe(fixture.runtimeCss({ display: 'flex', color: 'red.300', fontSize: 'sm' }))
    expect(pick!(0)).toBe(fixture.runtimeCss({ display: 'flex', color: 'red.300', fontSize: 'lg' }))
  })

  test('passes classes written as strings through, in every combination', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(module(`export const pick = (on) => cx('external', base, on && 'selected')`))

    const { pick } = evaluate(result.code, ['pick'])
    const composed = fixture.runtimeCss({ display: 'flex', color: 'red.300' })
    expect(pick!(true)).toBe(`external ${composed} selected`)
    expect(pick!(false)).toBe(`external ${composed}`)
  })

  /**
   * Each condition is copied into every answer of the conditions before it, so the copies
   * outnumber the evaluations; the ternary takes one path, which asks each condition at most once,
   * in the order the arguments did, and one nested in another's answer only where that answer is
   * taken.
   */
  test('asks every condition once, in order, and only where the call asked it', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      module(
        `export const pick = (log, a, b, c) => cx(base, (log.push('a'), a) && loud, (log.push('b'), b) ? small : (log.push('c'), c) && large)`,
      ),
    )
    expect(result.code).not.toContain('cx(')
    const { pick } = evaluate(result.code, ['pick'])

    for (const a of [true, false]) {
      for (const b of [true, false]) {
        for (const c of [true, false]) {
          const log: string[] = []
          const className = pick!(log, a, b, c)
          expect(log).toEqual(b ? ['a', 'b'] : ['a', 'b', 'c'])
          const expected = {
            display: 'flex',
            color: a ? 'blue.500' : 'red.300',
            ...(b ? { fontSize: 'sm' } : c ? { fontSize: 'lg' } : {}),
          }
          expect(className).toBe(fixture.runtimeCss(expected))
        }
      }
    }
  })

  /**
   * A state, two variants and a flag are sixteen combinations, which a limit of eight left to the
   * runtime join. There a property two arguments set went to whichever rule the stylesheet held later:
   * `muted` is declared above `base`, so an inactive one kept `base`'s color.
   */
  test("compiles a variant component's four conditions, the later argument winning", () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(`import { css, cx } from 'styled-system/css'
const muted = css({ color: 'gray.700' })
${STYLES}
export const pick = (active, size, full) => cx(base, !active && muted, size === 'sm' && small, size === 'lg' && large, full && loud)
`)

    expect(result.code).not.toContain('cx(')
    const { pick } = evaluate(result.code, ['pick'])
    expect(pick!(false, 'sm', false)).toBe(fixture.runtimeCss({ display: 'flex', color: 'gray.700', fontSize: 'sm' }))
    expect(pick!(true, 'lg', true)).toBe(fixture.runtimeCss({ display: 'flex', color: 'blue.500', fontSize: 'lg' }))
  })

  test('stays the runtime join past the combinations it is compiled to', () => {
    const conditions = Math.log2(MAX_CX_COMBINATIONS) + 1
    const flags = Array.from({ length: conditions }, (_, index) => `f${index}`)
    const result = createFoldFixture().foldStrict(
      module(
        `export const pick = (${flags.join(', ')}) => cx(base, ${flags.map((flag) => `${flag} && loud`).join(', ')})`,
      ),
    )

    expect(result.code).toContain('cx(base,')
    expect(result.skipped).toContainEqual(expect.objectContaining({ name: 'cx', reason: 'dynamic' }))
  })

  test('every class a combination emits has a rule', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      module(`export const pick = (on, sm) => cx(base, on && loud, sm ? small : large)`),
    )

    const cx = result.folded.find((entry) => entry.name === 'cx')
    expect(cx?.className).toBe('')
    expect(cx?.classNames).toEqual(expect.arrayContaining(['d_flex', 'c_red.300', 'c_blue.500', 'fs_sm', 'fs_lg']))
    const css = fixture.getStyleSetCss()
    for (const className of cx!.classNames) {
      for (const selector of selectorsFor(className)) expect(css).toContain(selector)
    }
  })

  test('a style binding read in a condition is the string it was compiled to', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(module(`export const pick = () => cx(base, loud && small)`))

    expect(result.code).not.toContain('cx(')
    const { pick } = evaluate(result.code, ['pick'])
    expect(pick!()).toBe(fixture.runtimeCss({ display: 'flex', color: 'red.300', fontSize: 'sm' }))
  })

  test('binds as tightly as the call it replaces', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(module(`export const joined = (on) => cx(base, on && loud) + ' extra'`))

    const { joined } = evaluate(result.code, ['joined'])
    expect(joined!(false)).toBe(`${fixture.runtimeCss({ display: 'flex', color: 'red.300' })} extra`)
  })

  // The line before has no semicolon, so a statement opening with `(` would call its value.
  test('cannot continue the line before it at the start of a statement', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      module(`export const touched = []\nexport const before = 1\ncx(base, touched.push('ran') && loud)`),
    )

    expect(result.code).toContain('void 0, (')
    expect(evaluate(result.code, ['touched']).touched).toEqual(['ran'])
  })
})

describe('cx() beside an argument the compiler cannot read', () => {
  /**
   * A component forwarding the `className` it was given is how most `cx()` calls are written, and
   * the class is the caller's: nothing the build can see. The rest composes as it would alone, and
   * the forwarded class is joined to it at runtime, with no conflict between the two resolved.
   */
  test('composes the rest, and joins the forwarded class at runtime', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(module(`export const pick = (on, className) => cx(base, on && loud, className)`))

    const loudBase = fixture.runtimeCss({ display: 'flex', color: 'blue.500' })
    const quietBase = fixture.runtimeCss({ display: 'flex', color: 'red.300' })
    expect(result.code).toContain(`cx((on) ? ${JSON.stringify(loudBase)} : ${JSON.stringify(quietBase)}, className)`)
    expect(result.skipped).toEqual([])
    const { pick } = evaluate(result.code, ['pick'], ['cx'])
    expect(pick!(true, 'external')).toBe(`${loudBase} external`)
    expect(pick!(false, undefined)).toBe(quietBase)
  })

  test('merges the styles beside it', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(module(`export const pick = (className) => cx(base, loud, className)`))

    const merged = fixture.runtimeCss({ display: 'flex', color: 'blue.500' })
    expect(result.code).toContain(`cx(${JSON.stringify(merged)}, className)`)
  })

  test('runs every argument where it ran, before and after the conditions', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      module(
        `export const pick = (log, a, c) => cx((log.push('before'), c), base, (log.push('a'), a) && loud, (log.push('after'), c))`,
      ),
    )
    const { pick } = evaluate(result.code, ['pick'], ['cx'])

    for (const a of [true, false]) {
      const log: string[] = []
      const composed = fixture.runtimeCss({ display: 'flex', color: a ? 'blue.500' : 'red.300' })
      expect(pick!(log, a, 'x')).toBe(`x ${composed} x`)
      expect(log).toEqual(['before', 'a', 'after'])
    }
  })

  test('copies an argument whole, parentheses included', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      module(`export const pick = (log, on, className) => cx(base, on && loud, (log.push('read'), className))`),
    )

    const log: string[] = []
    const { pick } = evaluate(result.code, ['pick'], ['cx'])
    expect(pick!(log, true, 'external')).toBe(`${fixture.runtimeCss({ display: 'flex', color: 'blue.500' })} external`)
    expect(log).toEqual(['read'])
  })

  test('copies a spread, and keeps the name the call was made by', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(`import { css, cx as join } from 'styled-system/css'
${STYLES}
export const pick = (on, rest) => join(base, on && loud, ...rest)
`)

    expect(result.code).toMatch(/join\(\(on\) \? "[^"]+" : "[^"]+", \.\.\.rest\)/)
    const { pick } = evaluate(result.code, ['pick'], ['join'])
    expect(pick!(false, ['a', 'b'])).toBe(`${fixture.runtimeCss({ display: 'flex', color: 'red.300' })} a b`)
  })

  test('takes a condition choosing between classes it cannot read as one of them', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      module(`export const pick = (on, open, extra) => cx(base, on && loud, open && extra)`),
    )

    expect(result.code).toContain(', open && extra)')
    const { pick } = evaluate(result.code, ['pick'], ['cx'])
    expect(pick!(true, true, 'shown')).toBe(`${fixture.runtimeCss({ display: 'flex', color: 'blue.500' })} shown`)
  })

  test('one style beside it is the class it already was', () => {
    const result = createFoldFixture().foldStrict(module(`export const pick = (className) => cx(base, className)`))

    expect(result.code).toContain('cx(base, className)')
    expect(result.skipped).toContainEqual(expect.objectContaining({ name: 'cx', reason: 'opaque-composition' }))
  })

  // One would run after the conditions it ran before, or before one it ran after.
  test('is left alone where an argument it cannot read stands between two conditions', () => {
    const result = createFoldFixture().foldStrict(
      module(`export const pick = (a, b, className) => cx(base, a && loud, className, b && small)`),
    )

    expect(result.code).toContain('cx(base, a && loud, className, b && small)')
    expect(result.skipped).toContainEqual(expect.objectContaining({ name: 'cx', reason: 'opaque-composition' }))
  })

  test('is left alone where an argument it cannot read reads a recipe, which the copy would keep reading', () => {
    const result = createFoldFixture().foldStrict(`import { css, cva, cx } from 'styled-system/css'
${STYLES}
const badge = cva({ base: { color: 'red.300' } })
export const pick = (on) => cx(base, on && loud, badge.config ? 'a' : 'b')
`)

    expect(result.code).toContain(`cx(base, on && loud, badge.config ? 'a' : 'b')`)
  })

  test('is left alone where an argument it cannot read holds a call it compiles on its own', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      module(`export const pick = (on, extra) => cx(base, on && loud, [css({ color: 'gray.700' }), extra])`),
    )

    expect(result.code).toContain('cx(base, on && loud, [')
    expect(result.code).toContain(JSON.stringify(fixture.runtimeCss({ color: 'gray.700' })))
  })
})

describe('what cx() leaves to the runtime', () => {
  test('a condition reading a Bamboo binding, which the copy would keep alive', () => {
    const result = createFoldFixture().foldStrict(`
      import { css, cx } from 'styled-system/css'
      import { token } from 'styled-system/tokens'
      const base = css({ display: 'flex' })
      const loud = css({ color: 'blue.500' })
      export const pick = () => cx(base, token('colors.red.300') && loud)
    `)

    expect(result.code).toContain('cx(base,')
    expect(result.skipped).not.toContainEqual(expect.objectContaining({ reason: 'runtime-binding' }))
  })

  test('a condition reading a recipe, whose declaration the fold erases', () => {
    const result = createFoldFixture().foldStrict(`
      import { css, cva, cx } from 'styled-system/css'
      const badge = cva({ base: { color: 'red.300' } })
      const loud = css({ color: 'blue.500' })
      export const pick = () => cx(badge(), badge.config && loud)
    `)

    expect(result.code).toContain('cx(')
    expect(result.code).toContain('badge.config && loud')
  })

  test('a name a nested scope binds over the style', () => {
    const result = createFoldFixture().foldStrict(module(`export const pick = (loud) => cx(base, loud)`))

    expect(result.code).toContain('cx(base, loud)')
    expect(result.skipped).toContainEqual(expect.objectContaining({ name: 'cx', reason: 'opaque-composition' }))
  })

  test('a binding that is not const', () => {
    const result = createFoldFixture().foldStrict(`
      import { css, cx } from 'styled-system/css'
      const base = css({ display: 'flex' })
      let loud = css({ color: 'blue.500' })
      export const pick = (on) => cx(base, on && loud)
    `)

    expect(result.code).toContain('cx(base, on && loud)')
  })

  test('a binding whose call is not exact', () => {
    const result = createFoldFixture().foldStrict(`
      import { css, cx } from 'styled-system/css'
      const tone = globalThis.tone
      const base = css({ display: 'flex' })
      const loud = css({ color: tone })
      export const pick = (on) => cx(base, on && loud)
    `)

    expect(result.code).toContain('cx(base, on && loud)')
  })

  test('a join of classes written as strings, with nothing of Bamboo in it', () => {
    const result = createFoldFixture().foldStrict(`
      import { cx } from 'styled-system/css'
      export const pick = (on) => cx('a', on && 'b')
    `)

    expect(result.code).toContain(`cx('a', on && 'b')`)
  })
})

describe('cx() over a style binding imported from another module', () => {
  const SHARED = `import { css } from 'styled-system/css'
export const base = css({ display: 'flex', color: 'red.300' })
export const loud = css({ color: 'blue.500' })
`
  const CONSUMER = `import { cx } from 'styled-system/css'
import { base, loud } from './styles'
export const pick = (on) => cx(base, on && loud)
`

  test('composes it as one declared beside the call', () => {
    const fixture = createFoldFixture()
    fixture.addFiles({ 'app/styles.ts': SHARED })
    const result = fixture.foldStrict(CONSUMER, 'app/use.tsx')

    expect(result.skipped).toEqual([])
    expect(result.code).not.toContain('cx(')
    const { pick } = evaluate(result.code, ['pick'])
    expect(pick!(true)).toBe(fixture.runtimeCss({ display: 'flex', color: 'blue.500' }))
    expect(pick!(false)).toBe(fixture.runtimeCss({ display: 'flex', color: 'red.300' }))
  })

  /**
   * The declaring module is a dependency of the composition. Without the edge, editing a style
   * leaves every consumer holding a literal composed from the style it used to be.
   */
  test('registers the declaring module, and sees it edited', () => {
    const fixture = createFoldFixture()
    fixture.addFiles({ 'app/styles.ts': SHARED })
    const first = fixture.foldStrict(CONSUMER, 'app/use.tsx')
    expect(first.dependencies.some((path) => path.endsWith('app/styles.ts'))).toBe(true)

    fixture.addFiles({ 'app/styles.ts': SHARED.replace('blue.500', 'green.300') })
    const second = fixture.foldStrict(CONSUMER, 'app/use.tsx')
    expect(evaluate(second.code, ['pick']).pick!(true)).toBe(
      fixture.runtimeCss({ display: 'flex', color: 'green.300' }),
    )
  })

  test.each([
    ['a barrel re-export', { 'app/index.ts': `export { base, loud } from './styles'\n` }],
    ['a star re-export', { 'app/index.ts': `export * from './styles'\n` }],
  ])('resolves through %s', (_label, barrel) => {
    const fixture = createFoldFixture()
    fixture.addFiles({ 'app/styles.ts': SHARED, ...barrel })
    const result = fixture.foldStrict(CONSUMER.replace(`'./styles'`, `'./index'`), 'app/use.tsx')

    expect(result.code).not.toContain('cx(')
    expect(result.dependencies.some((path) => path.endsWith('app/styles.ts'))).toBe(true)
  })

  test('a pattern binding composes like a css() one', () => {
    const fixture = createFoldFixture()
    fixture.addFiles({
      'app/styles.ts': `import { flex } from 'styled-system/patterns'\nexport const row = flex({ gap: '2' })\n`,
    })
    const result = fixture.foldStrict(
      `import { css, cx } from 'styled-system/css'
import { row } from './styles'
const loud = css({ color: 'blue.500' })
export const pick = (on) => cx(row, on && loud)
`,
      'app/use.tsx',
    )

    expect(result.code).not.toContain('cx(')
    const { pick } = evaluate(result.code, ['pick'])
    const pattern = fixture.ctx.patterns.transform('flex', { gap: '2' })
    expect(pick!(true)).toBe(fixture.runtimeCss(pattern, { color: 'blue.500' }))
  })

  test('an imported binding whose call is not exact is left to the runtime', () => {
    const fixture = createFoldFixture()
    fixture.addFiles({
      'app/styles.ts': `import { css } from 'styled-system/css'\nconst tone = globalThis.tone\nexport const loud = css({ color: tone })\n`,
    })
    const result = fixture.foldStrict(
      `import { css, cx } from 'styled-system/css'
import { loud } from './styles'
const base = css({ display: 'flex' })
export const pick = (on) => cx(base, on && loud)
`,
      'app/use.tsx',
    )

    expect(result.code).toContain('cx(base, on && loud)')
  })
})

/**
 * The atoms a `cx()` joins with a class it cannot read.
 *
 * Whatever is passed in reaches the element beside them, and nothing at build time says what that
 * is, so the per-chunk split is told which atoms these are and keeps them in the entry sheet, ahead
 * of every class a lazily loaded chunk passes in. A binding counts wherever it is declared: the
 * runtime join reads the class its declaration compiled to.
 */
describe('the atoms cx() joins with a class it cannot read', () => {
  const atomsOf = (fixture: ReturnType<typeof createFoldFixture>, ...styles: Record<string, unknown>[]) =>
    [...new Set(styles.flatMap((style) => fixture.runtimeCss(style).split(' ')))].sort()

  test('a call written inside it', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      `import { css, cx } from 'styled-system/css'\n` +
        `export const pick = (className) => cx(css({ color: 'gray.700' }), className)\n`,
    )

    expect(result.code).toContain('cx("')
    expect(result.joinedClassNames).toEqual(atomsOf(fixture, { color: 'gray.700' }))
  })

  test('a binding declared outside the call', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(module(`export const pick = (className) => cx(base, className)`))

    expect(result.joinedClassNames).toEqual(atomsOf(fixture, { display: 'flex', color: 'red.300' }))
  })

  test('every composition it writes into a call that still joins a class', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      module(`export const pick = (on, open, extra) => cx(base, on && loud, open && extra)`),
    )

    expect(result.code).toContain(', open && extra)')
    expect(result.joinedClassNames).toEqual(
      atomsOf(fixture, { display: 'flex', color: 'blue.500' }, { display: 'flex', color: 'red.300' }),
    )
  })

  test('a binding or call inside an argument it cannot read', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      module(`export const pick = (on, extra) => cx(base, on && loud, [css({ color: 'gray.700' }), extra])`),
    )

    expect(result.joinedClassNames).toEqual(
      atomsOf(fixture, { display: 'flex', color: 'red.300' }, { color: 'blue.500' }, { color: 'gray.700' }),
    )
  })

  test('a binding imported from another module', () => {
    const fixture = createFoldFixture()
    fixture.addFiles({
      'app/styles.ts': `import { css } from 'styled-system/css'\nexport const base = css({ display: 'flex', color: 'red.300' })\n`,
    })
    const result = fixture.foldStrict(
      `import { cx } from 'styled-system/css'\nimport { base } from './styles'\nexport const pick = (className) => cx(base, className)\n`,
      'app/use.tsx',
    )

    expect(result.joinedClassNames).toEqual(atomsOf(fixture, { display: 'flex', color: 'red.300' }))
  })

  test('none where it composes every argument, or joins nothing of Bamboo', () => {
    const fixture = createFoldFixture()

    expect(fixture.foldStrict(module(`export const pick = (on) => cx(base, on && loud)`)).joinedClassNames).toBe(
      undefined,
    )
    expect(
      fixture.foldStrict(
        `import { cx } from 'styled-system/css'\nexport const pick = (className) => cx('group', className)\n`,
      ).joinedClassNames,
    ).toBe(undefined)
  })
})
