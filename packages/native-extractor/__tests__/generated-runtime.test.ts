// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type {
  FoldAnalysis,
  NativeEntrypoint,
  NativeFileAnalysis,
  NativeFoldOptions,
  NativeProjectOptions,
  NativeSource,
} from '../index'

const { analyzeMany, compileModules } = createRequire(import.meta.url)('../index.cjs') as {
  analyzeMany(
    sources: NativeSource[],
    entrypoints: NativeEntrypoint[],
    options?: NativeProjectOptions,
  ): NativeFileAnalysis[]
  compileModules(sources: NativeSource[], auxiliary: NativeSource[], options: NativeFoldOptions): FoldAnalysis[]
}

/**
 * What bamboo generates for a call it compiles is not run to evaluate a value holding that call.
 *
 * `css()`, a recipe and a pattern throw until the compiler replaces them, so running one gave
 * nothing — and the evaluator parsed the entrypoint, and the helpers it imports, afresh for every
 * such call it met. Once a recipe turns on JSX capture, which evaluates every attribute of every
 * element, that was most of what extracting an app took. Counted by what each analysis read: every
 * file an evaluation looks at is among its dependencies, and nothing generated may be.
 */
describe('what bamboo generates is not run', () => {
  let root: string
  // Shaped as codegen writes it: each entrypoint a barrel, each function throwing until compiled.
  const files = {
    'styled-system/helpers.mjs':
      `export function uncompiledStyle(name) {\n` +
      `  throw new Error('bamboocss: ' + name + '() was not compiled')\n}\n`,
    'styled-system/css/css.mjs': `import { uncompiledStyle } from '../helpers.mjs'\nexport const css = (..._styles) => uncompiledStyle('css')\n`,
    // The join a class the compiler could not fold still runs through.
    'styled-system/css/cx.mjs':
      `function cx(a, b) {\n  const n = arguments.length\n  if (n === 2 && typeof a === 'string' && typeof b === 'string') return a + ' ' + b\n` +
      `  let str = ''\n  for (let i = 0; i < n; i++) if (typeof arguments[i] === 'string') str += ' ' + arguments[i]\n  return str.trim()\n}\n` +
      `export { cx }\n`,
    'styled-system/css/index.mjs': `export { css } from './css.mjs'\nexport { cx } from './cx.mjs'\n`,
    'styled-system/recipes/button.mjs': `import { uncompiledStyle } from '../helpers.mjs'\nexport const button = Object.assign((_props) => uncompiledStyle('button'), {})\n`,
    'styled-system/recipes/index.mjs': `export * from './button.mjs'\n`,
    'styled-system/patterns/flex.mjs': `import { uncompiledStyle } from '../helpers.mjs'\nexport const flex = (_styles) => uncompiledStyle('flex')\n`,
    'styled-system/patterns/index.mjs': `export * from './flex.mjs'\n`,
    'src/tone.ts': `export const tone = 'red.300'\n`,
  }
  const entrypoints: NativeEntrypoint[] = [
    {
      kind: 'css',
      modules: ['styled-system/css'],
      names: ['css', 'cva', 'sva', 'cx', 'fallback', 'viewTransition', 'keyframes'],
    },
    { kind: 'recipe', modules: ['styled-system/recipes'], names: ['button'] },
    { kind: 'pattern', modules: ['styled-system/patterns'], names: ['flex'] },
  ]
  // Spelled with `/` on every platform, where `join` spells a path with `\` on Windows.
  const slash = (path: string) => path.replaceAll('\\', '/')

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-generated-runtime-')))
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), content)
    }
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('in extraction, which evaluates every JSX attribute once a recipe turns capture on', () => {
    const source =
      `import { css, cx } from '../styled-system/css'\n` +
      `import { button } from '../styled-system/recipes'\n` +
      `import { flex } from '../styled-system/patterns'\n` +
      `import { tone } from './tone'\n` +
      `export const Card = ({ active }) => (\n` +
      `  <section className={flex({ gap: '2' })}>\n` +
      `    <p className={css({ color: tone })} />\n` +
      `    <a className={button({ size: 'sm' })} />\n` +
      `    <ul className={cx('list', active && css({ fontWeight: 'bold' }))} />\n` +
      `  </section>\n` +
      `)\n`
    const [analysis] = analyzeMany([{ filename: join(root, 'src/card.tsx'), source }], entrypoints, {
      cwd: root,
      paths: [],
      tokens: [],
      jsx: true,
    })

    // Each call is still read for what it is given.
    expect(analysis.calls).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'css', arguments: [{ color: 'red.300' }] })]),
    )
    // The module `tone` comes from, and nothing the entrypoints hold.
    expect(analysis.dependencies.map(slash)).toEqual([slash(join(root, 'src/tone.ts'))])
  })

  test('in the compiler, where a style is read off a value holding a call', () => {
    const mistaken = `css(flex({ gap: '2' }))`
    const source =
      `import { css } from '../styled-system/css'\n` +
      `import { button } from '../styled-system/recipes'\n` +
      `import { flex } from '../styled-system/patterns'\n` +
      `import { tone } from './tone'\n` +
      `const pick = (size) => ({ className: button({ size }), style: { color: tone } })\n` +
      `export const a = css(pick('sm').style)\n` +
      // A pattern's class, where its styles were meant: `flex.raw()` gives those.
      `export const b = ${mistaken}\n`
    const [analysis] = compileModules([{ filename: join(root, 'src/pick.ts'), source }], [], {
      cwd: root,
      paths: [],
      tokens: [],
      cssModules: ['styled-system/css'],
      tokenModules: ['styled-system/tokens'],
      recipeModules: ['styled-system/recipes'],
      patternModules: ['styled-system/patterns'],
      recipeNames: ['button'],
      patternNames: ['flex'],
      references: false,
    })

    expect(analysis!.dependencies.map(slash)).toEqual([slash(join(root, 'src/tone.ts'))])
    // Why the value is not known, at the call the program wrote: it pointed into the generated
    // helpers, at the `throw` the pattern reaches, and for a recipe said nothing at all.
    const refusal = analysis!.calls.find((call) => call.span.start === source.indexOf(mistaken))?.refusal
    expect(refusal && { ...refusal, filePath: slash(refusal.filePath) }).toEqual({
      kind: 'compiled',
      subject: 'flex',
      excerpt: "flex({ gap: '2' })",
      filePath: slash(join(root, 'src/pick.ts')),
      line: 7,
      column: 22,
    })
  })
})
