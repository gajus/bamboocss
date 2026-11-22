import { withoutMergeCodes } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { createFoldFixture, selectorsFor } from './fixture'

const withCss = (body: string) => `import { css, cx } from 'styled-system/css'\n${body}`
const tone = `const tone = loud ? 'loud' : 'quiet'`
const color = `tone === 'quiet' ? 'blue.500' : 'orange.500'`
/** The compiled module's `badge`, run without the imports nothing compiled left reading. */
const badgeOf = (code: string) => new Function(`${code.replace(/^import.*\n/gm, '')}\nreturn badge`)()

describe('finite css() choices', () => {
  test('selects between emitted class strings using the local binding', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      withCss(`
      function badge(read) {
        const tone = read() ? 'loud' : 'quiet';
        return css({ padding: '4', _hover: { color: ${color} } });
      }
    `),
    )

    expect(result.skipped).toEqual([])
    const [folded] = result.folded
    expect(folded?.classNames).toHaveLength(2)
    const badge = new Function(`${result.code.replace(/^import.*\n/, '')}\nreturn badge`)()
    let reads = 0
    for (const flag of [false, true]) {
      const chosen = badge(() => {
        reads++
        return flag
      })
      expect(withoutMergeCodes(chosen)).toContain(flag ? 'hover:c_orange.500' : 'hover:c_blue.500')
      expect(withoutMergeCodes(chosen)).toContain('p_4')
    }
    expect(reads).toBe(2)

    const css = fixture.getStyleSetCss()
    for (const classes of folded!.classNames) {
      for (const selector of selectorsFor(classes)) expect(css).toContain(selector)
    }
  })

  test('selects by a test read directly, css({ padding: compact ? "2" : "4" })', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      withCss(`function badge(compact) { return css({ padding: compact ? '2' : '4' }); }`),
    )

    expect(result.skipped).toEqual([])
    expect(withoutMergeCodes(result.code)).toContain(`return ((compact) ? "p_2" : "p_4");`)
    const badge = badgeOf(result.code)
    expect(withoutMergeCodes(badge(true))).toBe('p_2')
    expect(withoutMergeCodes(badge(false))).toBe('p_4')

    const css = fixture.getStyleSetCss()
    for (const classes of result.folded[0]!.classNames) {
      for (const selector of selectorsFor(classes)) expect(css).toContain(selector)
    }
  })

  /**
   * The test is copied into what the call compiles to, and asked there: where the call was, once.
   * Whatever it reads, only the two styles it chooses between have to be known.
   */
  test.each([
    `props.compact`,
    `props.size === 'sm'`,
    `isCompact(props)`,
    `(props.density ?? 'compact') !== 'comfortable'`,
  ])('selects by %s, asked once', (condition) => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      withCss(`const isCompact = (props) => props.compact
      function badge(props) {
        return css({ color: 'red.500', _hover: { padding: ${condition} ? '2' : '4' } });
      }`),
    )

    expect(result.skipped).toEqual([])
    const [folded] = result.folded
    expect(folded?.classNames).toHaveLength(2)
    const badge = badgeOf(result.code)
    let reads = 0
    for (const compact of [true, false]) {
      const values: Record<string, unknown> = compact
        ? { compact, size: 'sm', density: undefined }
        : { compact, size: 'lg', density: 'comfortable' }
      const props = new Proxy(values, {
        get: (target, key) => {
          reads++
          return target[key as string]
        },
      })
      const chosen = withoutMergeCodes(badge(props))
      expect(chosen).toContain(compact ? 'hover:p_2' : 'hover:p_4')
      expect(chosen).toContain('c_red.500')
    }
    expect(reads).toBe(2)

    const css = fixture.getStyleSetCss()
    for (const classes of folded!.classNames) {
      for (const selector of selectorsFor(classes)) expect(css).toContain(selector)
    }
  })

  test('in cx(), asks the test only where the call would have run', () => {
    const { foldStrict } = createFoldFixture()
    const result = foldStrict(
      withCss(`function badge(user) {
      return cx(css({ padding: '2' }), user && css({ color: user.admin ? 'red.500' : 'blue.500' }));
    }`),
    )

    expect(result.skipped.every(({ reason }) => reason === 'overlapping')).toBe(true)
    expect(result.code).not.toMatch(/\bcx\(/)
    const badge = badgeOf(result.code)
    // Read where `user` is null, `user.admin` would throw: the call never read it there.
    expect(withoutMergeCodes(badge(null))).toBe('p_2')
    expect(withoutMergeCodes(badge({ admin: true }))).toBe('p_2 c_red.500')
    expect(withoutMergeCodes(badge({ admin: false }))).toBe('p_2 c_blue.500')
  })

  test('composes two choices, each a css() call of its own, in cx()', () => {
    const { foldStrict } = createFoldFixture()
    const result = foldStrict(
      withCss(`function badge(compact, loud) {
      return cx(css({ padding: compact ? '2' : '4' }), css({ color: loud ? 'red.500' : 'blue.500' }));
    }`),
    )

    expect(result.skipped.every(({ reason }) => reason === 'overlapping')).toBe(true)
    const badge = badgeOf(result.code)
    expect(withoutMergeCodes(badge(true, true))).toBe('p_2 c_red.500')
    expect(withoutMergeCodes(badge(true, false))).toBe('p_2 c_blue.500')
    expect(withoutMergeCodes(badge(false, true))).toBe('p_4 c_red.500')
    expect(withoutMergeCodes(badge(false, false))).toBe('p_4 c_blue.500')
  })

  /**
   * A test reading what the compiler replaces. Copied, a read of a Bamboo import would keep the
   * generated runtime the compiled module no longer calls, a read of a recipe would read the
   * `undefined` its declaration is erased to, and a call compiled on its own would be copied as
   * it was written.
   */
  test.each([
    ['reads a Bamboo import', `props.join === cx ? 'red.500' : 'blue.500'`],
    ['reads a recipe', `props.recipe === tone ? 'red.500' : 'blue.500'`],
    ['calls a Bamboo import', `cx(props.className) ? 'red.500' : 'blue.500'`],
    ['calls token()', `token(props.path) ? 'red.500' : 'blue.500'`],
    ['calls css()', `css({ color: 'red.500' }) ? 'red.500' : 'blue.500'`],
    ['calls a recipe', `tone() ? 'red.500' : 'blue.500'`],
  ])('declines a choice whose test %s', (_, value) => {
    const { foldStrict } = createFoldFixture()
    const source =
      `import { css, cva, cx } from 'styled-system/css'\nimport { token } from 'styled-system/tokens'\n` +
      `const tone = cva({ base: { padding: '2' } })\n` +
      `export function badge(props) { return css({ color: ${value} }) }\n`
    const result = foldStrict(source)

    expect(result.skipped).toContainEqual(
      expect.objectContaining({ name: 'css', reason: 'dynamic', start: source.indexOf('css({ color:') }),
    )
    expect(result.folded.map(({ start }) => start)).not.toContain(source.indexOf('css({ color:'))
  })

  test('composes each branch with the other cx() arguments', () => {
    const { foldStrict } = createFoldFixture()
    const result = foldStrict(
      withCss(`function badge(loud) {
      ${tone};
      return cx(css({ color: 'red.500', padding: '2' }), css({ color: ${color} }), css({ padding: '4' }));
    }`),
    )

    expect(result.skipped.every(({ reason }) => reason === 'overlapping')).toBe(true)
    const output = withoutMergeCodes(result.code)
    expect(output).toContain('c_blue.500')
    expect(output).toContain('c_orange.500')
    expect(output).toContain('p_4')
    expect(output).not.toMatch(/c_red\.500|p_2|\bcx\(/)
  })

  test('keeps an empty branch and does not join with a prior statement', () => {
    const { foldStrict } = createFoldFixture()
    const result = foldStrict(
      withCss(`function badge(loud) {
      const enabled = loud ? true : false
      const state = 'previous statement'
      css(enabled ? { color: 'blue.500' } : {}).toUpperCase()
      return state
    }`),
    )

    expect(result.skipped).toEqual([])
    expect(result.code).toContain('void 0,')
    const badge = new Function(`${result.code.replace(/^import.*\n/, '')}\nreturn badge`)()
    expect(badge(false)).toBe('previous statement')
    expect(badge(true)).toBe('previous statement')
  })

  test.each([
    `css({ color: tone === 'quiet' ? loud : 'orange.500' })`,
    `css({ color: ${color}, padding: loud })`,
    `css({ color: ${color}, ...loud })`,
  ])('declines %s, where an answer or another value is not known', (style) => {
    const { foldStrict } = createFoldFixture()
    const result = foldStrict(withCss(`function badge(loud) { ${tone}; return ${style}; }`))

    expect(result.folded).toEqual([])
    expect(result.skipped).toContainEqual(expect.objectContaining({ reason: 'dynamic' }))
  })
})

