import { describe, expect, test } from 'vitest'
import { selectExtractable, type ExtractableOptions } from '../src/extractable-files'

/**
 * Which files an extraction pass has to read.
 *
 * The win is large — on a real application 2,363 of 6,425 files provably could not hold a call,
 * and skipping them took the pass from 88.9s to 26.3s — and the failure mode is the worst one
 * bamboo has: a dropped rule is silent, leaving a green build and a class with nothing behind
 * it. So most of what is asserted here is the *keeping*, case by case, rather than the skipping.
 */
const CWD = '/repo'
const ENTRYPOINTS = ['styled-system/css', 'styled-system/recipes', 'styled-system/patterns']

/** A virtual tree: the sources are the only files that exist. */
const select = (sources: Record<string, string | undefined>, options?: Partial<ExtractableOptions>) =>
  selectExtractable(Object.keys(sources), {
    cwd: CWD,
    entrypoints: ENTRYPOINTS,
    fileExists: (filePath) => filePath in sources,
    readFile: (filePath) => sources[filePath],
    ...options,
  }).extractable

/** The same call, kept whole, for the assertions about what gets installed rather than parsed. */
const selection = (sources: Record<string, string | undefined>, options?: Partial<ExtractableOptions>) =>
  selectExtractable(Object.keys(sources), {
    cwd: CWD,
    entrypoints: ENTRYPOINTS,
    fileExists: (filePath) => filePath in sources,
    readFile: (filePath) => sources[filePath],
    ...options,
  })

describe('a file that names an entrypoint', () => {
  test('is kept, whichever entrypoint it names', () => {
    const sources = {
      '/repo/a.tsx': `import { css } from 'styled-system/css'\nexport const a = css({})`,
      '/repo/b.tsx': `import { button } from 'styled-system/recipes'`,
      '/repo/c.tsx': `import { stack } from 'styled-system/patterns'`,
      '/repo/d.tsx': `export const d = 1`,
    }
    expect(select(sources)).toEqual(['/repo/a.tsx', '/repo/b.tsx', '/repo/c.tsx'])
  })

  test('is kept when the import is split across lines', () => {
    // Matched against the whole text rather than against scanned specifiers, so a formatter
    // that wraps the line cannot hide the entrypoint.
    const sources = {
      '/repo/a.tsx': `import {\n  css,\n} from\n  'styled-system/css'\n`,
      '/repo/b.tsx': `export const b = 1`,
    }
    expect(select(sources)).toEqual(['/repo/a.tsx'])
  })
})

describe('a file with no way to reach an entrypoint', () => {
  test('is skipped', () => {
    const sources = {
      '/repo/util.ts': `export const clamp = (n: number) => n`,
      '/repo/api.ts': `import fetch from 'node-fetch'\nexport const get = () => fetch('/x')`,
    }
    expect(select(sources)).toEqual([])
  })

  test('is skipped even when it imports a package that itself uses bamboo', () => {
    // bamboo's own resolution stops at the project boundary — a target outside it reads as
    // non-local and is never extracted from — so a package import cannot hand this file a
    // binding bamboo would recognise.
    const sources = { '/repo/a.tsx': `import { Button } from '@acme/ui'\nexport const a = <Button />` }
    expect(select(sources)).toEqual([])
  })
})

describe('a binding that arrives through a local module', () => {
  test('keeps the importer, not just the module that named the entrypoint', () => {
    // The shape that makes this a graph rather than a filter: `recipe.ts` defines a `cva`
    // recipe and `card.tsx` calls it. Only the first mentions bamboo; both must be parsed,
    // because the variant selection lives in the second.
    const sources = {
      '/repo/recipe.ts': `import { cva } from 'styled-system/css'\nexport const card = cva({})`,
      '/repo/card.tsx': `import { card } from './recipe'\nexport const Card = () => <div className={card()} />`,
      '/repo/other.tsx': `import { clamp } from './nothing-here'\nexport const O = 1`,
    }
    expect(select(sources)).toEqual(['/repo/recipe.ts', '/repo/card.tsx'])
  })

  test('follows the chain further than one hop', () => {
    const sources = {
      '/repo/recipe.ts': `import { cva } from 'styled-system/css'\nexport const card = cva({})`,
      '/repo/card.tsx': `export { card } from './recipe'`,
      '/repo/page.tsx': `import { card } from './card'\nexport const P = () => <div className={card()} />`,
    }
    expect(select(sources)).toHaveLength(3)
  })
})

