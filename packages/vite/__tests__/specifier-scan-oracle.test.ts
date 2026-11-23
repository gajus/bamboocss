import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import { scanSpecifiers } from '../../node/src/extractable-files'
import { importsSourceModule, type SourceResolution } from '../src/plugin'

/**
 * The two scans that decide from text whether a module can reach bamboo, judged by a parser.
 *
 * The Vite compiler's (`importsSourceModule`) skips a module that cannot, and extraction's
 * (`scanSpecifiers`) leaves it unread. Either may read a specifier that is not there, which costs
 * a lookup of a file that does not exist. Neither may miss one that is: a module the compiler
 * skips ships its recipe calls uncompiled, to throw when loaded, and a file extraction skips loses
 * its rules. Three ways of missing one were found one at a time — a comment in front of the
 * specifier, an escape inside it, and a string or quoted word ending in `from`, `import` or
 * `require` in front of it, whose closing quote read as an opening — so this checks the direction
 * itself, with TypeScript's parser as the oracle: over this repository's own sources, and over
 * modules that put each kind of import behind each kind of text a scan could misread.
 */

/** How TypeScript reads a file, by its extension; JavaScript as JSX, which plain JavaScript also is. */
const scriptKind = (file: string) =>
  /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX

/**
 * The specifiers a module reaches a value through, as TypeScript's parser reads them: an import
 * binding a value, an export-from, an `import x = require()`, and a dynamic import or `require` of
 * a string. A side-effect import binds nothing and a type-only one nothing at runtime, so neither
 * scan owes them anything. `undefined` when the module does not parse.
 */
const parsedSpecifiers = (file: string, code: string): string[] | undefined => {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, false, scriptKind(file))
  // Internal to TypeScript, and the one place its syntax errors are kept without building a program.
  if ((source as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics?.length) return undefined

  const specifiers: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const bindsValue =
        !!clause &&
        !clause.isTypeOnly &&
        (!!clause.name ||
          (!!bindings && (ts.isNamespaceImport(bindings) || bindings.elements.some((element) => !element.isTypeOnly))))
      if (bindsValue && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause
      const exportsValue =
        !node.isTypeOnly &&
        (!clause || ts.isNamespaceExport(clause) || clause.elements.some((element) => !element.isTypeOnly))
      if (exportsValue && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text)
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference
      if (!node.isTypeOnly && ts.isExternalModuleReference(reference) && ts.isStringLiteral(reference.expression)) {
        specifiers.push(reference.expression.text)
      }
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments
      const loads =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      if (loads && argument && ts.isStringLiteral(argument)) specifiers.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

/** The package a bare specifier names, as `importsSourceModule` reads one. */
const packageNameOf = (specifier: string) => {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!
}

/** A path without the JavaScript or TypeScript extension a specifier may spell or omit. */
const stem = (path: string) => path.replace(/\.(?:d\.)?[cm]?[jt]sx?$/, '')

/**
 * A project holding the one module `specifier` names in `file`, and nothing else — so the
 * compiler's answer is yes exactly when its scan read that specifier. Located as
 * `importsSourceModule` locates one, so the two spell the path alike on every platform.
 */
const holding = (file: string, specifier: string): SourceResolution => {
  const local = specifier.startsWith('.') || specifier.startsWith('/')
  const target = specifier.startsWith('/') ? specifier : resolve(dirname(file), specifier)
  return {
    isSourceModule: (path) => local && (stem(path) === stem(target) || path.startsWith(`${target}/`)),
    resolveAlias: () => undefined,
    baseUrl: undefined,
    isSourcePackage: (name) => !local && name === packageNameOf(specifier),
  }
}

/** Every import the parser finds in `code` that a scan did not read, named by the scan that missed it. */
const unread = (file: string, code: string, specifiers: readonly string[]) => {
  const extraction = scanSpecifiers(code)
  return specifiers.flatMap((specifier) => [
    // A protocol — `node:`, `virtual:`, a URL — names no file, and the compiler's scan passes it by.
    ...(specifier.includes(':') || importsSourceModule(holding(file, specifier), file, code)
      ? []
      : [`the compiler missed '${specifier}'`]),
    // Extraction keeps a file whose imports it could not all read, so an incomplete scan misses nothing.
    ...(!extraction.complete || extraction.specifiers.includes(specifier) ? [] : [`extraction missed '${specifier}'`]),
  ])
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** Folders holding nothing the repository wrote: installed, built, generated or hidden. */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'out', 'outdir', 'coverage', 'styled-system', 'target'])

const sourceFiles = (directory: string, files: string[] = []) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIPPED.has(entry.name) || entry.name.endsWith('-outdir')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) sourceFiles(path, files)
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)) files.push(path)
  }
  return files
}

