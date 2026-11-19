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
    `css({ color: ${color}, background: ${color} })`,
    `css({ color: ${color}, ...loud })`,
  ])('declines %s when the entire argument is not a single finite choice', (style) => {
    const { foldStrict } = createFoldFixture()
    const result = foldStrict(withCss(`function badge(loud) { ${tone}; return ${style}; }`))

    expect(result.folded).toEqual([])
    expect(result.skipped).toContainEqual(expect.objectContaining({ reason: 'dynamic' }))
  })
})