/**
 * Choices in one `css()` call: a ternary per test, asked where the call asked it and only on the
 * path that reaches it, each answer the class string `css()` names for what that path writes.
 */
describe('several choices in one css() call', () => {
  /** Every class the call compiles to has a rule in the stylesheet extraction built. */
  const expectRules = (
    fixture: ReturnType<typeof createFoldFixture>,
    result: ReturnType<typeof fixture.foldStrict>,
  ) => {
    const css = fixture.getStyleSetCss()
    const classNames = result.folded.flatMap((folded) => folded.classNames)
    expect(classNames.length).toBeGreaterThan(0)
    for (const classes of classNames) {
      for (const selector of selectorsFor(classes)) expect(css, selector).toContain(selector)
    }
  }

  test('compiles one class string per combination of two choices', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      withCss(`function badge(active, loud) {
      return css({ color: active ? 'white' : 'gray.700', bg: loud ? 'red.500' : 'transparent' });
    }`),
    )

    expect(result.skipped).toEqual([])
    expect(result.folded[0]?.classNames).toHaveLength(4)
    const badge = badgeOf(result.code)
    for (const active of [true, false]) {
      for (const loud of [true, false]) {
        const styles = { color: active ? 'white' : 'gray.700', bg: loud ? 'red.500' : 'transparent' }
        expect(badge(active, loud), JSON.stringify(styles)).toBe(fixture.runtimeCss(styles))
      }
    }
    expectRules(fixture, result)
  })

  test('asks a choice inside an answer only on the path that reaches it', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      withCss(`function badge(first, second) {
      return css({ color: first() ? (second() ? 'red.100' : 'red.300') : 'gray.700', padding: '2' });
    }`),
    )

    expect(result.skipped).toEqual([])
    const badge = badgeOf(result.code)
    for (const [one, two, color] of [
      [true, true, 'red.100'],
      [true, false, 'red.300'],
      [false, true, 'gray.700'],
    ] as const) {
      let asked = 0
      const answer = badge(
        () => one,
        () => {
          asked++
          return two
        },
      )
      expect(answer).toBe(fixture.runtimeCss({ color, padding: '2' }))
      expect(asked, 'the second test is asked only where the first answered yes').toBe(one ? 1 : 0)
    }
    expectRules(fixture, result)
  })

  // Read again, a plain read answers the same, so the call asks it once.
  test('asks a plain read written twice once', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      withCss(`function badge(props) {
      return css({ color: props.active ? 'white' : 'gray.700', bg: props.active ? 'blue.500' : 'transparent' });
    }`),
    )

    expect(result.skipped).toEqual([])
    expect(result.folded[0]?.classNames).toHaveLength(2)
    const badge = badgeOf(result.code)
    for (const active of [true, false]) {
      let reads = 0
      const props = new Proxy({ active }, { get: (target, key) => (reads++, target[key as 'active']) })
      const styles = { color: active ? 'white' : 'gray.700', bg: active ? 'blue.500' : 'transparent' }
      expect(badge(props)).toBe(fixture.runtimeCss(styles))
      expect(reads).toBe(1)
    }
    expectRules(fixture, result)
  })

  // One that could run something may answer otherwise the next time, so it is asked as often as written.
  test('asks a test that could run something each time it is written', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      withCss(`function badge(pick) {
      return css({ color: pick() ? 'white' : 'gray.700', bg: pick() ? 'blue.500' : 'transparent' });
    }`),
    )

    expect(result.skipped).toEqual([])
    expect(result.folded[0]?.classNames).toHaveLength(4)
    const badge = badgeOf(result.code)
    for (const answers of [
      [true, false],
      [false, true],
    ]) {
      const queue = [...answers]
      const styles = { color: answers[0] ? 'white' : 'gray.700', bg: answers[1] ? 'blue.500' : 'transparent' }
      expect(badge(() => queue.shift())).toBe(fixture.runtimeCss(styles))
      expect(queue).toEqual([])
    }
    expectRules(fixture, result)
  })

  test('merges a spread and a second argument where they are written', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      withCss(`const base = { display: 'flex', color: 'gray.700' }
      const more = { padding: '2', color: 'gray.500' }
      function badge(active) {
        return css(base, { ...more, color: active ? 'white' : 'gray.900' });
      }`),
    )

    expect(result.skipped).toEqual([])
    const badge = badgeOf(result.code)
    const base = { display: 'flex', color: 'gray.700' }
    for (const active of [true, false]) {
      const second = { padding: '2', color: active ? 'white' : 'gray.900' }
      expect(badge(active)).toBe(fixture.runtimeCss(base, second))
    }
    expectRules(fixture, result)
  })

  test('compiles up to 32 combinations, and fails the build past them', () => {
    const choices = [
      `color: a ? 'white' : 'gray.700'`,
      `bg: b ? 'red.500' : 'transparent'`,
      `padding: c ? '2' : '4'`,
      `margin: d ? '1' : '2'`,
      `opacity: e ? 0.5 : 1`,
      `fontWeight: f ? 'bold' : 'light'`,
    ]
    const fold = (count: number) =>
      createFoldFixture().foldStrict(
        withCss(`function badge(a, b, c, d, e, f) { return css({ ${choices.slice(0, count).join(', ')} }); }`),
      )

    const fixture = createFoldFixture()
    const five = fixture.foldStrict(
      withCss(`function badge(a, b, c, d, e) { return css({ ${choices.slice(0, 5).join(', ')} }); }`),
    )
    expect(five.skipped).toEqual([])
    expectRules(fixture, five)
    expect(five.folded[0]?.classNames).toHaveLength(32)
    expect(fold(6).skipped).toContainEqual(expect.objectContaining({ name: 'css', reason: 'dynamic' }))
  })

  test('composes with the other arguments of a cx()', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(
      withCss(`function badge(active, loud) {
      return cx(css({ color: active ? 'white' : 'gray.700', bg: loud ? 'red.500' : 'transparent' }), css({ padding: '4' }));
    }`),
    )

    expect(result.skipped.every(({ reason }) => reason === 'overlapping')).toBe(true)
    expect(result.code).not.toMatch(/\bcx\(/)
    const badge = badgeOf(result.code)
    for (const active of [true, false]) {
      for (const loud of [true, false]) {
        const styles = { color: active ? 'white' : 'gray.700', bg: loud ? 'red.500' : 'transparent' }
        expect(badge(active, loud)).toBe(fixture.runtimeCss(styles, { padding: '4' }))
      }
    }
    expectRules(fixture, result)
  })
})
