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
    expect(refusal?.filePath).toMatch(/app\/src\/test\.tsx$/)
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
    expect(result.folded.map((entry) => entry.className)).toEqual(['c_red.300'])
  })
})
