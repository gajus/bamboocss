import { createGeneratorContext } from '@bamboocss/fixture'
import { compiledHelperName } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'
import { RECIPE_MAP_HELPER, SPLIT_PROPS_HELPER } from '../src/fold-recipe'

/** The helpers a fold can call. */
const HELPERS = [RECIPE_MAP_HELPER, SPLIT_PROPS_HELPER] as const

/**
 * The names a fold can write into a `styled-system/css` import: each helper's for this release.
 *
 * The transform extends whatever import of that module the file already has rather than
 * writing its own, so the barrel is the specifier its emitted calls resolve against.
 */
const INJECTED = HELPERS.map(compiledHelperName)

/** The authoring API the barrel exists to expose. */
const AUTHORING = ['css', 'cx', 'cva', 'sva', 'fallback', 'viewTransition']

const generated = (id: 'css-index' | 'cx', file: string) => {
  const [artifact] = createGeneratorContext().getArtifacts([id])
  const code = artifact?.files.find((entry) => entry.file === file)?.code
  if (!code) throw new Error(`no ${file} in the ${id} artifact`)
  return code
}

const barrel = (extension: 'mjs' | 'd.ts') => generated('css-index', `index.${extension}`)

/**
 * Names re-exported by a module, read from its `export { … } from '…'` statements, or with
 * `from: false` the names it exports from its own `export { … }` ones.
 *
 * Parsed rather than matched as substrings, so a name appearing only in a comment does not
 * count as an export.
 */
const reExportedNames = (code: string, { from = true } = {}) => {
  const names = new Set<string>()
  const statement = from ? /export\s+(?:type\s+)?\{([^}]*)\}\s*from/g : /export\s+\{([^}]*)\}(?!\s*from)/g

  for (const [, clause] of code.matchAll(statement)) {
    for (const specifier of clause.split(',')) {
      // `a as b` is exported under `b`; a bare `a` under itself.
      const exported = specifier
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (exported) names.add(exported)
    }
  }

  return names
}

describe('css barrel', () => {
  /**
   * Nothing else pins this pair short of a build. The barrel is a hand-written list in
   * `setupCssIndex`, and folded code is rewritten in memory during the bundler's transform, so
   * it is never typechecked — a name dropped from the barrel fails every build that compiles a
   * recipe call, on an import the barrel does not export.
   */
  test('exports every helper the fold can inject', () => {
    const exported = reExportedNames(barrel('mjs'))
    for (const helper of INJECTED) {
      expect(exported, `${helper} is written by the fold and must resolve`).toContain(helper)
    }
  })

  /**
   * The barrel re-exports the helpers from the `cx` module, which defines them, so a name it
   * re-exports and `cx` does not export fails to link, as `cx` would be the module lacking it.
   */
  test('re-exports helpers the cx module exports by the same names', () => {
    const exported = reExportedNames(generated('cx', 'cx.mjs'), { from: false })
    for (const helper of INJECTED) expect(exported).toContain(helper)
  })

  /**
   * By their own names they are what code compiled before the helpers were named for a release
   * imports, which finds nothing to call here either, rather than tables read in another format.
   */
  test('exports the helpers only by the names of this release', () => {
    const exported = reExportedNames(barrel('mjs'))
    for (const helper of HELPERS) expect(exported).not.toContain(helper)
  })

  test('exports the authoring API', () => {
    const exported = reExportedNames(barrel('mjs'))
    for (const name of AUTHORING) expect(exported).toContain(name)
  })

  /**
   * The declaration file omits the injected helpers on purpose: a declaration would buy
   * nothing — folded code is never typechecked — beyond advertising them as API, which is
   * what a blanket `export *` did before. Each stays typed in the module defining it, so
   * deep-importing one on purpose still works.
   *
   * Asserted so that "fix the types/runtime mismatch" does not quietly undo it.
   */
  test('does not declare the injected helpers as types', () => {
    const declared = reExportedNames(barrel('d.ts'))

    for (const helper of [...HELPERS, ...INJECTED]) expect(declared).not.toContain(helper)
    for (const name of AUTHORING) expect(declared).toContain(name)
  })
})
