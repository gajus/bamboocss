import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/**
 * A file's own declaration order is never contradicted by another file's.
 *
 * Atoms are global and shared, so one rule exists per declaration however many files write
 * it. Where that rule sits used to be decided by the *first* file to mention it — "first
 * active occurrence" — which threw away what every later file said. A file declaring `base`
 * before `variant` had `base` pushed after it whenever some unrelated file happened to
 * mention `variant` first.
 *
 * That is not cosmetic. Both are `color` atoms of equal specificity with no condition, so
 * they share one utility sublayer, and inside a sublayer the later rule wins. The buttons in
 * `css-in-js-bench`'s `btn-variant` case lost their base colour exactly this way, because
 * another case file claimed the variant colours first.
 *
 * Position is now a topological sort over every file's declared sequence, so all of them hold
 * at once.
 */
const COLOR = /\.c_\\?#[0-9a-fA-F]+/g

const sheetFor = (files: Record<string, string>) => {
  const ctx = createContext() as any
  const paths = Object.keys(files).map((file) => ctx.runtime.path.abs(ctx.config.cwd, file))
  Object.values(files).forEach((source, index) => ctx.project.addSourceFile(paths[index], source))
  ctx.getFiles = () => paths
  ctx.parseFiles()
  const sheet = ctx.createSheet()
  ctx.appendParserCss(sheet)
  return ctx.getCss(sheet) as string
}

const colorOrder = (css: string) => css.match(COLOR) ?? []

/** The benchmark's case: every variant its own `css()`, selected at the call site by `cx`. */
const BUTTON = `
  import { css, cx } from 'styled-system/css'
  const base = css({ backgroundColor: "#2563eb", color: "#ffffff" })
  const inactive = css({ backgroundColor: "#d1d5db", color: "#6b7280" })
  const secondary = css({ backgroundColor: "#f3f4f6", color: "#111827" })
  const ghost = css({ backgroundColor: "transparent", color: "#2563eb" })
  export const Button = (p) =>
    cx(base, !p.active && inactive, p.variant === 's' && secondary, p.variant === 'g' && ghost)
`

/** Another case file that happens to use the same variant colours, read first. */
const ELSEWHERE = `
  import { css } from 'styled-system/css'
  export const muted = css({ color: "#6b7280" })
  export const strong = css({ color: "#111827" })
  export const link = css({ color: "#2563eb" })
`

describe('declaration order survives sharing', () => {
  test('the base rule precedes the variants it is overridden by', () => {
    const expected = ['.c_\\#fff', '.c_\\#6b7280', '.c_\\#111827', '.c_\\#2563eb']

    expect(colorOrder(sheetFor({ 'src/button.tsx': BUTTON }))).toEqual(expected)
    // The same sheet, whether or not an earlier file already named the variant colours.
    expect(colorOrder(sheetFor({ 'src/a-elsewhere.tsx': ELSEWHERE, 'src/button.tsx': BUTTON }))).toEqual(expected)
  })

  test('a later file’s order is honoured even when an earlier file shares its atoms', () => {
    const first = `
      import { css } from 'styled-system/css'
      export const b = css({ color: "#6b7280" })
    `
    const second = `
      import { css } from 'styled-system/css'
      export const a = css({ color: "#ffffff" })
      export const b = css({ color: "#6b7280" })
    `
    const css = sheetFor({ 'src/a-first.tsx': first, 'src/b-second.tsx': second })

    // `src/b-second.tsx` declares #ffffff before #6b7280, and nothing contradicts it.
    expect(colorOrder(css)).toEqual(['.c_\\#fff', '.c_\\#6b7280'])
  })

  test('two files that agree keep the order they agree on', () => {
    const left = `
      import { css } from 'styled-system/css'
      export const a = css({ color: "#ffffff" })
      export const b = css({ color: "#111827" })
    `
    const right = `
      import { css } from 'styled-system/css'
      export const b = css({ color: "#111827" })
      export const c = css({ color: "#2563eb" })
    `
    const css = sheetFor({ 'src/a-left.tsx': left, 'src/b-right.tsx': right })

    expect(colorOrder(css)).toEqual(['.c_\\#fff', '.c_\\#111827', '.c_\\#2563eb'])
  })

  test('an override is not killed by an unrelated file mentioning its colour first', () => {
    // The shape that makes this worth fixing rather than merely tidy: the element carries
    // both classes, they share a sublayer, and so the later rule is the one that renders. An
    // unrelated file naming the override's value first used to push the base *after* it,
    // which silently disables the override everywhere it is used.
    const other = `
      import { css } from 'styled-system/css'
      export const x = css({ color: "#6b7280" })
    `
    const component = `
      import { css, cx } from 'styled-system/css'
      const base = css({ color: "#0a0a0a" })
      const override = css({ color: "#6b7280" })
      export const C = (p) => cx(base, p.muted && override)
    `
    const css = sheetFor({ 'src/a-other.tsx': other, 'src/b-component.tsx': component })

    expect(css.indexOf('#0a0a0a')).toBeLessThan(css.indexOf('#6b7280'))
  })

  test('files demanding opposite orders still emit one deterministic sheet', () => {
    // No arrangement satisfies both, since there is one rule per atom. What must not happen
    // is a different answer from one build to the next.
    const forward = `
      import { css } from 'styled-system/css'
      export const a = css({ color: "#ffffff" })
      export const b = css({ color: "#6b7280" })
    `
    const backward = `
      import { css } from 'styled-system/css'
      export const b = css({ color: "#6b7280" })
      export const a = css({ color: "#ffffff" })
    `
    const once = sheetFor({ 'src/a-forward.tsx': forward, 'src/b-backward.tsx': backward })
    const twice = sheetFor({ 'src/a-forward.tsx': forward, 'src/b-backward.tsx': backward })

    expect(once).toBe(twice)
    expect(colorOrder(once)).toHaveLength(2)
  })
})

