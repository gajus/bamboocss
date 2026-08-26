import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type Node, Project, type SourceFile, SyntaxKind, getDescendantsOfKind } from '@bamboocss/ts-ast'
import { expect, test } from 'vitest'
import { identifierIndex } from '../src/fold-analysis'

/**
 * `identifierIndex` against the obvious implementation of the same thing.
 *
 * It is a hand-written traversal rather than a call to `getDescendantsOfKind`, so it is held to
 * the output of the thing it replaced rather than to a description of it. The saving that
 * motivated it was ts-morph's wrapper objects, which TypeScript 7 does not have; what remains is
 * that the walk is `ts.forEachChild` directly, and the risk that it and a full descendant walk
 * disagree about what a file contains.
 *
 * Identity and order both matter downstream: `localReferencesTo` compares a candidate against the
 * declaration with `===`, and the survivor report takes the first entry in document order.
 *
 * The fixtures below are the cases where the two traversals could plausibly disagree, and one of
 * them did while this was being written — `ts.forEachChild` does not descend into JSDoc, so a name
 * appearing only in a `@type` annotation went missing until the walk was taught to. A missing
 * reference reads as "nothing uses this binding", which is the direction that ships broken output.
 */
/**
 * The obvious implementation: every identifier a full descendant walk reaches.
 *
 * JSDoc is added on top of it, because `getDescendantsOfKind` descends with `forEachChild` and
 * that does not enter JSDoc — where ts-morph's token path, which this used to be written
 * against, did. The reference is therefore not fully independent of the implementation on that
 * one axis; it cannot be, since the tree offers no other way in. It stays independent about
 * everything else, which is where the two walks could still drift: order, escapes, decorators,
 * namespaces and JSX.
 */
const REFERENCE = (sourceFile: SourceFile) => {
  const index = new Map<string, Node[]>()

  const record = (identifier: Node) => {
    // The resolved name, not the source span: `\u0062adge` and `badge` are the same binding and
    // have to share a bucket, which is the whole point of the `escaped.tsx` fixture.
    const text = String((identifier as { text?: string }).text)
    const known = index.get(text)
    if (known) known.push(identifier)
    else index.set(text, [identifier])
  }

  const walk = (node: Node) => {
    if (node.kind === SyntaxKind.Identifier) record(node)
    for (const doc of (node as { jsDoc?: Node[] }).jsDoc ?? []) walk(doc)
    node.forEachChild(walk as never)
  }

  walk(sourceFile)
  return index
}

/** Shapes chosen for where the two walks diverge, not for coverage of the language. */
const FIXTURES: Record<string, string> = {
  // `ts.forEachChild` skips JSDoc; the token path does not.
  'jsdoc.tsx':
    '/** @type {import("x").Y} */\nconst a = 1\n/** @param {Foo} b */\nfunction f(b) { return b }\nexport { a, f }',
  'jsdoc-typedef.tsx': '/** @typedef {import("./m").Thing} Thing */\n/** @type {Thing} */\nlet t\nexport { t }',
  // Keyed on the resolved name, so both spellings have to land in one bucket.
  'escaped.tsx': 'const \\u0062adge = 1\nexport const y = badge\nexport const z = \\u0062adge',
  'jsx.tsx': 'export const V = ({ p }) => <div id={p} data-x="1"><span key={p} /></div>',
  'decorators.tsx': 'declare const d: any\nclass C { @d m() {} @d p = 1\n  static { const s = 1 } }',
  'namespace.tsx': 'namespace N { export import q = require("m")\n  export const z = q }',
  'shadowed.tsx': 'const b = 1\nfunction f() { const b = 2; return b }\nexport { b, f }',
  'types.tsx': 'type T = { a: number }\ninterface I extends T { b: string }\nconst c: I = null as any\nexport { c }',
}

const sandbox = () => {
  try {
    return execSync(`find sandbox/*/src -name '*.tsx' -o -name '*.ts'`, { maxBuffer: 6e7 })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((file, index) => [`sandbox-${index}.tsx`, readFileSync(file, 'utf8')] as const)
  } catch {
    return []
  }
}

/** A project over a real directory, which is the only kind TypeScript 7 has. */
const projectFor = (label: string) => {
  const root = mkdtempSync(path.join(tmpdir(), `bamboo-${label}-`))
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { allowJs: true, jsx: 'react', noEmit: true, noLib: true }, include: ['**/*'] }),
  )
  return new Project({ cwd: root, tsConfigFilePath: path.join(root, 'tsconfig.json') })
}

test('the index returns exactly what a whole-tree walk did', () => {
  const project = projectFor('identifier-index')
  const corpus = [...sandbox(), ...Object.entries(FIXTURES)]

  let names = 0
  const problems: string[] = []

  for (const [name, text] of corpus) {
    const sourceFile = project.createSourceFile(name, text)
    if (!sourceFile) throw new Error(`the index fixture project did not accept ${name}`)
    const expected = REFERENCE(sourceFile)
    const actual = identifierIndex(sourceFile)

    for (const [key, wanted] of expected) {
      names++
      const got = actual.get(key)

      if (got.length !== wanted.length) {
        problems.push(`${name} "${key}": ${wanted.length} nodes -> ${got.length}`)
        continue
      }
      for (const [position, node] of wanted.entries()) {
        if (got[position] !== node) problems.push(`${name} "${key}"[${position}]: identity or order changed`)
      }
    }
  }

  expect(problems).toEqual([])
  // The sandbox glob is the bulk of it; a corpus that silently shrank to the fixtures would still
  // pass every assertion above and prove almost nothing.
  expect(names).toBeGreaterThan(500)
})

test('a name the module never spells comes back empty rather than undefined', () => {
  const project = projectFor('identifier-index-empty')
  const sourceFile = project.createSourceFile('empty.tsx', 'export const a = 1')
  if (!sourceFile) throw new Error('the index fixture project did not accept empty.tsx')

  expect(identifierIndex(sourceFile).get('nothingHere')).toEqual([])
})