describe('an uncertainty', () => {
  test('keeps a file that could not be read', () => {
    // Unreadable is not "contributes nothing".
    expect(select({ '/repo/a.tsx': undefined })).toEqual(['/repo/a.tsx'])
  })

  test('keeps a file whose imports could not be scanned', () => {
    // The text says it imports something, and nothing was found: this did not understand the
    // file, so it cannot claim the file reaches nothing.
    const sources = { '/repo/a.tsx': `const x = 1 /* import */` }
    expect(select(sources)).toEqual(['/repo/a.tsx'])
  })

  test('does not mistake a file that genuinely imports nothing for one it failed on', () => {
    expect(select({ '/repo/a.ts': `export const a = 1` })).toEqual([])
  })

  test('keeps a file with a specifier spelled with an escape, recording the edges it could read', () => {
    // `'./recipe'` names `./recipe` only once decoded, which a scan does not do.
    const sources: Record<string, string> = {
      '/repo/app.tsx': `import { icon } from './generated/icon'\nimport { card } from './recip\\u0065'\nexport const A = card()`,
      '/repo/generated/icon.ts': `export const icon = 'x'`,
    }
    const result = selectExtractable(['/repo/app.tsx'], {
      cwd: CWD,
      entrypoints: ENTRYPOINTS,
      fileExists: (filePath) => filePath in sources,
      readFile: (filePath) => sources[filePath],
    })

    expect(result.extractable).toEqual(['/repo/app.tsx'])
    expect(result.auxiliary).toEqual(['/repo/generated/icon.ts'])
  })
})

/**
 * Beside any other import, a comment in front of a specifier hid it: the file importing a recipe
 * that way was dropped, and the classes its call asked for had no rule. Read past the comment, as
 * the Vite compiler's scan reads it, so the two agree on what the file imports.
 */
describe('a specifier a comment stands in front of', () => {
  test.each([
    ['a block comment after from', `import { card } from /* the recipe */ './recipe'`],
    ['a line comment after from', `import { card } from // the recipe\n  './recipe'`],
    ['a comment in an export-from', `export { card } from /* the recipe */ './recipe'`],
    ['a comment in a dynamic import', `const { card } = await import(/* webpackChunkName: "recipe" */ './recipe')`],
  ])('is read past %s, beside a package import', (_label, line) => {
    const sources = {
      '/repo/recipe.ts': `import { cva } from 'styled-system/css'\nexport const card = cva({})`,
      '/repo/card.tsx': `import React from 'react'\n${line}\nexport const Card = () => <div className={card()} />`,
    }
    expect(select(sources)).toEqual(['/repo/recipe.ts', '/repo/card.tsx'])
  })

  test('is followed to where it points, so a file it leads nowhere from is still skipped', () => {
    const sources = {
      '/repo/util.ts': `export const clamp = (n: number) => n`,
      '/repo/uses.ts': `import { clamp } from /* the helper */ './util'\nexport const u = clamp(1)`,
    }
    expect(select(sources)).toEqual([])
  })

  test('is not found where a comment wraps after "from", in a file importing only packages', () => {
    const sources = {
      '/repo/schema.ts': `import { z } from 'zod'\n// Derived from\n// the API's own.\nexport const s = z`,
    }
    expect(select(sources)).toEqual([])
  })
})

/**
 * A string or a quoted word ending in `from`, `import` or `require` closes with a quote that reads
 * as the opening of a specifier. Taken for one, it took the rest of the line up to the next quote
 * with it — the real specifier's, when the import followed on the same line — and the file lost
 * the edge it was kept by.
 */
describe('a specifier a quote stands in front of on the same line', () => {
  test.each([
    ['a string ending in from', `const hint = 'copy from'; import { card } from './recipe'`],
    ['a quoted key', `const map = { "from": 1 }; const { card } = require('./recipe')`],
  ])('is still read after %s', (_label, line) => {
    const sources = {
      '/repo/recipe.ts': `import { cva } from 'styled-system/css'\nexport const card = cva({})`,
      '/repo/card.tsx': `import React from 'react'\n${line}\nexport const Card = () => <div className={card()} />`,
    }
    expect(select(sources)).toEqual(['/repo/recipe.ts', '/repo/card.tsx'])
  })
})

