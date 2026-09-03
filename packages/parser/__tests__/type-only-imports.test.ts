import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/**
 * A module reached only by a type-only import must not be pulled into extraction.
 *
 * `import type { X } from './x'` is erased before anything runs, so `./x` cannot contribute a
 * declaration to any stylesheet. Native extraction reads value dependencies without installing
 * either kind of module into the TypeScript compiler.
 *
 * The cost is set by how a codebase generates its types rather than by how it writes its styles.
 * An application whose components each import a generated artifact type-only — a Relay fragment
 * key, a GraphQL operation type — pulls its whole generated tree into the program. On the one
 * this was found in, that was 2,945 files and 35.7 MB, and not installing them took the
 * extraction pass from 830s to 116s with byte-identical CSS.
 *
 * Asserted through `has()`, which answers what bamboo installed into TypeScript, rather than
 * through a timing. Native cross-file evaluation should leave both type and value modules out.
 */
const build = () => {
  const ctx = createContext({}) as never as {
    config: { cwd: string }
    getFiles: () => string[]
    parseFiles: () => unknown
    project: {
      addSourceFile: (path: string, code: string) => unknown
      project: {
        getFileSystem: () => { writeFileSync: (path: string, code: string) => void }
        has: (path: string) => boolean
      }
    }
  }
  const cwd = ctx.config.cwd
  const fileSystem = ctx.project.project.getFileSystem()

  // Resolvable, and outside the inventory — so it is installed only if something demands it.
  const write = (name: string, code: string) => fileSystem.writeFileSync(`${cwd}/src/${name}.ts`, code)
  write('erased', `export type Erased = { a: string }\nexport const erasedValue = { color: 'red' }\n`)
  write('kept', `export const keptValue = { color: 'blue' }\n`)
  write('mixed', `export type Mixed = { b: string }\nexport const mixedValue = { color: 'green' }\n`)

  return { ctx, cwd, has: (name: string) => ctx.project.project.has(`${cwd}/src/${name}.ts`) }
}

describe('a module imported only for its types', () => {
  test('leaves the native value graph out of the compiler too', () => {
    const { ctx, cwd, has } = build()
    const entry = `${cwd}/src/entry.tsx`
    ctx.project.addSourceFile(
      entry,
      `import type { Erased } from './erased'\n` +
        `import { keptValue } from './kept'\n` +
        `import { css } from '../styled-system/css'\n` +
        `export const declared: Erased | null = null\n` +
        `export const style = css(keptValue)\n`,
    )
    ctx.getFiles = () => [entry]
    ctx.parseFiles()

    // The value import is read by Rust and the type-only one is ignored. Neither is installed
    // into the compiler merely to extract this file.
    expect(has('kept')).toBe(false)
    expect(has('erased')).toBe(false)
  })

  test('evaluates a mixed declaration without installing it into the compiler', () => {
    const { ctx, cwd, has } = build()
    const entry = `${cwd}/src/entry.tsx`
    // `import { type A, B }` is a value import that happens to name a type. Rust still reads
    // `B` for extraction, but does not need to install its module into TypeScript.
    ctx.project.addSourceFile(
      entry,
      `import { type Mixed, mixedValue } from './mixed'\n` +
        `import { css } from '../styled-system/css'\n` +
        `export const declared: Mixed | null = null\n` +
        `export const style = css(mixedValue)\n`,
    )
    ctx.getFiles = () => [entry]
    ctx.parseFiles()

    expect(has('mixed')).toBe(false)
  })
})
