import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Project } from '@bamboocss/ts-ast'
import { extract } from '../src/extract'
import { type ExtractOptions } from '../src/types'

/**
 * A project the extractor tests can put a string into.
 *
 * ts-morph could be handed compiler options inline and kept its files in memory. TypeScript 7's
 * compiler runs in another process and takes its options from a `tsconfig.json`, so the
 * equivalent is a real directory with a real config — one per module load, not per test, since
 * every case overwrites the same `file.tsx`.
 *
 * `noLib` is what keeps that affordable. These tests never ask a question that needs the
 * standard library: they read a syntax tree and evaluate the expressions in it, and the
 * evaluator resolves through the tree rather than through types. Loading `lib.esnext.d.ts` and
 * its transitive closure for every run would dominate a suite whose files are four lines long.
 */
export const createProject = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'bamboo-extractor-'))
  mkdirSync(root, { recursive: true })
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        allowJs: true,
        jsx: 'react',
        jsxFactory: 'React.createElement',
        jsxFragmentFactory: 'React.Fragment',
        module: 'esnext',
        noEmit: true,
        noLib: true,
        noUnusedParameters: false,
        target: 'esnext',
      },
      include: ['**/*'],
    }),
  )

  return new Project({ cwd: root, tsConfigFilePath: path.join(root, 'tsconfig.json') })
}

export type TestExtractOptions = Omit<ExtractOptions, 'ast'> & { tagNameList?: string[]; functionNameList?: string[] }

/**
 * Each extraction gets its own file.
 *
 * Reusing one name looks tidier and quietly couples the cases. The extractor memoizes on AST
 * nodes, and installing identical text is a no-op that keeps the existing tree — so two tests
 * that read the same source with *different matchers* would share nodes, and the second would
 * be served the first one's answers. Two cases in this file do exactly that, and the shared
 * name made the more permissive of them report the stricter one's result.
 *
 * ts-morph hid this: `createSourceFile(…, { overwrite: true })` replaced the file whether or not
 * the text had moved, so every case got fresh nodes and therefore a cold cache. A distinct name
 * per extraction states that intent instead of inheriting it.
 */
let extraction = 0

export const getTestExtract = (
  project: Project,
  code: string,
  { tagNameList, functionNameList, ...options }: TestExtractOptions,
) => {
  const fileName = `file-${extraction++}.tsx`
  const sourceFile = project.createSourceFile(fileName, code)
  if (!sourceFile) throw new Error(`bamboo: the test project did not accept ${fileName}`)

  return extract({
    ast: sourceFile,
    ...options,
    components: tagNameList
      ? {
          matchTag: ({ tagName }) => tagNameList.includes(tagName),
          matchProp: () => true,
        }
      : options.components,
    functions: functionNameList
      ? {
          matchFn: ({ fnName }) => functionNameList.includes(fnName),
          matchProp: () => true,
          matchArg: () => true,
        }
      : options.functions,
  })
}
