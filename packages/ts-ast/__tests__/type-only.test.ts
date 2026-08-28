import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { getExportDeclarations, getImportDeclarations, getNamedImports, isTypeOnly } from '../src/node'
import { Project } from '../src/project'

/**
 * `type`-only, in all three places TypeScript spells it.
 *
 * Two carry the flag on the node itself — a specifier, and an export declaration. An **import**
 * declaration does not: `import type { A } from './a'` puts it on the import clause. Reading it
 * off the declaration therefore answered `false` for every type-only import there is, and did so
 * silently, which is why this is asserted form by form rather than through one representative
 * case.
 *
 * What the silence cost was not subtle. Callers written as
 * `if (isTypeOnly(declaration)) continue` — `imported-recipes.ts` has three — looked correct and
 * skipped nothing on the import side, so the walk descended into modules it had already decided
 * not to read, and resolution installed and parsed each one. On a real application whose
 * components each import a generated Relay artifact type-only, repairing this took the extraction
 * pass from 830s to 116s with byte-identical CSS.
 */
let root: string
let project: Project

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bamboo-type-only-'))
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true } }))
  project = new Project({ cwd: root })
})

afterEach(() => {
  project.dispose()
  rmSync(root, { force: true, recursive: true })
})

const sourceOf = (code: string) => {
  const source = project.addSourceFile(path.join(root, 'src', 'a.ts'), code)
  if (!source) throw new Error('the project produced no source file')
  return source
}

describe('an import declaration', () => {
  test('is type-only when the clause says so, not the declaration', () => {
    const source = sourceOf(`import type { A } from './a'\n`)
    const [declaration] = getImportDeclarations(source)

    // The flag this used to read. It is `false` here, which is exactly the trap.
    expect((declaration as unknown as { isTypeOnly?: boolean }).isTypeOnly).toBe(false)
    expect(isTypeOnly(declaration)).toBe(true)
  })

  test('is not type-only when only some specifiers are', () => {
    // `import { type B, C }` still has to load the module, for `C`.
    const [declaration] = getImportDeclarations(sourceOf(`import { type B, C } from './b'\n`))
    expect(isTypeOnly(declaration)).toBe(false)

    const [typeSpecifier, valueSpecifier] = getNamedImports(declaration)
    expect(isTypeOnly(typeSpecifier)).toBe(true)
    expect(isTypeOnly(valueSpecifier)).toBe(false)
  })

  test('is not type-only for a default or namespace type import that names values', () => {
    expect(isTypeOnly(getImportDeclarations(sourceOf(`import { D } from './d'\n`))[0])).toBe(false)
    expect(isTypeOnly(getImportDeclarations(sourceOf(`import type D from './d'\n`))[0])).toBe(true)
    expect(isTypeOnly(getImportDeclarations(sourceOf(`import type * as D from './d'\n`))[0])).toBe(true)
  })

  test('is not type-only for a side-effect import, which has no clause at all', () => {
    // The right answer: it names a module that still has to be loaded.
    expect(isTypeOnly(getImportDeclarations(sourceOf(`import './a'\n`))[0])).toBe(false)
  })
})

describe('an export declaration', () => {
  test('carries the flag itself', () => {
    const source = sourceOf(`export type { E } from './e'\nexport { F } from './f'\nexport type * from './g'\n`)
    const [typeNamed, value, typeStar] = getExportDeclarations(source)

    expect(isTypeOnly(typeNamed)).toBe(true)
    expect(isTypeOnly(value)).toBe(false)
    expect(isTypeOnly(typeStar)).toBe(true)
  })
})
