import { describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

/**
 * Values the build knows, which it used to fail the compile on as `dynamic`.
 *
 * Two shapes are everywhere in helper code. A default for an option the caller did not pass —
 * `o.display ?? 'block'` — reads a property that is not there, and `undefined` is as decided as
 * any value: falsy and nullish. And a property of a theme object is known whatever the object's
 * other properties are: `theme.radius` beside `shadow: computeShadow()`. Both failed the build
 * with nothing to say why.
 */
const withImport = (body: string) => `import { css } from 'styled-system/css'\n${body}\n`

const foldOf = (code: string, files?: Record<string, string>) => {
  const fixture = createFoldFixture()
  if (files) fixture.addFiles(files)
  const result = fixture.fold(code)
  return {
    classes: result.folded.map((entry) => entry.className),
    skipped: result.skipped.map((entry) => entry.reason),
    css: fixture.getCss(),
  }
}

describe('a default for a value that is not there', () => {
  test.each([
    [
      '`??` on an option not passed',
      `const box = (o = {}) => ({ display: o.display ?? 'block' })\nexport const A = css(box())`,
    ],
    [
      '`||` on an option not passed',
      `const box = (o = {}) => ({ display: o.display || 'block' })\nexport const A = css(box())`,
    ],
    [
      '`??` on an argument not passed',
      `const box = (display) => ({ display: display ?? 'block' })\nexport const A = css(box())`,
    ],
    ['`??` on a property not there', `const opts = {}\nexport const A = css({ display: opts.display ?? 'block' })`],
    ['`??` on `undefined` itself', `export const A = css({ display: undefined ?? 'block' })`],
    [
      '`&&` short-circuiting on `undefined`',
      `const box = (o = {}) => ({ display: (o.hidden && 'none') ?? 'block' })\nexport const A = css(box())`,
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: ['d_block'], skipped: [] })
  })

  test('a choice on an option not passed takes the other arm', () => {
    const body = `const box = (o = {}) => ({ padding: o.dense ? '2' : '4' })\nexport const A = css(box())`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['p_4'], skipped: [] })
  })

  test('an `if` on an option not passed takes the other branch', () => {
    const body =
      `const box = (o = {}) => {\n  if (o.dense) return { padding: '2' }\n  return { padding: '4' }\n}\n` +
      `export const A = css(box())`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['p_4'], skipped: [] })
  })

  test('an option passed still wins', () => {
    const body = `const box = (o = {}) => ({ display: o.display ?? 'block' })\nexport const A = css(box({ display: 'flex' }))`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['d_flex'], skipped: [] })
  })
})

describe('one property of an object, whatever its siblings are', () => {
  test('beside a property the build cannot evaluate', () => {
    const body = `const theme = { px: compute(), w: '10' }\nexport const A = css({ width: theme.w })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('beside a property chosen at runtime, without that property’s rules', () => {
    const body =
      `const cond = Math.random() > 0.5\nconst theme = { px: cond ? '2' : '4', w: '10' }\n` +
      `export const A = css({ width: theme.w })`
    const { classes, skipped, css } = foldOf(withImport(body))

    expect({ classes, skipped }).toEqual({ classes: ['w_10'], skipped: [] })
    expect(css).not.toContain('.px_')
  })

  test('nested', () => {
    const body = `const theme = { sizes: { w: '10', h: compute() } }\nexport const A = css({ width: theme.sizes.w })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('read by a helper', () => {
    const body = `const theme = { px: compute(), w: '10' }\nconst size = () => ({ width: theme.w })\nexport const A = css(size())`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('imported from another module', () => {
    const files = { 'app/src/theme.ts': `export const theme = { px: compute(), sizes: { w: '10', h: compute() } }\n` }
    const code = withImport(`import { theme } from './theme'\nexport const A = css({ width: theme.sizes.w })`)

    expect(foldOf(code, files)).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test.each([
    [
      'destructured',
      `const theme = { px: compute(), w: '10' }\nconst { w } = theme\nexport const A = css({ width: w })`,
    ],
    [
      'destructured, nested and renamed',
      `const theme = { px: compute(), sizes: { w: '10' } }\nconst { sizes: { w: width } } = theme\nexport const A = css({ width })`,
    ],
    [
      'read with a literal key',
      `const theme = { px: compute(), w: '10' }\nexport const A = css({ width: theme['w'] })`,
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('destructured from an import', () => {
    const files = { 'app/src/theme.ts': `export const theme = { px: compute(), w: '10' }\n` }
    const code = withImport(`import { theme } from './theme'\nconst { w } = theme\nexport const A = css({ width: w })`)

    expect(foldOf(code, files)).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('after a spread the build cannot evaluate, which it overrides', () => {
    const body = `const theme = { ...other(), w: '10' }\nexport const A = css({ width: theme.w })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })
})

describe('what is still not known', () => {
  test.each([
    [
      'the property the build cannot evaluate',
      `const theme = { px: compute(), w: '10' }\nexport const A = css({ padding: theme.px })`,
    ],
    [
      'a property chosen at runtime',
      `const cond = Math.random() > 0.5\nconst theme = { px: cond ? '2' : '4' }\nexport const A = css({ padding: theme.px })`,
    ],
    [
      'a property a later spread may replace',
      `const theme = { w: '10', ...other() }\nexport const A = css({ width: theme.w })`,
    ],
    [
      'a property a later computed key may replace',
      `const theme = { w: '10', [key()]: '12' }\nexport const A = css({ width: theme.w })`,
    ],
    [
      'a property a spread may define',
      `const theme = { ...other() }\nexport const A = css({ width: theme.w ?? '10' })`,
    ],
    [
      'a property read through an accessor',
      `const theme = { get w() { return '10' } }\nexport const A = css({ width: theme.w })`,
    ],
    [
      'a property written later',
      `const theme = { w: '10', px: compute() }\ntheme.w = '12'\nexport const A = css({ width: theme.w })`,
    ],
    ['an option a caller passes at runtime', `export const f = (o) => css({ display: o.display ?? 'block' })`],
    [
      'a destructured property with a default standing in for it',
      `const theme = { px: compute() }\nconst { w = '10' } = theme\nexport const A = css({ width: w })`,
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })
})
