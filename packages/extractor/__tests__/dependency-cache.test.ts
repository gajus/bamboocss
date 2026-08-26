import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Project, getVariableDeclaration, type Expression } from '@bamboocss/ts-ast'
import { clearBoxNodeCache, maybeBoxNode } from '../src/maybe-box-node'
import { safeEvaluateNode } from '../src/evaluate-node'
import { unbox } from '../src/unbox'
import type { BoxContext, ResolveModule } from '../src/types'

/**
 * Two parallel module graphs behind one entry, so a cached value can be caught answering for
 * the wrong resolver.
 *
 * ts-morph could hold these in memory under tidy paths like `/a/helper.ts`. TypeScript 7's
 * compiler reads through a real project rooted at a real `tsconfig.json`, so the graph lives in
 * a temporary directory and the paths the cache records are absolute. `at()` spells them, and
 * the assertions below compare against it rather than against literals, since the root differs
 * per run.
 */
const root = mkdtempSync(path.join(tmpdir(), 'bamboo-dependency-cache-'))
writeFileSync(
  path.join(root, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { noEmit: true, noLib: true }, include: ['**/*'] }),
)

const at = (relative: string) => path.join(root, relative).replaceAll('\\', '/')

const fixture = () => {
  const project = new Project({ cwd: root, tsConfigFilePath: path.join(root, 'tsconfig.json') })
  project.createSourceFile(at('entry.ts'), `import { decorate } from './helper'\nexport const value = decorate()`)
  for (const [scope, color] of [
    ['a', 'red.300'],
    ['b', 'blue.500'],
  ] as const) {
    project.createSourceFile(
      at(`${scope}/helper.ts`),
      `import { tone } from './leaf'\nexport const decorate = () => ({ ...tone, padding: '2' })`,
    )
    project.createSourceFile(at(`${scope}/leaf.ts`), `export const tone = { color: '${color}' }`)
  }

  // Read back after every file is installed: each install advances the snapshot, and a node
  // taken from an earlier one belongs to the tree as it stood then.
  const entry = project.getSourceFile(at('entry.ts'))!

  const resolver =
    (scope: 'a' | 'b'): ResolveModule =>
    (specifier, from) => {
      if (from.fileName === at('entry.ts') && specifier === './helper') {
        return project.getSourceFile(at(`${scope}/helper.ts`))
      }
      if (from.fileName === at(`${scope}/helper.ts`) && specifier === './leaf') {
        return project.getSourceFile(at(`${scope}/leaf.ts`))
      }
    }

  const declaration = getVariableDeclaration(entry, 'value')
  if (!declaration) throw new Error('bamboo: the fixture entry declared no `value`')
  const expression = (declaration as { initializer?: Expression }).initializer!
  return { entry, expression, project, resolver }
}

const context = (resolveModule: ResolveModule) => {
  const dependencies: string[] = []
  const ctx: BoxContext = {
    flags: { skipTraverseFiles: false },
    recordDependency: (filePath) => dependencies.push(filePath),
    resolveModule,
  }
  return { ctx, dependencies }
}

afterEach(clearBoxNodeCache)

describe('semantic dependency cache replay', () => {
  test('maybeBoxNode scopes values and paths to a resolver, then replays a hit deterministically', () => {
    const { expression, resolver } = fixture()
    const first = context(resolver('a'))
    const second = context(resolver('b'))

    expect(unbox(maybeBoxNode(expression, [], first.ctx)!).raw).toEqual({ color: 'red.300', padding: '2' })
    expect(first.dependencies.sort()).toEqual([at('a/helper.ts'), at('a/leaf.ts')])

    expect(unbox(maybeBoxNode(expression, [], second.ctx)!).raw).toEqual({ color: 'blue.500', padding: '2' })
    expect(second.dependencies.sort()).toEqual([at('b/helper.ts'), at('b/leaf.ts')])

    const replay = context(second.ctx.resolveModule!)
    expect(unbox(maybeBoxNode(expression, [], replay.ctx)!).raw).toEqual({ color: 'blue.500', padding: '2' })
    expect(replay.dependencies).toEqual([at('b/helper.ts'), at('b/leaf.ts')])
  })

  test('the evaluator cache replays paths without retaining another resolver context', () => {
    const { expression, resolver } = fixture()
    const first = context(resolver('a'))
    const second = context(resolver('b'))

    expect(safeEvaluateNode(expression, [], first.ctx)).toEqual({ color: 'red.300', padding: '2' })
    expect(first.dependencies.sort()).toEqual([at('a/helper.ts'), at('a/leaf.ts')])
    expect(safeEvaluateNode(expression, [], second.ctx)).toEqual({ color: 'blue.500', padding: '2' })
    expect(second.dependencies.sort()).toEqual([at('b/helper.ts'), at('b/leaf.ts')])

    const replay = context(second.ctx.resolveModule!)
    expect(safeEvaluateNode(expression, [], replay.ctx)).toEqual({ color: 'blue.500', padding: '2' })
    expect(replay.dependencies).toEqual([at('b/helper.ts'), at('b/leaf.ts')])
  })

  test('clearing after source replacement records paths from fresh nodes', () => {
    const { expression, project, resolver } = fixture()
    const resolveModule = resolver('b')
    expect(safeEvaluateNode(expression, [], context(resolveModule).ctx)).toEqual({ color: 'blue.500', padding: '2' })

    project.createSourceFile(at('b/leaf.ts'), `export const tone = { color: 'green.400' }`)
    clearBoxNodeCache()
    const refreshed = context(resolveModule)
    expect(safeEvaluateNode(expression, [], refreshed.ctx)).toEqual({ color: 'green.400', padding: '2' })
    expect(refreshed.dependencies.sort()).toEqual([at('b/helper.ts'), at('b/leaf.ts')])
  })
})
