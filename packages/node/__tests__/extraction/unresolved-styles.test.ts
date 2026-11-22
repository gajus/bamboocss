import { describe, expect, test } from 'vitest'
import { parseAndExtract } from './fixture'

/**
 * A style the build cannot resolve has no rule behind it. For a `css()` call that is a call the
 * compiler then fails the build at, naming it; extraction says what it could not read, and the
 * `no-unresolved-styles` lint rule says it in the editor, in the same words.
 */
const unresolved = (code: string) => parseAndExtract(code).parserResult.unresolved

const withCss = (body: string) => `import { css } from "styled-system/css"\n${body}`

describe('unresolved styles', () => {
  test('a spread the build cannot enumerate is reported', () => {
    const found = unresolved(withCss(`declare const rest: any\ncss({ color: "red", ...rest })`))

    expect(found).toHaveLength(1)
    expect(found[0].reason).toBe('unenumerable-keys')
    expect(found[0].line).toBeGreaterThan(0)
    expect(found[0].filePath).toContain('test.tsx')
  })

  test('a computed key is reported for the same reason', () => {
    const found = unresolved(withCss(`declare const key: string\ncss({ color: "red", [key]: "blue" })`))

    expect(found.map((entry) => entry.reason)).toContain('unenumerable-keys')
  })

  // --- quiet where it should be ---

  /**
   * The retired engine kept this quiet. The native engine reports it as `missing-property`,
   * deliberately — see `.changeset/native-extractor-parity.md`. The call does not compile, and the
   * compiler says so; extraction still writes the rules it could read.
   */
  test('a value the extractor cannot evaluate is reported, and the rest still applies', () => {
    const result = parseAndExtract(
      withCss(`function App(props) { return css({ fontSize: "xl", color: props.color }) }`),
    )

    expect(result.parserResult.unresolved.map(({ prop, reason }) => ({ prop, reason }))).toEqual([
      { prop: 'color', reason: 'missing-property' },
    ])
    // The half it did resolve still reaches the stylesheet.
    expect(result.css).toContain('fs_xl')
  })

  test('a written undefined is not reported', () => {
    const result = parseAndExtract(withCss(`css({ color: undefined, fontSize: "14px" })`))

    expect(result.parserResult.unresolved).toEqual([])
  })

  test('a fully static call reports nothing', () => {
    expect(unresolved(withCss(`css({ fontSize: "xl", color: "red" })`))).toEqual([])
  })

  test('a statically resolvable spread reports nothing', () => {
    expect(unresolved(withCss(`const base = { fontSize: "xl" }\ncss({ ...base, color: "red" })`))).toEqual([])
  })

  /**
   * It reached the data as `{}`, which is complete and loses nothing, so nothing was reported
   * where the same value under a key was.
   */
  test('a whole argument the build cannot evaluate is reported', () => {
    const found = unresolved(
      withCss(
        `const pads = { sm: { px: "2" }, lg: { px: "6" } }\n` +
          `export const a = (size) => css(pads[size])\n` +
          `export const b = (styles) => css({ color: "red" }, styles)`,
      ),
    )

    expect(found.map(({ line, prop, reason }) => ({ line, prop, reason }))).toEqual([
      { line: 3, prop: undefined, reason: 'unresolvable-value' },
      { line: 4, prop: undefined, reason: 'unresolvable-value' },
    ])
  })

  test('a choice between styles it can read is not, and nor is a known argument', () => {
    const found = unresolved(
      withCss(
        `const on = { color: "red" }, off = { color: "blue" }\n` +
          `export const a = (active) => css(active ? on : off)\n` +
          `export const b = css(on, off)`,
      ),
    )

    expect(found).toEqual([])
  })
})
