import { createContext } from '@bamboocss/fixture'
import { logger } from '@bamboocss/logger'
import { afterEach, describe, expect, test, vi } from 'vitest'

/**
 * `invalidDeclaration` grades a declaration in the emitted sheet that is not valid CSS for its
 * property.
 *
 * It is the other end of the pipeline from `unresolvedToken`. That check reads the values the
 * source asked for; this one reads what the finished sheet contains, after every utility
 * transform, mixin and recipe has had its say — the only place a transform that handed a value
 * through unchanged, or a `[…]` literal that was never valid CSS, can be seen at all.
 *
 * Driven through a real build, as the unresolved-token tests are, so that what is graded is
 * exactly what `getCss` emits.
 */
const build = (severity: 'off' | 'warn' | 'error' | undefined, source: string, config: object = {}) => {
  const ctx = createContext({ ...(severity ? { invalidDeclaration: severity } : {}), ...config } as any) as any
  const files: string[] = []

  const write = (src: string) => {
    const file = ctx.runtime.path.abs(ctx.config.cwd, 'src/app.tsx')
    const existing = ctx.project.getSourceFile(file)
    if (existing) existing.replaceWithText(src)
    else ctx.project.addSourceFile(file, src)
    if (!files.includes(file)) files.push(file)
  }

  ctx.getFiles = () => files
  write(source)

  const run = () => {
    ctx.parseFiles()
    const sheet = ctx.createSheet()
    ctx.appendBaselineCss(sheet)
    ctx.appendParserCss(sheet)
    return ctx.getCss(sheet)
  }

  return { ctx, run, write }
}

const styled = (value: string, prop = 'width') => `
  import { css } from 'styled-system/css'
  export const App = () => <div className={css({ ${prop}: '${value}' })} />
`

const messages = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: unknown[]) => String(c[1])).join('\n')
const reports = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c: unknown[]) => String(c[1]).includes('not valid CSS for their property'))

afterEach(() => vi.restoreAllMocks())

describe('default', () => {
  test('warns, naming the property, the value and the class that carries it', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    // The escape hatch says "I mean this literally", and `width` takes one length.
    const { run } = build(undefined, styled('[10px 20px]'))

    expect(() => run()).not.toThrow()
    expect(messages(spy)).toMatch(/`width: 10px 20px` in `\.w_/)
    expect(messages(spy)).toMatch(/`@layer utilities`/)
  })

  test('warns once per process, not once per emitted sheet', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { run } = build(undefined, styled('[10px 20px]'))

    run()
    run()
    expect(reports(spy)).toHaveLength(1)
  })

  test('leaves a token-backed value alone, since the grammar cannot see what the variable holds', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { run } = build(undefined, styled('red.500', 'color'))

    run()
    expect(reports(spy)).toHaveLength(0)
  })

  test('leaves a valid literal alone', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { run } = build(undefined, styled('[10px]'))

    run()
    expect(reports(spy)).toHaveLength(0)
  })

  test('does not report a finding the unresolved-token check already owns', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    // `display` draws from no token category, so `flexx` is that check's grammar half — reported
    // as it is transformed, and not again here as the `display: flexx` it became.
    const { run } = build(undefined, styled('flexx', 'display'))

    run()
    expect(messages(spy)).toMatch(/`display: flexx`/)
    expect(reports(spy)).toHaveLength(0)
  })

  test('leaves a token that does not exist to that check even when it is off', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    // `accent.default` is both a token that does not exist and a value the grammar rejects.
    // Turning the token check off has to mean silence about it, not the same mistake in
    // this check's voice.
    const { run } = build('warn', styled('accent.default', 'background'), { unresolvedToken: 'off' })

    expect(() => run()).not.toThrow()
    expect(messages(spy)).not.toMatch(/accent\.default/)
  })

  test('still fails the build on it under error, and leaves it to that check', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { run } = build('warn', styled('accent.default', 'background'), { unresolvedToken: 'error' })

    expect(() => run()).toThrowError(/no such `colors` token/)
    expect(reports(spy)).toHaveLength(0)
  })
})

describe("'off'", () => {
  test('says nothing and does not fail', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { run } = build('off', styled('[10px 20px]'))

    expect(() => run()).not.toThrow()
    expect(reports(spy)).toHaveLength(0)
  })

  test('the css is unchanged — the option grades a report, not the output', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const off = build('off', styled('[10px 20px]'))
    const warn = build('warn', styled('[10px 20px]'))

    expect(off.run()).toBe(warn.run())
  })
})

describe("'error'", () => {
  test('fails the build with its own code, naming the declaration', () => {
    const { run } = build('error', styled('[10px 20px]'))

    let caught: unknown
    try {
      run()
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as { code?: string }).code).toBe('ERR_BAMBOO_INVALID_DECLARATION')
    expect((caught as Error).message).toMatch(/`width: 10px 20px`/)
  })

  test('does not also warn, which would report every finding twice', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { run } = build('error', styled('[10px 20px]'))

    expect(() => run()).toThrow()
    expect(reports(spy)).toHaveLength(0)
  })

  test('passes a sheet with nothing to report', () => {
    const { run } = build('error', styled('[10px]'))

    expect(() => run()).not.toThrow()
  })
})
