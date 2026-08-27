import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Project as MorphProject, ScriptKind } from 'ts-morph'
import { afterAll, bench, describe } from 'vitest'
import { Project } from '../src/project'
import type { Node } from '../src/types'

/**
 * What a whole cold extraction pass costs per backend.
 *
 * Deliberately not the same measurement as `parser/__tests__/ast-backend.bench.ts`. That one
 * times the walk with a program already built, which is the steady state a watching dev server
 * sees, and reports 1.79x. This one includes building the program, because that is what a CLI
 * build and every CI run actually pay — and it is where TypeScript 7 wins by more, since the
 * parse happens in the Go process rather than on this thread.
 *
 * Both walks visit named children only, and the parity suite asserts they reach the same node
 * count on the same source, so the two sides are doing equal work rather than one of them
 * quietly skipping something.
 *
 * pnpm bench backend
 */
const FILES = 2000
const CALLS = 10

const root = mkdtempSync(path.join(tmpdir(), 'bamboo-backend-'))
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

const files = Array.from({ length: FILES }, (_, index) => {
  const calls = Array.from({ length: CALLS }, (_, call) => {
    const n = index * CALLS + call
    return (
      `export const s${call} = css({ color: 'red.${(n % 9) * 100 + 100}', padding: '${n % 12}', ` +
      `margin: '${(n * 3) % 16}', fontSize: '${['xs', 'sm', 'md', 'lg', 'xl'][n % 5]}', ` +
      `_hover: { color: 'blue.${(n % 5) * 100 + 200}' } })`
    )
  }).join('\n')
  const file = path.join(root, `src/mod${String(index).padStart(4, '0')}.ts`)
  writeFileSync(file, `import { css } from 'styled-system/css'\n${calls}\n`)
  return file
})

afterAll(() => {
  rmSync(root, { force: true, recursive: true })
})

describe(`${FILES} files x ${CALLS} css() calls — build a program and walk every node`, () => {
  bench(
    'ts-morph (today)',
    () => {
      const project = new MorphProject({
        skipAddingFilesFromTsConfig: true,
        skipFileDependencyResolution: true,
        skipLoadingLibFiles: true,
        useInMemoryFileSystem: true,
      })
      let nodes = 0
      for (const file of files) {
        const sourceFile = project.createSourceFile(file, readFileSync(file, 'utf8'), {
          overwrite: true,
          scriptKind: ScriptKind.TS,
        })
        sourceFile.forEachDescendant(() => {
          nodes++
        })
      }
      if (!nodes) throw new Error('walked nothing')
    },
    { time: 5000, warmupIterations: 2 },
  )

  bench(
    'TypeScript 7 (Go compiler)',
    () => {
      const project = new Project({ cwd: root, tsConfigFilePath: path.join(root, 'tsconfig.json') })
      let nodes = 0
      const walk = (node: Node) => {
        nodes++
        node.forEachChild(walk)
      }
      // Installed, then walked — the same two halves the ts-morph case pays for above, and
      // what a cold pass actually does: the parser hands the project its whole inventory and
      // then reads it. A project holds the files it is given, not the ones a glob reaches.
      project.addSourceFiles(files.map((file) => [file, readFileSync(file, 'utf8')] as const))
      for (const file of files) project.getSourceFile(file)?.forEachChild(walk)
      project.dispose()
      if (!nodes) throw new Error('walked nothing')
    },
    { time: 5000, warmupIterations: 2 },
  )
})