describe('the import scans, judged by a parser', () => {
  test("miss no import in this repository's own sources", () => {
    const misses: string[] = []
    let checked = 0
    for (const file of sourceFiles(ROOT)) {
      const code = readFileSync(file, 'utf8')
      const specifiers = parsedSpecifiers(file, code)
      if (!specifiers) continue
      checked += specifiers.length
      const where = relative(ROOT, file).replaceAll('\\', '/')
      misses.push(...unread(file, code, specifiers).map((miss) => `${miss} in ${where}`))
    }

    expect(misses).toEqual([])
    // Not vacuous: thousands of imports, across the packages, the sandboxes and the website.
    expect(checked).toBeGreaterThan(2000)
  })
})

/**
 * Text in front of an import that a scan could take for the start of a specifier: each ends a
 * string, a quoted word or a literal with the keyword, or holds a quote of its own. A line comment
 * can only stand on a line before the import.
 */
const LEADS: Array<{ name: string; text: string; lineOnly?: boolean }> = [
  { name: 'a comment quoting the keyword', text: `// keep the "import" below first`, lineOnly: true },
  { name: 'a block comment quoting the keyword', text: `/* moved 'from' the old module */` },
  { name: 'a string ending in the keyword', text: `const hint = 'Choose where to copy from'` },
  { name: 'a string that is the keyword', text: `const kind = "require"` },
  { name: 'a string ending in a call', text: `const call = "require("` },
  { name: 'a quoted key', text: `const map = { "import": 1, 'from': 2 }` },
  { name: 'a type made of keywords', text: `type Kind = 'import' | 'require'` },
  { name: 'JSX text holding an apostrophe', text: `const note = <p>Don't import from here</p>` },
  { name: 'a regular expression holding a quote', text: `const quote = /from'/` },
  { name: 'a string holding a whole import', text: `const doc = "import { a } from 'b'"` },
  { name: 'a template literal', text: 'const line = `import ${1} from`' },
]

/** Each way a module reaches a value through a specifier: a module of the project's, or a package. */
const IMPORTS: Array<{ name: string; text: string; specifier: string }> = [
  { name: 'a named import', text: `import { button } from './button.recipe'`, specifier: './button.recipe' },
  { name: 'a default import', text: `import button from './button.recipe'`, specifier: './button.recipe' },
  { name: 'a namespace import', text: `import * as recipes from './button.recipe'`, specifier: './button.recipe' },
  { name: 'a re-export', text: `export { button } from './button.recipe'`, specifier: './button.recipe' },
  {
    name: 'a dynamic import',
    text: `export const load = () => import('./button.recipe')`,
    specifier: './button.recipe',
  },
  { name: 'a require', text: `const { button } = require('./button.recipe')`, specifier: './button.recipe' },
  { name: 'a package import', text: `import { button } from '@acme/ds'`, specifier: '@acme/ds' },
]

const FILE = '/app/src/Component.tsx'

/** The module's imports, after checking it parses and holds the one it was written to hold. */
const importsOf = (code: string, expected: string) => {
  const specifiers = parsedSpecifiers(FILE, code)
  expect(specifiers, `does not parse:\n${code}`).toBeDefined()
  expect(specifiers).toContain(expected)
  return specifiers!
}

describe('an import behind text a scan could misread', () => {
  const cases = LEADS.flatMap((lead) =>
    IMPORTS.flatMap((entry) =>
      [
        { where: 'on the line before', separator: '\n' },
        { where: 'on the same line', separator: '; ' },
      ]
        .filter(({ separator }) => !(lead.lineOnly && separator !== '\n'))
        .map(({ where, separator }) => ({
          label: `${entry.name} after ${lead.name} ${where}`,
          code: `${lead.text}${separator}${entry.text}\nexport const used = button\n`,
          specifier: entry.specifier,
        })),
    ),
  )

  test.each(cases)('is read: $label', ({ code, specifier }) => {
    expect(unread(FILE, code, importsOf(code, specifier))).toEqual([])
  })
})

/** Mulberry32, as `recipe-table.test.ts` uses, so neighbouring seeds give unrelated modules. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('imports among several such texts, seeded', () => {
  // The label is the seed, so a failure names the module that produced it.
  test.each(Array.from({ length: 200 }, (_, index) => index + 1))('seed %i', (seed) => {
    const next = random(seed)
    const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!
    let code = ''
    for (let part = 2 + Math.floor(next() * 5); part > 0; part--) {
      const lead = next() < 0.6 ? pick(LEADS) : undefined
      code += lead ? lead.text : pick(IMPORTS).text
      code += lead?.lineOnly || next() < 0.5 ? '\n' : '; '
    }
    // Always one import behind whatever came before it.
    const last = pick(IMPORTS)
    code += `${last.text}\nexport const used = button\n`

    expect(unread(FILE, code, importsOf(code, last.specifier))).toEqual([])
  })
})
