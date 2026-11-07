import { withoutMergeCodes } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

/**
 * Why the compiler refused a call.
 *
 * The evaluator does not run what it would have to guess at — a statement in a helper's body,
 * a binding written after its declaration — and the strict compiler then reports the call as
 * `dynamic`. Where the call is says nothing about why: the statement is in the helper, which
 * may be in another file, and the write may be anywhere in the module. Each refusal carries
 * what it was and where it is.
 */
const withImport = (body: string) => `import { css } from 'styled-system/css'\n${body}\n`

const refusalOf = (code: string, filePath?: string, files?: Record<string, string>) => {
  const fixture = createFoldFixture()
  if (files) fixture.addFiles(files)
  const result = fixture.fold(code, filePath)

  expect(result.folded).toHaveLength(0)
  expect(result.skipped.map((entry) => entry.reason)).toEqual(['dynamic'])
  return result.skipped[0]!.refusal
}

describe('a refused call says why', () => {
  test("a statement in a helper's body, with the helper and where it is", () => {
    const refusal = refusalOf(
      withImport(
        `const tone = (t) => {\n  switch (t) { case 'a': return { color: 'red.300' } }\n  return {}\n}\nexport const A = css(tone('a'))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'statement', subject: 'switch', helper: 'tone', line: 3, column: 3 })
    expect(refusal?.filePath).toMatch(/app[\\/]src[\\/]test\.tsx$/)
  })

  test('a statement run for its effect, shown as written', () => {
    const refusal = refusalOf(
      withImport(
        `const make = (primary) => {\n  const styles = { paddingX: '4' }\n  if (primary) styles.color = 'red.300'\n  return styles\n}\nexport const A = css(make(true))`,
      ),
    )

    expect(refusal).toMatchObject({
      kind: 'statement',
      subject: 'expression',
      helper: 'make',
      excerpt: "styles.color = 'red.300'",
      line: 4,
    })
  })

  test('a `throw` the call reaches', () => {
    const refusal = refusalOf(
      withImport(
        `const tone = (t) => {\n  if (!t) throw new Error('tone')\n  return { color: t }\n}\nexport const A = css(tone(''))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'statement', subject: 'throw', helper: 'tone', line: 3 })
  })

  test('a binding written into after its declaration, with the write', () => {
    const refusal = refusalOf(
      withImport(`const base = { color: 'red.300' }\nbase.color = 'blue.300'\nexport const A = css(base)`),
    )

    expect(refusal).toMatchObject({
      kind: 'write',
      subject: 'base',
      excerpt: "base.color = 'blue.300'",
      line: 3,
      column: 1,
    })
  })

  test('a reassigned binding', () => {
    const refusal = refusalOf(
      withImport(`let tone = 'red.300'\ntone = 'blue.300'\nexport const A = css({ color: tone })`),
    )

    expect(refusal).toMatchObject({ kind: 'write', subject: 'tone', excerpt: "tone = 'blue.300'", line: 3 })
  })

  // Declared again with a value, a module's `var` is assigned there; it was read as declared first.
  test.each([
    ['read', `var tone = 'red.300'\nvar tone = 'blue.300'\nexport const A = css({ color: tone })`],
    ['called', `var tone = () => 'red.300'\nvar tone = () => 'blue.300'\nexport const A = css({ color: tone() })`],
  ])('a `var` declared again with a value, %s', (_, body) => {
    expect(refusalOf(withImport(body))).toMatchObject({ kind: 'write', subject: 'tone', line: 3 })
  })

  // Read from its declaration, as nothing ran the body: a component's, or one a loop's head assigns.
  test.each([
    [
      "a component's `var` declared again with a value",
      `export function Button() {\n  var tone = 'red.300'\n  var tone = 'blue.300'\n  return css({ color: tone })\n}`,
    ],
    [
      'a `var` a `for…of` head declares again',
      `var tone = 'red.300'\nfor (var tone of ['blue.300']) {}\nexport const A = css({ color: tone })`,
    ],
    [
      'a `var` only a `for…of` head declares',
      `for (var tone of ['blue.300']) {}\nexport const A = css({ color: tone })`,
    ],
  ])('%s', (_, body) => {
    expect(refusalOf(withImport(body))).toMatchObject({ kind: 'write', subject: 'tone' })
  })

  // Another module's `var` or `let`, written after its declaration, called by its export's name.
  test.each([
    ['declared again', `export var tone = (t) => ({ color: t })\nvar tone = (t) => ({ color: 'blue.300' })\n`],
    ['assigned', `export let tone = (t) => ({ color: t })\ntone = (t) => ({ color: 'blue.300' })\n`],
  ])('an exported helper %s, called from another module', (_, helper) => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { tone } from '../h'\nexport const A = css(tone('red.300'))\n`,
      undefined,
      { 'app/h.ts': helper },
    )

    expect(refusal).toMatchObject({ kind: 'write', subject: 'tone' })
  })

  // A function declaration exported is called through its symbol, as within its module: the
  // function a write after it puts there is the one called, and 1.57.1 called the declared one.
  test.each([
    [
      'from its own module',
      { 'app/h.js': `export function tone(t) {\n  return { color: t }\n}\ntone = (t) => ({ color: 'blue.300' })\n` },
      './h.js',
    ],
    [
      'through an `export *`',
      {
        'app/h.js': `export function tone(t) {\n  return { color: t }\n}\ntone = (t) => ({ color: 'blue.300' })\n`,
        'app/index.js': `export * from './h.js'\n`,
      },
      './index.js',
    ],
  ])('an exported function declaration assigned, called %s', (_, files, specifier) => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { tone } from '${specifier}'\nexport const A = css(tone('red.300'))\n`,
      'app/use.tsx',
      files,
    )

    expect(refusal).toMatchObject({ kind: 'write', subject: 'tone' })
  })

  // It runs only where the block does.
  test('a `var` declared in a block, read outside it', () => {
    const result = createFoldFixture().fold(
      withImport(`if (globalThis.flag) {\n  var tone = 'red.300'\n}\nexport const A = css({ color: tone })`),
    )

    expect(result.folded).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['dynamic'])
  })

  // Read in its block, after it, it has run: 1.57.1 took every read of one for unknown, so a
  // component returning `css({ color: tone })` from the `if` declaring `tone` failed the build.
  // So has one a block standing as a statement of its own declares, or a `for` head, read after.
  test.each([
    [
      'a `switch` case',
      `export function Badge({ kind }) {\n  switch (kind) {\n    case 'warn':\n      var tone = 'red.300'\n      return css({ color: tone })\n    default:\n      return null\n  }\n}`,
    ],
    [
      'a callback in the `if`',
      `export function L({ items }) {\n  if (items) {\n    var tone = 'red.300'\n    return items.map(() => css({ color: tone }))\n  }\n}`,
    ],
    [
      'a `catch`',
      `export function C() {\n  try {\n    throw 0\n  } catch (e) {\n    var tone = 'red.300'\n    return css({ color: tone })\n  }\n}`,
    ],
    ['a class `static` block', `class K { static { var tone = 'red.300'; K.A = css({ color: tone }) } }`],
    ['a block of its own, read after it', `{\n  var tone = 'red.300'\n}\nexport const A = css({ color: tone })`],
    [
      'a `for` head, read after the loop',
      `for (var tone = 'red.300'; false; ) {}\nexport const A = css({ color: tone })`,
    ],
  ])('a `var` declared in %s, read where it has run, compiles', (_, body) => {
    const result = createFoldFixture().fold(withImport(body))

    expect(withoutMergeCodes(result.folded.map((entry) => entry.className))).toEqual(['c_red.300'])
  })

  // Called where the block may not have run, it may hold no function: called anyway, `extra?.()`
  // compiled `fw_bold` past an `if` that did not run, and a key read from one named a method.
  test.each([
    ['called', `if (globalThis.flag) {\n  var pick = () => ({ color: 'red.300' })\n}\nexport const A = css(pick())`],
    [
      'walked for a method',
      `if (globalThis.flag) {\n  var helpers = { pick: () => ({ color: 'red.300' }) }\n}\nexport const A = css(helpers.pick())`,
    ],
    [
      'called in a helper whose `if` did not run',
      `const make = (primary) => {\n  if (primary) {\n    var extra = () => ({ fontWeight: 'bold' })\n  }\n  return { color: 'blue.300', ...extra?.() }\n}\nexport const A = css(make(false))`,
    ],
    [
      'read for a key',
      `if (globalThis.flag) {\n  var KEY = 'pick'\n}\nconst helpers = { undefined: () => ({ color: 'blue.300' }), [KEY]: () => ({ color: 'red.300' }) }\nexport const A = css(helpers.undefined())`,
    ],
  ])('a `var` declared in a block, %s outside it, is not called', (_, body) => {
    const result = createFoldFixture().fold(withImport(body))

    expect(result.folded).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['dynamic'])
  })

  // In a helper the build runs, the block ran when its declaration bound it.
  test('a `var` a helper declares in an `if` that ran is called after it', () => {
    const result = createFoldFixture().fold(
      withImport(
        `const make = (primary) => {\n  if (primary) {\n    var extra = () => ({ fontWeight: 'bold' })\n  }\n  return { color: 'blue.300', ...extra?.() }\n}\nexport const A = css(make(true))`,
      ),
    )

    expect(withoutMergeCodes(result.folded.map((entry) => entry.className))).toEqual(['c_blue.300 fw_bold'])
  })

  test('an array written into, then joined', () => {
    const refusal = refusalOf(
      withImport(`const parts = ['red', '300']\nparts.push('x')\nexport const A = css({ color: parts.join('.') })`),
    )

    expect(refusal).toMatchObject({ kind: 'write', subject: 'parts', excerpt: "parts.push('x')", line: 3, column: 1 })
  })

  test("a written binding a helper's `if` tests", () => {
    const refusal = refusalOf(
      withImport(
        `let primary = true\nprimary = false\nconst tone = () => {\n  if (primary) return { color: 'red.300' }\n  return {}\n}\nexport const A = css(tone())`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'write', subject: 'primary', excerpt: 'primary = false', line: 3 })
  })

  test("an `enum` in a helper's body", () => {
    const refusal = refusalOf(
      withImport(
        `const tone = () => {\n  enum Tone { Red = 'red.300' }\n  return { color: Tone.Red }\n}\nexport const A = css(tone())`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'statement', subject: 'enum', helper: 'tone', line: 3 })
  })

  test('a reassigned helper', () => {
    const refusal = refusalOf(
      withImport(
        `let make = () => ({ color: 'red.300' })\nmake = () => ({ color: 'blue.300' })\nexport const A = css(make())`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'write', subject: 'make', line: 3 })
  })

  test('a helper in another module names that module', () => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { tone } from './theme'\nexport const A = css(tone('red.300'))\n`,
      'app/use.tsx',
      {
        'app/theme.ts': `export const tone = (t) => {\n  for (const key of ['color']) {}\n  return { color: t }\n}\n`,
      },
    )

    expect(refusal).toMatchObject({ kind: 'statement', subject: 'for…of', helper: 'tone', line: 2 })
    expect(refusal?.filePath).toMatch(/app\/theme\.ts$/)
  })

  test('a call that is dynamic for any other reason carries none', () => {
    const result = createFoldFixture().fold(withImport(`export const f = (t) => css({ color: t })`))

    expect(result.skipped.map((entry) => entry.reason)).toEqual(['dynamic'])
    expect(result.skipped[0]!.refusal).toBeUndefined()
  })
})

/**
 * A recursion the evaluator cannot see the end of.
 *
 * On a value the build cannot read — `nest(props.depth)` — a recursive helper never reaches its
 * base case. Following it overflowed the native stack: the process died, dev server and all, with
 * no message. It is refused now, like any other code the evaluator will not run.
 */
describe('a recursion with no end the build can see', () => {
  test('on a value the build cannot read, at once, naming the helper', () => {
    // `d - 1` is as unknown as `d`, so the next call is the one already running over again.
    const refusal = refusalOf(
      withImport(
        `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1), color: 'red.300' } : {})\n` +
          `export const f = (props) => css(nest(props.depth))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'nest', line: 2, column: 14 })
  })

  // Read while a refused recursion unwinds — a property after the one refused — an export walked
  // for a method was cached as unknown, and failed every module reading it from then on, in this
  // process, until its own module changed.
  test('an export read while a refused recursion unwinds is read again for another module', () => {
    const tokens = {
      'app/unwind/tokens.ts':
        "const palette = { primary: () => 'red.300' }\nexport const primary = palette.primary()\n",
    }
    const first = createFoldFixture()
    first.addFiles(tokens)
    const refused = first.fold(
      `import { css } from 'styled-system/css'\nimport { primary } from './tokens'\nconst card = (n) => ({ zIndex: n < 100 ? card(n + 1).zIndex : n, color: primary })\nexport const A = css(card(0))\n`,
      'app/unwind/card.tsx',
    )
    const second = createFoldFixture()
    second.addFiles(tokens)
    const result = second.fold(
      `import { css } from 'styled-system/css'\nimport { primary } from './tokens'\nexport const B = css({ color: primary })\n`,
      'app/unwind/button.tsx',
    )

    expect(refused.folded).toEqual([])
    expect(withoutMergeCodes(result.folded.map((entry) => entry.className))).toEqual(['c_red.300'])
  })

  test('branching, as surely', () => {
    const refusal = refusalOf(
      withImport(
        `const tree = (d) => (d > 0 ? { '& > a': tree(d - 1), '& > b': tree(d - 1) } : {})\n` +
          `export const f = (props) => css(tree(props.depth))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'tree' })
  })

  test('on arguments that never change, known or not', () => {
    const refusal = refusalOf(withImport(`const again = (d) => ({ color: again(d) })\nexport const A = css(again(1))`))

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'again' })
  })

  test('through a second helper', () => {
    const refusal = refusalOf(
      withImport(
        `const a = (d) => ({ '& > div': b(d - 1) })\nconst b = (d) => a(d)\n` +
          `export const f = (props) => css(a(props.depth))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'a' })
  })

  test('through another module', () => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { nest } from './nest'\nexport const f = (props) => css(nest(props.depth))\n`,
      'app/use.tsx',
      { 'app/nest.ts': `export const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : { color: 'red.300' })\n` },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'nest' })
    expect(refusal?.filePath).toMatch(/app\/nest\.ts$/)
  })

  test('between modules, at the helper called again', () => {
    // Each call into another module parses it afresh, so the call running is not one to compare
    // against: the second call into `a` is refused, whatever its arguments.
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { a } from './a'\nexport const f = (props) => css(a(props.depth))\n`,
      'app/use.tsx',
      {
        'app/a.ts': `import { b } from './b'\nexport const a = (d) => ({ '& > div': b(d - 1) })\n`,
        'app/b.ts': `import { a } from './a'\nexport const b = (d) => a(d)\n`,
      },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'module', helper: 'a', line: 2, column: 18 })
    expect(refusal?.filePath).toMatch(/app\/a\.ts$/)
  })

  test('between modules, at the function however its export is written', () => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { a } from './a'\nexport const f = (props) => css(a(props.depth))\n`,
      'app/use.tsx',
      {
        'app/a.ts': `import { b } from './b'\nconst a = (d) => ({ '& > div': b(d - 1) })\nexport { a }\n`,
        'app/b.ts': `import { a } from './a'\nexport const b = (d) => a(d)\n`,
      },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'module', helper: 'a', line: 2, column: 11 })
  })

  // `walk(2)` ends; `nest`, which it calls at the bottom, calls itself on what it was given.
  test('named for the helper that repeats, not one that recursed to reach it', () => {
    const refusal = refusalOf(
      withImport(
        `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : {})\n` +
          `const walk = (n, p) => (n > 0 ? { '& > a': walk(n - 1, p) } : nest(p))\n` +
          `export const f = (props) => css(walk(2, props.depth))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'nest', line: 2, column: 14 })
  })

  // Two helpers calling each other on what they were given are one recursion, named for the first
  // of them it runs: either may be the one found repeating.
  test('named for the first helper of a cycle a terminating one reaches', () => {
    const refusal = refusalOf(
      withImport(
        `const a = (d) => ({ '& > div': b(d) })\nconst b = (d) => a(d)\n` +
          `const walk = (n, p) => (n > 0 ? { '& > a': walk(n - 1, p) } : a(p))\n` +
          `export const f = (props) => css(walk(2, props.depth))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'a', line: 2, column: 11 })
  })

  // `walk(2)` and `walk(1)` differ; `nest(1)` repeats, and it is what is named, not `walk`, which the
  // cycle ran through on its way there.
  test('named for the helper repeating, not one a recursion that ends ran through', () => {
    const refusal = refusalOf(
      withImport(
        `const walk = (n, p) => (n > 0 ? { color: 'blue.300', '& > a': nest(n, p) } : {})\n` +
          `const nest = (m, p) => (m > 1 ? { '& > b': walk(m - 1, p) } : { '& > div': nest(m, p) })\n` +
          `export const f = (props) => css(walk(2, props.depth))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'nest', line: 3, column: 14 })
  })

  // A default calling the helper runs as the call binds what it was given; it is compared with
  // the calls running as they were given theirs.
  test('through a default calling the helper on what it was given', () => {
    const refusal = refusalOf(
      withImport(
        `function f(a, b = f(a - 1, 0)) {\n  return b === 0 ? { '& > div': f(a + 1) } : b\n}\nexport const A = css(f(1, 0))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'f' })
  })

  test.each([
    ['in a pattern', '{ b = f(a - 1, { b: 0 }) } = {}', '{ b: 0 }'],
    ['in a rest', '...[b = f(a - 1, 0)]', '0'],
  ])('through a default %s calling the helper on what it was given', (_, parameter, given) => {
    const refusal = refusalOf(
      withImport(
        `function f(a, ${parameter}) {\n  return b === 0 ? { '& > div': f(a + 1) } : b\n}\nexport const A = css(f(1, ${given}))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'loop', helper: 'f' })
  })

  // A small helper called at each level, or a closure written there, is called no more often than
  // once a level; the recursion is the one most calls are of.
  test.each([
    [
      'a small helper called at each level',
      `const space = (n) => (n > 1 ? space(n - 1) + 4 : 4)\nconst nest = (d) => (d > 0 ? { padding: space(2), '& > div': nest(d - 1) } : {})\nexport const A = css(nest(70))`,
      'nest',
    ],
    [
      'a closure written at each level',
      `const f = (n) => {\n  const g = () => ({ '& > div': f(n + 1) })\n  return g()\n}\nexport const A = css(f(0))`,
      'f',
    ],
  ])('past the depth, named beside %s', (_, body, helper) => {
    expect(refusalOf(withImport(body))).toMatchObject({ kind: 'recursion', subject: 'depth', helper })
  })

  // Helpers are imported through a barrel more often than not; through one, the call that came
  // back gave `dynamic` with no reason.
  test.each([
    [
      'a barrel re-exporting each by name',
      { 'app/index.ts': `export { a } from './a'\nexport { b } from './b'\n` },
      'module',
      'a',
    ],
    ['a star barrel', { 'app/index.ts': `export * from './a'\nexport * from './b'\n` }, 'module', 'a'],
    [
      'a barrel importing each and exporting it again',
      { 'app/index.ts': `import { a } from './a'\nimport { b } from './b'\nexport { a, b }\n` },
      'module',
      'a',
    ],
  ])('between modules, through %s', (_, barrel, subject, helper) => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { a } from './index'\nexport const f = (props) => css(a(props.depth))\n`,
      'app/use.tsx',
      {
        ...barrel,
        'app/a.ts': `import { b } from './index'\nexport const a = (d) => ({ '& > div': b(d - 1) })\n`,
        'app/b.ts': `import { a } from './index'\nexport const b = (d) => a(d)\n`,
      },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject, helper })
    expect(refusal?.filePath).toMatch(/app\/a\.ts$/)
  })

  // A star barrel kept a member's answer only when it was a value: a refusal was dropped, and
  // the next member asked, which had none to give.
  test.each([
    ['a recursion', `export const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : {})\n`, 'loop'],
    ['a statement', `export const nest = (d) => { switch (d) { case 1: return {} }\n  return {} }\n`, 'switch'],
  ])('through a star barrel, %s', (_, nest, subject) => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { nest } from './index'\nexport const f = (props) => css(nest(props.depth))\n`,
      'app/use.tsx',
      { 'app/index.ts': `export * from './other'\nexport * from './nest'\n`, 'app/other.ts': '', 'app/nest.ts': nest },
    )

    expect(refusal).toMatchObject({ subject, helper: 'nest' })
  })

  test('a value through a star barrel, refused for a statement', () => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { theme } from './index'\nexport const A = css(theme)\n`,
      'app/use.tsx',
      {
        'app/index.ts': `export * from './theme'\n`,
        'app/theme.ts': `const make = (t) => { switch (t) { case 1: return { color: 'red.300' } }\n  return {} }\nexport const theme = make(1)\n`,
      },
    )

    expect(refusal).toMatchObject({ kind: 'statement', subject: 'switch', helper: 'make' })
  })

  // Called by its export's name elsewhere, it is named where it is declared.
  test('between modules, named as declared', () => {
    const refusal = refusalOf(
      `import { css } from 'styled-system/css'\nimport { styled } from './a'\nexport const f = (props) => css(styled(props.depth))\n`,
      'app/use.tsx',
      {
        'app/a.ts': `import { b } from './b'\nconst a = (d) => ({ '& > div': b(d - 1) })\nexport { a as styled }\n`,
        'app/b.ts': `import { styled } from './a'\nexport const b = (d) => styled(d)\n`,
      },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'module', helper: 'a', line: 2, column: 11 })
  })

  test('on arguments that change without ending, cut off at the depth', () => {
    const refusal = refusalOf(
      withImport(`const deeper = (d) => ({ '& > div': deeper(d + 1) })\nexport const A = css(deeper(0))`),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'deeper' })
  })

  test('one that would end, deeper than the depth, as surely', () => {
    const refusal = refusalOf(
      withImport(
        `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : { color: 'red.300' })\nexport const A = css(nest(70))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'nest' })
  })

  test('named for the recursion, not the helper it reached at the depth', () => {
    // The call past the depth is `leaf`, which recurses into nothing.
    const refusal = refusalOf(
      withImport(
        `const leaf = () => ({ color: 'red.300' })\n` +
          `const walk = (n) => (n > 0 ? { '& > div': walk(n - 1), color: 'blue.500' } : leaf())\n` +
          `export const A = css(walk(63))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'walk', line: 3, column: 14 })
  })

  test('named for the recursion when the helper it reached is in another module', () => {
    // `leaf`'s module has none of `walk`'s calls to name it by; `walk`'s, returned to, does.
    const refusal = refusalOf(
      withImport(
        `import { leaf } from '../leaf'\n` +
          `const walk = (n) => (n > 0 ? { '& > div': walk(n - 1) } : leaf())\n` +
          `export const A = css(walk(63))`,
      ),
      undefined,
      { 'app/leaf.ts': `export const leaf = () => ({ color: 'red.300' })\n` },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'walk', line: 3, column: 14 })
    expect(refusal?.filePath).toMatch(/app[\\/]src[\\/]test\.tsx$/)
  })

  test('leaves no export it gave up on in the cache', () => {
    // After the refusal, `theme` is read while the abandoned call unwinds, and `makeTheme()` is
    // refused with it. Asked for again elsewhere, `theme` is evaluated afresh.
    const fixture = createFoldFixture()
    fixture.addFiles({
      'app/theme.ts': `const makeTheme = () => ({ tone: 'red.300' })\nexport const theme = makeTheme()\n`,
    })
    const walked = fixture.fold(
      `import { css } from 'styled-system/css'\nimport { theme } from '../theme'\n` +
        `const walk = (n) => (n > 0 ? { '& > div': walk(n - 1), color: theme.tone } : {})\n` +
        `export const A = css(walk(70))\n`,
      'app/src/walk.tsx',
    )
    const plain = fixture.fold(
      `import { css } from 'styled-system/css'\nimport { theme } from '../theme'\nexport const B = css({ color: theme.tone })\n`,
      'app/src/plain.tsx',
    )

    expect(walked.skipped[0]?.refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'walk' })
    expect(plain.skipped).toEqual([])
    expect(plain.folded).toHaveLength(1)
  })

  test('through a function written in place, named for the helper it is written in', () => {
    const refusal = refusalOf(
      withImport(`const outer = (n) => (() => ({ '& > div': outer(n + 1) }))()\nexport const A = css(outer(0))`),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'outer', line: 2, column: 15 })
  })

  test('branching on arguments that change, cut off at the depth without following every branch there', () => {
    // Every call has a key of its own, so none repeats; the first branch reaches the depth and
    // nothing more is followed. Down every branch, this was 2^64 calls.
    const refusal = refusalOf(
      withImport(
        `const tree = (d, p) => (d > 0 ? { [p + 'a']: tree(d - 1, p + 'a'), [p + 'b']: tree(d - 1, p + 'b') } : {})\n` +
          `export const f = (props) => css(tree(props.depth, '&'))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'tree' })
  })

  /**
   * Exported values are cached across calls, so where one was first asked for must not decide
   * what it is. Asked for 30 calls deep, `deep` has 34 levels left for its 40 and is refused;
   * asked for directly, it has all of them — and the same holds whichever comes first.
   */
  describe('cut off by where it was asked for, whatever was asked first', () => {
    const source = `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : { color: 'red.300' })\nexport const deep = nest(40)\n`
    const walk = (fixture: ReturnType<typeof createFoldFixture>) =>
      fixture.fold(
        `import { css } from 'styled-system/css'\nimport { deep } from '../deep'\n` +
          `const walk = (n) => (n > 0 ? walk(n - 1) : deep)\nexport const A = css(walk(30))\n`,
        'app/src/walk.tsx',
      )
    const direct = (fixture: ReturnType<typeof createFoldFixture>) =>
      fixture.fold(
        `import { css } from 'styled-system/css'\nimport { deep } from '../deep'\nexport const B = css(deep)\n`,
        'app/src/direct.tsx',
      )

    test.each([
      ['the deep one first', true],
      ['the direct one first', false],
    ])('%s', (_, deepFirst) => {
      const fixture = createFoldFixture()
      // A byte apart, so neither order finds what the other left in the cache.
      fixture.addFiles({ 'app/deep.ts': `${source}// ${deepFirst}\n` })
      const first = deepFirst ? walk(fixture) : undefined
      const plain = direct(fixture)
      const walked = first ?? walk(fixture)

      expect(walked.skipped[0]?.refusal).toMatchObject({ kind: 'recursion', subject: 'depth', helper: 'nest' })
      expect(plain.skipped).toEqual([])
      expect(plain.folded).toHaveLength(1)
    })
  })

  // `space` is called once a node and recurses as deep as `tree` at times, which makes the calls.
  test.each([
    ['before', (kids: string) => `{ gap: space(2), ${kids} }`],
    ['after', (kids: string) => `{ ${kids}, gap: space(2) }`],
    // `space(5)` makes more calls in all than `tree`, one a call; `tree` three and one.
    ['after, deeper', (kids: string) => `{ ${kids}, gap: space(5) }`],
    // `leaf` makes five a call, but does not recur.
    ['after, beside one calling another five times', (kids: string) => `{ ${kids}, s: leaf(d) }`],
  ])('past the calls, named for the branching one beside a small recursion called %s its branches', (_, node) => {
    const kids = Array.from({ length: 3 }, (_, k) => `k${k}: tree(d - 1)`).join(', ')
    const refusal = refusalOf(
      withImport(
        `const space = (n) => (n > 0 ? space(n - 1) + 4 : 0)\nconst unit = () => 1\nconst leaf = (d) => unit() + unit() + unit() + unit() + unit()\nconst tree = (d) => (d > 0 ? ${node(kids)} : {})\nexport const A = css(tree(12))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'calls', helper: 'tree' })
  })

  // A method's walk evaluates the spreads after it, and a spread calling the next object's method
  // walks that one: down a chain of them it took time doubling a level, or overflowed the stack.
  // It is a call as far as the limits go.
  const chain = (length: number, spreads: number) =>
    [
      `const a0 = { c: () => 'red.300', ${Array.from({ length: spreads }, () => '...a1.m()').join(', ')} }`,
      ...Array.from({ length: length - 1 }, (_, index) => {
        const next = index + 2 < length ? Array.from({ length: spreads }, () => `...a${index + 2}.m()`) : []
        return `const a${index + 1} = { m: () => ({}), ${next.join(', ')} }`
      }),
      'export const A = css({ color: a0.c() })',
    ].join('\n')
  test.each([
    ['branching', 22, 2],
    ['deep', 6000, 1],
  ])("down a %s chain of objects whose spreads call the next one's method, within the limits", (_, length, spreads) => {
    const result = createFoldFixture().fold(withImport(chain(length, spreads)))

    expect(result.folded).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['dynamic'])
  })

  // The limit is reached in `leaf`'s module, whose calls show no recursion: `tree`'s names it.
  test('past the calls, named for the branching one beside a helper in another module calling another', () => {
    const kids = Array.from({ length: 2 }, (_, k) => `k${k}: tree(d - 1)`).join(', ')
    const refusal = refusalOf(
      withImport(
        `import { leaf } from '../leaf'\nconst tree = (d) => (d > 0 ? { ${kids}, s: leaf(d) } : {})\nexport const A = css(tree(14))`,
      ),
      undefined,
      {
        'app/leaf.ts': `const unit = () => 1\nexport const leaf = (d) => ${Array.from({ length: 10 }, () => 'unit()').join(' + ')}\n`,
      },
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'calls', helper: 'tree' })
  })

  test('branching within the depth, until the calls run out', () => {
    // A depth the build can read, and an end, but `2^15` calls to get there.
    const refusal = refusalOf(
      withImport(`const fan = (d) => (d > 0 ? fan(d - 1) + fan(d - 1) : 1)\nexport const A = css({ zIndex: fan(14) })`),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'calls', helper: 'fan' })
  })

  // A recursion making that many calls branches, and is shallow: `walk` has seven calls running
  // when `grid` runs out the calls, and `grid` five at most. It is the one making them.
  const grid = `const grid = (d) => (d > 0 ? { ${Array.from({ length: 10 }, (_, k) => `k${k}: grid(d - 1)`).join(', ')} } : LEAF)\n`
  test.each([
    ['', '{}'],
    [', whose every leaf another helper gives', 'cell()'],
  ])('past the calls, named for a branching one a recursion reached%s', (_, leaf) => {
    const refusal = refusalOf(
      withImport(
        `const cell = () => ({ color: 'red.300' })\n` +
          grid.replace('LEAF', leaf) +
          `const walk = (n) => (n > 0 ? { '& > a': walk(n - 1) } : { '& > b': grid(4) })\n` +
          `export const A = css(walk(6))`,
      ),
    )

    expect(refusal).toMatchObject({ kind: 'recursion', subject: 'calls', helper: 'grid', line: 3, column: 14 })
  })

  test.each([
    [
      'nested',
      `const nest = (d) => (d > 0 ? { '& > div': nest(d - 1) } : { color: 'red.300' })\nexport const A = css(nest(3))`,
    ],
    [
      'branching',
      `const fan = (d) => (d > 0 ? { '& > a': fan(d - 1), '& > b': fan(d - 1) } : { color: 'red.300' })\nexport const A = css(fan(3))`,
    ],
    // `g()` has the same arguments at every level, but not the same `n`: not a call over again.
    [
      'through a closure called the same way each time',
      `const f = (n) => {\n  const g = () => (n > 0 ? { '& > div': f(n - 1) } : { color: 'red.300' })\n  return g()\n}\nexport const A = css(f(3))`,
    ],
    // A `var` of a parameter's name binds the parameter again: what a call was given is compared,
    // not what its body made of it.
    [
      'through a parameter a `var` declares again',
      `const f = (d) => { var d = d + 1; return d > 3 ? { color: 'red.300' } : { '& > div': f(d) } }\nexport const A = css(f(0))`,
    ],
    // A default calling the helper runs while the call binds: it is compared with the call running
    // as that was given its arguments, not as this one has bound so far.
    [
      'through a default calling the helper',
      `const scale = (n, base = UNIT) => (n > 1 ? scale(n - 1) * base : base)\nconst UNIT = scale(1, 4)\nexport const A = css({ width: scale(2, 4) })`,
    ],
    [
      'through a default in a pattern calling the helper',
      `const scale = (n, { base = UNIT } = {}) => (n > 1 ? scale(n - 1) * base : base)\nconst UNIT = scale(1, { base: 4 })\nexport const A = css({ width: scale(2, { base: 4 }) })`,
    ],
    [
      'through a default in a rest calling the helper',
      `const scale = (n, ...[base = UNIT]) => (n > 1 ? scale(n - 1) * base : base)\nconst UNIT = scale(1, 4)\nexport const A = css({ width: scale(2, 4) })`,
    ],
  ])('a recursion that ends still compiles: %s', (_, body) => {
    const result = createFoldFixture().fold(withImport(body))

    expect(result.skipped).toEqual([])
    expect(result.folded).toHaveLength(1)
  })
})

// JavaScript takes the name a barrel exports by name over one an `export *` in it would give.
describe('a helper a barrel exports by name', () => {
  test.each([
    [
      'one refused there',
      `export const tone = (t) => {\n  switch (t) {\n    default:\n      return { color: 'blue.300' }\n  }\n}\n`,
    ],
    ['one answering there', `export const tone = (t) => ({ color: 'blue.300' })\n`],
  ])('is called over %s through `export *`', (_, base) => {
    const fixture = createFoldFixture()
    fixture.addFiles({
      'app/index.ts': `export * from './base'\nexport { tone } from './custom'\n`,
      'app/base.ts': base,
      'app/custom.ts': `export const tone = (t) => ({ color: t })\n`,
    })
    const result = fixture.fold(
      `import { css } from 'styled-system/css'\nimport { tone } from './index'\nexport const A = css(tone('red.300'))\n`,
      'app/use.tsx',
    )

    expect(withoutMergeCodes(result.folded.map((entry) => entry.className))).toEqual(['c_red.300'])
  })
})

// `export *` gives what JavaScript's does: never `default`, and `export * as legacy` only `legacy`,
// and a name the barrel declares itself is its own. Each gave another module's helper or value.
describe('what an `export *` gives', () => {
  const foldThrough = (files: Record<string, string>, style: string) => {
    const fixture = createFoldFixture()
    fixture.addFiles(files)
    return fixture.fold(
      `import { css } from 'styled-system/css'\nimport { tone } from './index'\nexport const A = css(${style})\n`,
      'app/use.tsx',
    )
  }
  const helper = (color: string) => `(t) => ({ color: ${color} })`
  const value = (color: string) => `{ color: ${color} }`

  test.each([
    ['a helper', helper(`'blue.300'`), helper('t'), `tone('red.300')`],
    ['a value', value(`'blue.300'`), value(`'red.300'`), 'tone'],
  ])('not %s of a module it exports as a namespace', (_, base, custom, style) => {
    const result = foldThrough(
      {
        'app/index.ts': `export * as legacy from './base'\nexport * from './custom'\n`,
        'app/base.ts': `export const tone = ${base}\n`,
        'app/custom.ts': `export const tone = ${custom}\n`,
      },
      style,
    )

    expect(withoutMergeCodes(result.folded.map((entry) => entry.className))).toEqual(['c_red.300'])
  })

  // `custom`'s own `export default` is not followed; `base`'s is never the answer.
  test.each([
    ['a helper', helper(`'blue.300'`), `function (t) {\n  return { color: t }\n}`, `tone('red.300')`],
    ['a value', value(`'blue.300'`), value(`'red.300'`), 'tone'],
  ])('not as `default`, %s', (_, base, custom, style) => {
    const result = foldThrough(
      {
        'app/index.ts': `export { default as tone } from './custom'\n`,
        'app/custom.ts': `export default ${custom}\nexport * from './base'\n`,
        'app/base.ts': `const b = ${base}\nexport { b as default }\n`,
      },
      style,
    )

    expect(result.folded).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['dynamic'])
  })

  // An `export * as` is a name of the barrel's, wherever it is written: not the star member's.
  test.each([
    ['a value', `export const colors = { primary: 'red.300' }\n`, '{ color: colors.primary }'],
    ['a helper', `export const colors = () => ({ color: 'red.300' })\n`, 'colors()'],
  ])('not %s of a star before the namespace of its name', (_, legacy, style) => {
    const fixture = createFoldFixture()
    fixture.addFiles({
      'app/index.ts': `export * from './legacy'\nexport * as colors from './colors'\n`,
      'app/legacy.ts': legacy,
      'app/colors.ts': `export const primary = 'blue.300'\n`,
    })
    const result = fixture.fold(
      `import { css } from 'styled-system/css'\nimport { colors } from './index'\nexport const A = css(${style})\n`,
      'app/use.tsx',
    )

    expect(result.folded).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['dynamic'])
  })

  // Its own, though neither is read: not the star member's.
  test.each([
    ['a namespace', `export namespace tone {\n  export const color = 'red.300'\n}\n`],
    [
      'an `export import`',
      `namespace Inner {\n  export const tone = { color: 'red.300' }\n}\nexport import tone = Inner.tone\n`,
    ],
  ])('not over %s the barrel declares itself', (_, own) => {
    const result = foldThrough(
      {
        'app/index.ts': `export * from './base'\n${own}`,
        'app/base.ts': `export const tone = ${value(`'blue.300'`)}\n`,
      },
      'tone',
    )

    expect(result.folded).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['dynamic'])
  })

  // TypeScript erases them, so the name is the star member's, or the function the signatures
  // describe.
  test.each([
    ['a `declare const`', `export * from './base'\nexport declare const tone: (t: string) => any\n`],
    ['a `declare class`', `export * from './base'\nexport declare class tone {}\n`],
    [
      "a function's overloads",
      `export function tone(t: string): any\nexport function tone(t: number): any\nexport function tone(t: any) {\n  return { color: t }\n}\n`,
    ],
  ])('through %s', (_, index) => {
    const result = foldThrough(
      { 'app/index.ts': index, 'app/base.ts': `export const tone = ${helper('t')}\n` },
      `tone('red.300')`,
    )

    expect(withoutMergeCodes(result.folded.map((entry) => entry.className))).toEqual(['c_red.300'])
  })

  // A declaration file says what the code beside it holds, and holds none of it: the `.js` is read.
  test.each([
    [
      "a barrel's own helper, which its declaration file declares",
      {
        'app/lib.js': `export * from './base'\nexport function tone(t) {\n  return { color: t }\n}\n`,
        'app/lib.d.ts': `export * from './base'\nexport declare function tone(t: string): { color: string }\n`,
        'app/base.ts': `export const tone = ${helper(`'blue.300'`)}\n`,
      },
      `tone('red.300')`,
      ['c_red.300'],
    ],
    [
      'a value its declaration file declares with no value',
      {
        'app/lib.js': `export const tone = { color: 'red.300' }\n`,
        'app/lib.d.ts': `export const tone: { color: string }\n`,
      },
      'tone',
      ['c_red.300'],
    ],
    [
      'a value only a declaration file declares',
      { 'app/lib.d.ts': `export const tone: { color: string }\n` },
      'tone',
      [],
    ],
  ])('through a module beside its declaration file: %s', (_, files, style, classes) => {
    const fixture = createFoldFixture()
    fixture.addFiles(files)
    const result = fixture.fold(
      `import { css } from 'styled-system/css'\nimport { tone } from './lib.js'\nexport const A = css(${style})\n`,
      'app/use.tsx',
    )

    expect(withoutMergeCodes(result.folded.map((entry) => entry.className))).toEqual(classes)
  })

  // After a directory's index too, as Vite resolves `./lib` to `lib/index.ts`: read in its place,
  // the declaration file gave nothing.
  test('a directory beside a declaration file of its name is read through its index', () => {
    const fixture = createFoldFixture()
    fixture.addFiles({
      'app/lib/index.ts': `export const tone = { color: 'red.300' }\n`,
      'app/lib.d.ts': `export const tone: { color: string }\n`,
    })
    const result = fixture.fold(
      `import { css } from 'styled-system/css'\nimport { tone } from './lib'\nexport const A = css(tone)\n`,
      'app/use.tsx',
    )

    expect(withoutMergeCodes(result.folded.map((entry) => entry.className))).toEqual(['c_red.300'])
  })

  // A recipe a star member exports is not what a barrel exporting the name itself gives.
  test.each([
    [
      'a helper calling it',
      "import { button as base } from './recipes'\nexport const button = () => base({ size: 'lg' })\n",
    ],
    ['anything else', "export const button = () => 'my-button'\n"],
  ])("not a star member's recipe over %s the barrel exports as its name", (_, own) => {
    const fixture = createFoldFixture()
    fixture.addFiles({
      'app/recipes.ts': `import { cva } from 'styled-system/css'\nexport const button = cva({ base: { color: 'blue.300' }, variants: { size: { sm: { padding: '2' }, lg: { padding: '8' } } } })\n`,
      'app/index.ts': `export * from './recipes'\n${own}`,
    })
    const result = fixture.foldStrict(`import { button } from './index'\nexport const A = button()\n`, 'app/use.tsx')

    expect(result.code).toContain('export const A = button()')
    expect(result.folded).toEqual([])
  })

  // The value is read as the barrel's own; a helper held destructured is not followed to a call.
  test.each([
    ['a helper', helper(`'blue.300'`), helper('t'), `tone('red.300')`, []],
    ['a value', value(`'blue.300'`), value(`'red.300'`), 'tone', ['c_red.300']],
  ])('not over %s the barrel declares itself, destructured', (_, base, own, style, classes) => {
    const result = foldThrough(
      {
        'app/index.ts': `export * from './base'\nexport const { tone } = { tone: ${own} }\n`,
        'app/base.ts': `export const tone = ${base}\n`,
      },
      style,
    )

    expect(withoutMergeCodes(result.folded.map((entry) => entry.className))).toEqual(classes)
  })
})

describe('carrying the reason changes nothing that compiles', () => {
  // `x.join()` is tried as an array's join first. A refusal in `x` is the reason only when
  // nothing else calls it: here `helpers.join` is a method, and `size` has nothing to do with it.
  test('a method named `join`, on an object holding a value that was refused', () => {
    const result = createFoldFixture().fold(
      withImport(
        `let size = '1'\nsize = '2'\nconst helpers = { size, join: (color) => ({ color }) }\nexport const A = css(helpers.join('red.300'))`,
      ),
    )

    expect(result.skipped).toEqual([])
    expect(withoutMergeCodes(result.folded.map((entry) => entry.className))).toEqual(['c_red.300'])
  })
})
