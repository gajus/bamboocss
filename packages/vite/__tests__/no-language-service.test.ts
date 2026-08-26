import { LanguageService, Program } from '@typescript/api/unstable/sync'
import { afterEach, describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

/**
 * The compiler must never ask a question that forces a type checker.
 *
 * The first such query resolves, parses and binds the whole transitive `.d.ts` closure of the
 * project. That is not hypothetical: a `findReferencesAsNodes` call in the survivor scan put a
 * 2,278-file app at 24,081 source-file instances and 4.4 GB of AST and symbols — 80% of the
 * heap — and the build OOMed at a 6 GB cap. The retained strings were `googleapis`,
 * `typescript` and `@vue/compiler-sfc`, none of which can contain a reference to a Bamboo
 * recipe binding.
 *
 * Under ts-morph the query surface was a language service hanging off the project, and this
 * spied on it directly. TypeScript 7 puts both halves behind the API: `LanguageService` for
 * reference and completion queries, and the checker-backed diagnostics on `Program`. The
 * cheap ones are excluded deliberately — `getSyntacticDiagnostics` is a parse-level question
 * the token accounting relies on, and answering it binds nothing.
 *
 * So this still asserts the invariant rather than any particular call site. A future
 * `getReferencedSymbolsForNode`, `getSemanticDiagnostics` or completion query anywhere in the
 * compile path fails here first, which is where the cost is cheapest to see.
 */
describe('the compile path never touches the language service', () => {
  /** Every entry point that binds the program, and none that merely reads the parse. */
  const QUERIES: Array<[object, string]> = [
    [LanguageService.prototype, 'getReferencedSymbolsForNode'],
    [LanguageService.prototype, 'getSignatureUsage'],
    [LanguageService.prototype, 'getCompletionsAtPosition'],
    [Program.prototype, 'getBindDiagnostics'],
    [Program.prototype, 'getSemanticDiagnostics'],
    [Program.prototype, 'getSuggestionDiagnostics'],
    [Program.prototype, 'getDeclarationDiagnostics'],
    [Program.prototype, 'getGlobalDiagnostics'],
  ]

  const restore: Array<() => void> = []
  afterEach(() => {
    for (const undo of restore.splice(0)) undo()
  })

  const countQueries = () => {
    const seen: string[] = []

    for (const [target, name] of QUERIES) {
      const holder = target as Record<string, unknown>
      const original = holder[name]
      if (typeof original !== 'function') continue
      holder[name] = function (this: unknown, ...args: unknown[]) {
        seen.push(name)
        return (original as (...a: unknown[]) => unknown).apply(this, args)
      }
      restore.push(() => {
        holder[name] = original
      })
    }

    return seen
  }

  const RECIPE = `cva({
    base: { display: 'flex' },
    variants: { tone: { quiet: { color: 'gray.500' }, loud: { color: 'red.500' } } },
  })`

  const cases: Array<[string, string]> = [
    ['a local recipe whose reference survives', `const b = ${RECIPE}\nexport const c = b\n`],
    ['a local recipe fully compiled', `const b = ${RECIPE}\nexport const c = b({ tone: 'loud' })\n`],
    ['an exported recipe', `export const b = ${RECIPE}\n`],
    ['an exported recipe read locally', `export const b = ${RECIPE}\nexport const c = b\n`],
    ['a re-exported recipe', `const b = ${RECIPE}\nexport { b }\n`],
    ['a recipe reached through a member access', `const b = ${RECIPE}\nexport const c = b.raw({ tone: 'loud' })\n`],
  ]

  test.each(cases)('%s', (_label, body) => {
    const fixture = createFoldFixture()
    const seen = countQueries()

    fixture.fold(`import { cva } from 'styled-system/css'\n${body}`, 'app/probe.tsx', true)

    expect(seen).toEqual([])
  })

  test('a consumer importing a recipe from another module', () => {
    const fixture = createFoldFixture()
    fixture.addFiles({ 'app/styles.ts': `import { cva } from 'styled-system/css'\nexport const b = ${RECIPE}\n` })
    const seen = countQueries()

    fixture.fold(`import { b } from './styles'\nexport const c = (t) => b({ tone: t })\n`, 'app/consumer.tsx', true)

    expect(seen).toEqual([])
  })
})