describe('a path mapping', () => {
  test('is followed, so an aliased import is still an edge', () => {
    const sources = {
      '/repo/src/recipe.ts': `import { cva } from 'styled-system/css'\nexport const c = cva({})`,
      '/repo/uses.tsx': `import { c } from '#app/recipe'`,
      '/repo/free.tsx': `import { z } from '#app/absent'`,
    }
    const kept = select(sources, { paths: { '#app/*': ['./src/*'] } })
    expect(kept).toContain('/repo/uses.tsx')
    // The alias resolved to nothing on disk, so there is no module to carry a binding.
    expect(kept).not.toContain('/repo/free.tsx')
  })
})

describe('a local module the inventory never matched', () => {
  test('is reported for installing, without being parsed', () => {
    // A generated tree is the case: `exclude` keeps it out of extraction, and the app imports it
    // anyway. Handing these over in one batch is what stops the resolution walk demanding them
    // one at a time, each arrival costing a full program re-derivation.
    const sources: Record<string, string> = {
      '/repo/app.tsx': `import { icon } from './generated/icon'\nimport { css } from 'styled-system/css'\nexport const A = css({})`,
      '/repo/generated/icon.ts': `export const icon = 'x'`,
    }
    // Only the entry is in the inventory; the generated module is resolvable beside it.
    const result = selectExtractable(['/repo/app.tsx'], {
      cwd: CWD,
      entrypoints: ENTRYPOINTS,
      fileExists: (filePath) => filePath in sources,
      readFile: (filePath) => sources[filePath],
    })

    expect(result.extractable).toEqual(['/repo/app.tsx'])
    expect(result.auxiliary).toEqual(['/repo/generated/icon.ts'])
  })

  test('is not reported when the inventory already holds it', () => {
    const sources = {
      '/repo/a.tsx': `import { b } from './b'\nimport { css } from 'styled-system/css'\nexport const A = css({})`,
      '/repo/b.ts': `export const b = 1`,
    }
    // Both are in the inventory, so there is nothing extra to install.
    expect(selection(sources).auxiliary).toEqual([])
  })
})

/**
 * A project on Windows: the root as `path.resolve` spells it, with `\`, and the inventory as
 * fast-glob does, with `/`. Every candidate was built with `path.resolve` and checked against
 * `${cwd}/`, so no local import matched there, and a file reaching bamboo only through a local
 * module was never parsed — its classes shipped with no rule. Spelled out here, the same graph is
 * checked on every platform, not only in the Windows job.
 */
describe('a project with a Windows root', () => {
  const windows = (sources: Record<string, string>, options?: Partial<ExtractableOptions>) =>
    selectExtractable(Object.keys(sources), {
      cwd: 'C:\\repo',
      entrypoints: ENTRYPOINTS,
      fileExists: (filePath) => filePath in sources,
      readFile: (filePath) => sources[filePath],
      ...options,
    })

  test('follows a relative import to the module carrying the binding', () => {
    const sources = {
      'C:/repo/src/styles.ts': `import { css } from 'styled-system/css'\nexport const className = css({})`,
      'C:/repo/src/consumer.ts': `import { className } from './styles'\nexport const c = className`,
      'C:/repo/src/unrelated.ts': `export const u = 1`,
    }

    expect(windows(sources).extractable).toEqual(['C:/repo/src/styles.ts', 'C:/repo/src/consumer.ts'])
  })

  test('follows a path mapping and a parent directory', () => {
    const sources = {
      'C:/repo/src/theme/recipe.ts': `import { cva } from 'styled-system/css'\nexport const button = cva({})`,
      'C:/repo/src/app/Button.tsx': `import { button } from '@/theme/recipe'\nexport const B = button`,
      'C:/repo/src/app/Card.tsx': `import { button } from '../theme/recipe'\nexport const C = button`,
    }

    expect(windows(sources, { paths: { '@/*': ['src/*'] } }).extractable).toEqual([
      'C:/repo/src/theme/recipe.ts',
      'C:/repo/src/app/Button.tsx',
      'C:/repo/src/app/Card.tsx',
    ])
  })

  test('names a local module outside the inventory for installing', () => {
    const sources = {
      'C:/repo/src/a.tsx': `import { css } from 'styled-system/css'\nimport { icon } from './generated/icon'\nexport const a = css({})`,
    }
    const exists = (filePath: string) => filePath in sources || filePath === 'C:/repo/src/generated/icon.ts'

    expect(windows(sources, { fileExists: exists }).auxiliary).toEqual(['C:/repo/src/generated/icon.ts'])
  })
})
