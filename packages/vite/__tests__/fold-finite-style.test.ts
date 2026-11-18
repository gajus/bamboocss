import { withoutMergeCodes } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { createFoldFixture, selectorsFor } from './fixture'

const withCss = (body: string) => `import { css, cx } from 'styled-system/css'\n${body}`
const tone = `const tone = loud ? 'loud' : 'quiet'`
const color = `tone === 'quiet' ? 'blue.500' : 'orange.500'`

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
