import { LanguageService, Program } from '@typescript/api/unstable/sync'
import { afterAll, afterEach, expect, test } from 'vitest'
import { createProject, getTestExtract } from './create-project'

/**
 * Extraction must not issue a language-service query.
 *
 * A reference or completion query, and the checker-backed diagnostics beside it, resolve every
 * import transitively and bind every reachable `.d.ts`. That cost scales with the dependency
 * graph rather than the user's source, and inside a bundler it is paid in the same heap as the
 * module graph — one such call on the extraction path turned a 3s build into 24s and then an
 * OOM.
 *
 * Counted rather than timed, because the harness below has no dependency graph for a program to
 * walk: the call is nearly free here and ruinous in a real project, so a wall-clock assertion
 * would report green on exactly the regression it exists to catch.
 *
 * Watched on the TypeScript 7 surface. This used to spy on a ts-morph node method, which the
 * extractor no longer reaches at all — leaving a test that could only ever pass.
 * `getSyntacticDiagnostics` is deliberately absent: it answers from the parse and binds nothing.
 */
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

const seen: string[] = []
const restore: Array<() => void> = []

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

const spy = {
  get calls() {
    return seen
  },
}

afterEach(() => {
  seen.length = 0
})

afterAll(() => {
  for (const undo of restore.splice(0)) undo()
})

const project = createProject()

const extract = (code: string) =>
  getTestExtract(project, code, { functionNameList: ['css'], tagNameList: ['ColorBox'] })

test('a callee declared in the same file resolves without one', () => {
  extract(`
    const css = (styles: Record<string, string>) => styles
    export const cls = css({ color: 'red.300' })
  `)

  expect(spy.calls).toEqual([])
})

test('a callee aliased through another local declaration resolves without one', () => {
  extract(`
    import { jsx } from 'react/jsx-runtime'
    const _jsx = jsx
    const alias = _jsx
    export const el = alias('div', { color: 'blue.300' })
  `)

  expect(spy.calls).toEqual([])
})

test('an unresolvable callee gives up without one', () => {
  extract(`
    export const el = someGlobalNobodyDeclared('div', { color: 'green.300' })
  `)

  expect(spy.calls).toEqual([])
})

test('compiled jsx output still extracts, and still without one', () => {
  const result = extract(`
    import { jsx as _jsx } from 'react/jsx-runtime'
    export const App = () => _jsx(ColorBox, { css: { color: 'red.200' } })
  `)

  expect(spy.calls).toEqual([])
  expect(result.has('ColorBox')).toBe(true)
})

test('a bundled runtime helper declared in the file still extracts, and still without one', () => {
  const result = extract(`
    const createComponent = (Comp, props) => untrack(() => Comp(props || {}))
    export const App = () => createComponent(ColorBox, { css: { color: 'red.200' } })
  `)

  expect(spy.calls).toEqual([])
  expect(result.has('ColorBox')).toBe(true)
})