/**
 * What laying the order out costs, counted rather than timed.
 *
 * The constraint sort covers the whole collection. It used to run on every file's contribution,
 * so an extraction pass paid for it once per file and the cost grew with the square of the
 * project: a 4,665-file app spent 94 s of a 108 s `cssgen` in it. It now runs when the order is
 * read, which a pass does once.
 */
describe('declaration order is laid out once per read, not once per file', () => {
  const files = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `src/file-${index}.tsx`,
      `import { css } from 'styled-system/css'\nexport const a = css({ color: "#${String(index).padStart(6, '0')}", padding: "${index % 7}px" })\nexport const b = css({ color: "#ffffff" })\n`,
    ]),
  )

  test('an extraction pass sorts at most once before the sheet is read', () => {
    const ctx = createContext() as any
    const paths = Object.keys(files).map((file) => ctx.runtime.path.abs(ctx.config.cwd, file))
    Object.values(files).forEach((source, index) => ctx.project.addSourceFile(paths[index], source))
    ctx.getFiles = () => paths
    ctx.parseFiles()

    const before = ctx.encoder.atomic.orderRebuilds
    expect(before).toBeLessThanOrEqual(1)
    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    ctx.getCss(sheet)
    expect(ctx.encoder.atomic.orderRebuilds - before).toBeLessThanOrEqual(1)
  })

  /**
   * The layout is a function of the files, not of the order they were read in. Folding every
   * change into the previous sort made a tie a cycle forced depend on history, so a watch
   * rebuild could emit a different sheet from a cold build of the same source.
   */
  test('re-reading a file lays out the same sheet as a cold build', () => {
    const conflicting = {
      ...files,
      'src/z-reverse.tsx': `import { css } from 'styled-system/css'\nexport const b = css({ color: "#ffffff" })\nexport const a = css({ color: "#000003" })\n`,
    }
    const cold = sheetFor(conflicting)

    const ctx = createContext() as any
    const paths = Object.keys(conflicting).map((file) => ctx.runtime.path.abs(ctx.config.cwd, file))
    Object.values(conflicting).forEach((source, index) => ctx.project.addSourceFile(paths[index], source))
    ctx.getFiles = () => paths
    ctx.parseFiles()
    // A watch rebuild: one file read again, the rest left as they were.
    ctx.parseFile(paths[3])
    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)

    expect(ctx.getCss(sheet)).toBe(cold)
  })
})
