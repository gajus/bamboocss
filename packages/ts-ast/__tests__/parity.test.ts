import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Project as MorphProject, ScriptKind, SyntaxKind } from 'ts-morph'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  forEachDescendant,
  getDescendantsOfKind,
  getImportDeclarations,
  getModuleSpecifierValue,
  is,
} from '../src/node'
import { Project } from '../src/project'
import type { SourceFile } from '../src/types'

/**
 * The backend swap, checked against the one it replaces.
 *
 * Every assertion here is a comparison rather than a literal: what matters is not that
 * TypeScript 7 reports some particular offset, but that it reports the same one ts-morph did
 * for the same source. A hardcoded expectation would pass while the two backends disagreed.
 */
const SOURCE = [
  `import { css, cx } from 'styled-system/css'`,
  `import { button } from './recipes'`,
  `const shared = { color: 'red.300', padding: '4' }`,
  `export const a = css({ ...shared, fontSize: 'lg', _hover: { color: 'blue.500' } })`,
  `export const b = css({ display: 'flex' })`,
  `export const c = cx(a, b, 'literal')`,
  `export const d = button({ size: 'sm' })`,
  `export function make(tone: string) { return css({ color: tone }) }`,
  '',
].join('\n')

let root: string
let file: string
let project: Project
let morph: MorphProject

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bamboo-ts-ast-'))
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        jsx: 'preserve',
        module: 'preserve',
        moduleResolution: 'bundler',
        noEmit: true,
        target: 'esnext',
      },
      include: ['src'],
    }),
  )
  file = path.join(root, 'src/a.tsx')
  writeFileSync(file, SOURCE)
  writeFileSync(path.join(root, 'src/recipes.ts'), `export const button = (o: unknown) => String(o)\n`)

  project = new Project({ cwd: root, tsConfigFilePath: path.join(root, 'tsconfig.json') })
  morph = new MorphProject({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    useInMemoryFileSystem: true,
  })
  morph.createSourceFile(file, SOURCE, { overwrite: true, scriptKind: ScriptKind.TSX })
})

afterAll(() => {
  project.dispose()
  rmSync(root, { force: true, recursive: true })
})

const sourceFile = (): SourceFile => {
  const found = project.getSourceFile(file)
  if (!found) throw new Error('TypeScript 7 did not produce a source file')
  return found
}

describe('the TypeScript 7 backend agrees with ts-morph', () => {
  test('on the number of nodes in the tree', () => {
    let seven = 0
    forEachDescendant(sourceFile(), () => seven++)

    let sixth = 0
    // The braces matter: ts-morph halts the walk when the callback returns something
    // truthy, so `() => sixth++` stops as soon as the counter passes zero.
    morph.getSourceFileOrThrow(file).forEachDescendant(() => {
      sixth++
    })

    expect(seven).toBe(sixth)
  })

  test('on which modules are imported', () => {
    const seven = getImportDeclarations(sourceFile()).map(getModuleSpecifierValue)
    const sixth = morph
      .getSourceFileOrThrow(file)
      .getImportDeclarations()
      .map((declaration) => declaration.getModuleSpecifierValue())

    expect(seven).toEqual(sixth)
    expect(seven).toEqual(['styled-system/css', './recipes'])
  })

  test('on every call expression, by the text it spans', () => {
    const seven: string[] = []
    forEachDescendant(sourceFile(), (node) => {
      if (is.isCallExpression(node)) seven.push(node.getText())
    })

    const sixth = morph
      .getSourceFileOrThrow(file)
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .map((node) => node.getText())

    // Compared as sets: `forEachChild` and `forEachDescendant` agree on membership, and this
    // test is about what was found rather than the order two different walks reach it in.
    expect(new Set(seven)).toEqual(new Set(sixth))
    expect(seven.some((text) => text.startsWith('css({ ...shared'))).toBe(true)
  })

  test('on every string literal value', () => {
    const seven: string[] = []
    forEachDescendant(sourceFile(), (node) => {
      if (is.isStringLiteral(node)) seven.push(node.text as string)
    })

    expect(seven).toContain('red.300')
    expect(seven).toContain('blue.500')
    expect(seven).toContain('styled-system/css')
  })

  test('on the property names of an object literal', () => {
    const seven: string[] = []
    forEachDescendant(sourceFile(), (node) => {
      if (is.isPropertyAssignment(node)) seven.push((node.name as { text?: string })?.text ?? '')
    })

    expect(seven).toEqual(expect.arrayContaining(['color', 'padding', 'fontSize', '_hover', 'display', 'size']))
  })

  test('on node ranges, so a source rewrite lands in the same place', () => {
    const first = getImportDeclarations(sourceFile())[0]!
    const morphFirst = morph.getSourceFileOrThrow(file).getImportDeclarations()[0]!

    expect(first.getStart()).toBe(morphFirst.getStart())
    expect(first.getEnd()).toBe(morphFirst.getEnd())
    expect(sourceFile().text.slice(first.getStart(), first.getEnd())).toBe(morphFirst.getText())
  })

  test('on parent pointers', () => {
    let property: { parent?: { kind: number } } | undefined
    forEachDescendant(sourceFile(), (node) => {
      if (!property && is.isPropertyAssignment(node)) property = node
    })

    expect(property?.parent).toBeDefined()
    expect(is.isObjectLiteralExpression(property!.parent as never)).toBe(true)
  })

  test('getDescendantsOfKind finds the same nodes as a full walk', () => {
    const file7 = sourceFile()
    const viaWalk: unknown[] = []
    forEachDescendant(file7, (node) => {
      if (is.isCallExpression(node)) viaWalk.push(node)
    })

    expect(getDescendantsOfKind(file7, viaWalk.length ? (viaWalk[0] as { kind: number }).kind : -1)).toHaveLength(
      viaWalk.length,
    )
  })
})

/**
 * The bundler path. A Vite `transform` hook is handed a module's *current* text, which is not
 * what is on disk once JSX has been lowered or a framework plugin has lifted a block out of a
 * single-file component. Without this the backend could only read files as written, which would
 * have made it unusable for everything except the CLI.
 */
describe('reading text that is not on disk', () => {
  test('sees the override rather than the file', () => {
    const overridden = `import { css } from 'styled-system/css'\nexport const only = css({ margin: '9' })\n`

    const found = project.withText(file, overridden, (sf) => {
      const literals: string[] = []
      if (sf) forEachDescendant(sf, (node) => is.isStringLiteral(node) && literals.push(node.text as string))
      return literals
    })

    expect(found).toContain('9')
    expect(found).not.toContain('red.300')
  })

  test('releases the override, so the next read is the file again', () => {
    project.withText(file, `export const nothing = 1\n`, () => undefined)

    const literals: string[] = []
    forEachDescendant(sourceFile(), (node) => is.isStringLiteral(node) && literals.push(node.text as string))

    expect(literals).toContain('red.300')
  })
})
