import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { Project } from '../src/project'

const CSS_IMPORT = `import { css } from 'styled-system/css'`

/**
 * What a bundler transform may do to a Project the stylesheet is also emitted from.
 *
 * The Vite compiler and the extraction pass hold one context now, so every parse the compiler
 * runs is a parse into the same encoder the sheet is built from unless it says otherwise. Two
 * things keep them apart, and both are here because neither is visible in the CSS until a rule
 * that nothing renders appears in a project's stylesheet:
 *
 * - the compiler parses through a clone, so its readings reach nothing the sheet collects;
 * - its transformed text is parsed under a sibling path, so the checkout stays canonical and
 *   the sibling's resolution facts stay out of the graph a rebuild re-extracts from.
 */
describe('compiler parses against a shared Project', () => {
  test('a supplied encoder collects the reading and the emitted one stays empty', () => {
    const ctx = createContext()
    const clone = ctx.encoder.clone()

    ctx.project.addSourceFile('/app/src/app.tsx', `${CSS_IMPORT}\nexport const cls = css({ color: 'red.500' })`)

    expect(ctx.project.parseSourceFile('/app/src/app.tsx', clone)?.css.size).toBe(1)
    expect(clone.atomic.size).toBeGreaterThan(0)
    expect(ctx.encoder.isEmpty(), 'the sheet is emitted from this one').toBe(true)
  })

  /**
   * A dumped encoder is a parse result like any other. Restoring it into the context's encoder
   * regardless of what the caller asked for was the one place a supplied encoder was ignored,
   * and it pins a whole safelist into the sheet from a pass that emits nothing.
   */
  test('a dumped encoder is restored into the supplied encoder, through either entry point', () => {
    const source = createContext()
    source.project.addSourceFile('/app/src/app.tsx', `${CSS_IMPORT}\nexport const cls = css({ color: 'red.500' })`)
    source.project.parseSourceFile('/app/src/app.tsx')
    const dump = JSON.stringify(source.encoder.toJSON())

    for (const parse of ['parseJson', 'parseSourceFile'] as const) {
      const fixture = createContext()
      const clone = fixture.encoder.clone()
      // Its own Project, because the dump is read through `readFile` rather than through
      // ts-morph's file system, and the fixture context reads the real one.
      const project = new Project({
        getFiles: () => [],
        hooks: {},
        parserOptions: fixture.parserOptions,
        readFile: () => dump,
        useInMemoryFileSystem: true,
      })

      project[parse]('/app/src/cache.json', clone)

      expect(clone.atomic.size, parse).toBe(source.encoder.atomic.size)
      expect(fixture.encoder.isEmpty(), parse).toBe(true)
    }
  })

  test('no encoder means the context is still the target, as every extraction pass expects', () => {
    const ctx = createContext()

    ctx.project.addSourceFile('/app/src/app.tsx', `${CSS_IMPORT}\nexport const cls = css({ color: 'red.500' })`)
    ctx.project.parseSourceFile('/app/src/app.tsx')

    expect(ctx.encoder.atomic.size).toBeGreaterThan(0)
  })
})

/**
 * The sibling path a transform's text is parsed under, and what a rebuild must not see of it.
 *
 * Its forward resolution is real and has to stay — a bundler registers those as watch files,
 * and the fold reads through them. What must not survive is the reverse: nothing on disk
 * imports the sibling, so an incremental pass selecting it as a dependent would order it
 * against inventory members that do not import it, for a file no watcher will ever report.
 */
