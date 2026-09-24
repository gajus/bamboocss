import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { parseFile } from './fixture'

/**
 * A module reached only by a type-only import must not be pulled into extraction.
 *
 * `import type { X } from './x'` is erased before anything runs, so `./x` cannot contribute a
 * declaration to any stylesheet. Native extraction reads value dependencies only.
 *
 * The cost is set by how a codebase generates its types rather than by how it writes its styles.
 * An application whose components each import a generated artifact type-only — a Relay fragment
 * key, a GraphQL operation type — pulls its whole generated tree into the program. On the one
 * this was found in, that was 2,945 files and 35.7 MB, and not reading them took the
 * extraction pass from 830s to 116s with byte-identical CSS.
 *
 * Asserted through the result's dependencies — the files the native evaluation crossed to
 * produce CSS — rather than through a timing. Those are what a watcher re-extracts the file for,
 * so a type-only module in that list would also re-extract its importer on every edit.
 */
const build = () => {
  const ctx = createContext({})
  const cwd = ctx.config.cwd
  const file = (name: string) => `${cwd}/src/${name}.ts`

  ctx.project.addSourceFile(
    file('erased'),
    `export type Erased = { a: string }\nexport const erasedValue = { color: 'red' }\n`,
  )
  ctx.project.addSourceFile(file('kept'), `export const keptValue = { color: 'blue' }\n`)
  ctx.project.addSourceFile(
    file('mixed'),
    `export type Mixed = { b: string }\nexport const mixedValue = { color: 'green' }\n`,
  )

  return { ctx, cwd, file }
}

describe('a module imported only for its types', () => {
  test('is not a dependency of the extraction; the value import is', () => {
    const { ctx, cwd, file } = build()
    const entry = `${cwd}/src/entry.tsx`
    ctx.project.addSourceFile(
      entry,
      `import type { Erased } from './erased'\n` +
        `import { keptValue } from './kept'\n` +
        `import { css } from '../styled-system/css'\n` +
        `export const declared: Erased | null = null\n` +
        `export const style = css(keptValue)\n`,
    )
    const result = parseFile(ctx, entry)

    expect([...result.css].map((item) => item.data)).toEqual([[{ color: 'blue' }]])
    expect(result.getDependencies()).toContain(file('kept'))
    expect(result.getDependencies()).not.toContain(file('erased'))
  })

  test('a mixed declaration still evaluates its value half', () => {
    const { ctx, cwd, file } = build()
    const entry = `${cwd}/src/entry.tsx`
    // `import { type A, B }` is a value import that happens to name a type. `B` is read.
    ctx.project.addSourceFile(
      entry,
      `import { type Mixed, mixedValue } from './mixed'\n` +
        `import { css } from '../styled-system/css'\n` +
        `export const declared: Mixed | null = null\n` +
        `export const style = css(mixedValue)\n`,
    )
    const result = parseFile(ctx, entry)

    expect([...result.css].map((item) => item.data)).toEqual([[{ color: 'green' }]])
    expect(result.getDependencies()).toContain(file('mixed'))
  })
})
