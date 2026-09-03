import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/**
 * A bundler transform parked under an auxiliary path joins the project without counting as a
 * change to the file tree: nothing imports `X.__bamboo__.tsx`, so no resolution can move.
 *
 * The tree revision is what every importer's cached resolution facts are checked against, so
 * bumping it per transform made each module parsed afterwards re-resolve its imports with
 * filesystem probes. On a 7,000-file app that was most of the compile phase.
 */
describe('an auxiliary source', () => {
  test('does not advance the file tree revision, where a real file does', () => {
    const ctx = createContext()
    ctx.project.addSourceFile('app/src/a.ts', `export const a = 1\n`)
    const before = ctx.project.fileTreeRevision

    ctx.project.addSourceFile('app/src/a.ts.__bamboo__.ts', `export const a = 2\n`, { auxiliary: true })
    expect(ctx.project.fileTreeRevision, 'an auxiliary source').toBe(before)

    ctx.project.addSourceFile('app/src/b.ts', `export const b = 1\n`)
    expect(ctx.project.fileTreeRevision, 'a new file').toBeGreaterThan(before)
  })

  test('answers membership and bare-specifier targets without a read', () => {
    const ctx = createContext()
    ctx.project.addSourceFile('app/src/a.ts', `export const a = 1\n`)

    expect(ctx.project.hasSourceFile('app/src/a.ts')).toBe(true)
    expect(ctx.project.hasSourceFile('app/src/missing.ts')).toBe(false)
    expect(ctx.project.bareSpecifierTarget('some-package')).toBeUndefined()
  })
})