describe('an auxiliary compiler source', () => {
  const setUp = () => {
    const ctx = createContext()
    ctx.project.project.getFileSystem().writeFileSync('/app/src/styles.ts', `export const base = { color: 'red.500' }`)

    const body = `${CSS_IMPORT}\nimport { base } from './styles'\nexport const cls = css(base)`
    ctx.project.addSourceFile('/app/src/app.tsx', body)
    ctx.project.addSourceFile('/app/src/app.tsx.__bamboo__.tsx', `${body}\n// transformed`, { auxiliary: true })

    // Both parsed, so both have recorded their resolution facts.
    ctx.project.parseSourceFile('/app/src/app.tsx')
    ctx.project.parseSourceFile('/app/src/app.tsx.__bamboo__.tsx', ctx.encoder.clone())

    return ctx
  }

  test('resolves like any other source, so the fold reads the same modules', () => {
    const ctx = setUp()

    expect(
      [...(ctx.project.parseSourceFile('/app/src/app.tsx.__bamboo__.tsx', ctx.encoder.clone())?.css ?? [])].flatMap(
        (call: any) => call.data,
      ),
    ).toEqual([{ color: 'red.500' }])
  })

  test('is not an importer the ledger or the dependent walk can reach', () => {
    const ctx = setUp()

    const importers = new Set(ctx.project.getResolutionLedger().map((fact) => fact.importer))
    expect(importers).toEqual(new Set(['/app/src/app.tsx']))
    expect(ctx.project.getDependents('/app/src/styles.ts')).toEqual(['/app/src/app.tsx'])
  })

  test('is not an unresolved importer a newly created file would re-select', () => {
    const ctx = createContext()
    const body = `${CSS_IMPORT}\nimport { base } from './not-yet'\nexport const cls = css(base)`

    ctx.project.addSourceFile('/app/src/app.tsx.__bamboo__.tsx', body, { auxiliary: true })
    ctx.project.parseSourceFile('/app/src/app.tsx.__bamboo__.tsx', ctx.encoder.clone())

    expect(ctx.project.getUnresolvedImporters()).toEqual([])
  })

  /**
   * The lane is per add, not per path. A transform whose text comes to match the checkout is
   * parsed under the file's own path again, and a stale auxiliary mark there would take a real
   * inventory member out of the graph a rebuild walks.
   */
  test('stops being auxiliary when the same path is added as a real source', () => {
    const ctx = createContext()
    ctx.project.project.getFileSystem().writeFileSync('/app/src/styles.ts', `export const base = { color: 'red.500' }`)
    const body = `${CSS_IMPORT}\nimport { base } from './styles'\nexport const cls = css(base)`

    ctx.project.addSourceFile('/app/src/app.tsx', body, { auxiliary: true })
    ctx.project.addSourceFile('/app/src/app.tsx', body)
    ctx.project.parseSourceFile('/app/src/app.tsx')

    expect(ctx.project.getDependents('/app/src/styles.ts')).toEqual(['/app/src/app.tsx'])
  })

  test('can be released with its compiler encoder when the physical module is deleted', () => {
    const ctx = setUp()
    const clone = ctx.encoder.clone()
    const auxiliary = '/app/src/app.tsx.__bamboo__.tsx'
    ctx.project.parseSourceFile(auxiliary, clone)
    expect(clone.isEmpty()).toBe(false)

    clone.releaseFile(auxiliary)
    expect(ctx.project.removeSourceFile(auxiliary)).toBe(true)

    expect(clone.isEmpty()).toBe(true)
    expect(ctx.project.getSourceFile(auxiliary)).toBeUndefined()
    expect(ctx.project.getResolutionLedger().every((fact) => fact.importer !== auxiliary)).toBe(true)
  })

  test('keeps the physical identity for path-sensitive parser hooks', () => {
    const physical = '/app/src/special.ts'
    const auxiliary = `${physical}.__bamboo__.ts`
    const before: string[] = []
    const after: string[] = []
    const ctx = createContext({
      plugins: [
        {
          name: 'path-sensitive-parser',
          hooks: {
            'parser:before': ({ content, filePath }) => {
              before.push(filePath)
              if (filePath === physical) return content.replace(`'red.500'`, `'blue.500'`)
            },
            'parser:after': ({ filePath }) => {
              after.push(filePath)
            },
          },
        },
      ],
    })
    const clone = ctx.encoder.clone()
    ctx.project.addSourceFile(auxiliary, `${CSS_IMPORT}\nexport const cls = css({ color: 'red.500' })`, {
      auxiliary: true,
    })

    ctx.project.parseSourceFile(auxiliary, clone, { hookFilePath: physical })

    expect(before).toEqual([physical])
    expect(after).toEqual([physical])
    expect(ctx.project.getSourceFile(auxiliary)?.getFullText()).toContain(`'blue.500'`)
  })
})
