import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { codegen, loadConfigAndCreateContext } from '@bamboocss/node'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { bamboocss } from '../src/plugin'

/**
 * Every class the compiled JavaScript names has a rule in the stylesheet, or the build fails.
 *
 * Two engines used to decide those two halves: the stylesheet was extracted in Rust, while the
 * class names written into the JavaScript came from the TypeScript evaluator behind the fold.
 * Wherever they disagreed about a value, the JavaScript named a class the stylesheet never
 * emitted, and the build passed — the element simply rendered unstyled.
 *
 * Each case is a value shape the two engines once disagreed on. The assertion does not care
 * which engine is right, only that the outcome is coherent: the class ships with a rule, or the
 * build refuses.
 *
 * A project of its own under the system temp directory, generated `styled-system` included, so
 * nothing it writes can join another real-build test's corpus.
 */
let root: string

const write = (file: string, contents: string) => {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

beforeAll(async () => {
  // Real path: on macOS the temp directory is reached through a symlink, and a module whose id
  // is the resolved path would otherwise sit outside an `include` spelled through the link.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'bamboo-engine-agreement-')))
  write(
    'bamboo.config.mjs',
    `export default { include: ['src/**/*.{ts,tsx}'], outdir: 'styled-system', preflight: false }\n`,
  )
  write(
    'src/values.ts',
    `export default { width: '[3.1111px]' }\nexport const named = '[3.2222px]'\nexport const obj = { w: '[3.3333px]' }\n`,
  )
  write('src/barrel.ts', `export * as ns from './values'\n`)
  const ctx = await loadConfigAndCreateContext({ cwd: root })
  await codegen(ctx)
}, 120_000)

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

const CASES: Record<string, string> = {
  enum: `enum Tone { Warm = '[1.1111px]' }\nexport const c = css({ width: Tone.Warm })`,
  'const enum': `const enum Tone { Warm = '[1.2222px]' }\nexport const c = css({ width: Tone.Warm })`,
  'optional chaining': `const o = { a: '[1.3333px]' } as { a?: string } | undefined\nexport const c = css({ width: o?.a })`,
  'destructured const': `const { a } = { a: '[1.4444px]' }\nexport const c = css({ width: a })`,
  'as const object': `const sizes = { sm: '[1.5555px]' } as const\nexport const c = css({ width: sizes.sm })`,
  'satisfies object': `const sizes = { sm: '[1.6666px]' } satisfies Record<string, string>\nexport const c = css({ width: sizes.sm })`,
  'template literal': `const n = 1.7777\nexport const c = css({ width: \`[\${n}px]\` })`,
  'function returning object': `const make = () => ({ width: '[1.8888px]' })\nexport const c = css(make())`,
  'default import': `import values from './values'\nexport const c = css(values)`,
  'namespace import': `import * as values from './values'\nexport const c = css({ width: values.named })`,
  'export * as ns': `import { ns } from './barrel'\nexport const c = css({ width: ns.obj.w })`,
  'local method call': `const o = { f: () => '[3.4444px]' }\nexport const c = css({ width: o.f() })`,
}

const buildCase = async (name: string, body: string) => {
  const entry = join(root, `src/case-${name.replaceAll(/\W+/g, '-')}.tsx`)
  writeFileSync(entry, `import 'virtual:bamboo.css'\nimport { css } from '../styled-system/css'\n${body}\n`)

  const result = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [bamboocss({ cwd: root, reportSummary: false })],
    build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'agreement' } },
  })) as Rollup.RollupOutput[]

  const output = result[0]!.output
  const css = output.map((o) => ('source' in o && typeof o.source === 'string' ? o.source : '')).join('\n')
  const js = output.map((o) => ('code' in o ? o.code : '')).join('\n')
  return { css, js }
}

/** The class string the entry exports as `c`, read out of the bundle. */
const exportedClass = async (js: string) => {
  const mod = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)) as { c: string }
  return mod.c
}

const hasRuleFor = (css: string, className: string) => {
  const escaped = className.replaceAll(/[^\w-]/g, (ch) => `\\${ch}`)
  return css.includes(`.${escaped}`) || css.includes(`.${className}`)
}

describe('the stylesheet and the compiled JavaScript agree', () => {
  test.each(Object.entries(CASES))(
    '%s',
    async (name, body) => {
      let outcome: { css: string; js: string }
      try {
        outcome = await buildCase(name, body)
      } catch (error) {
        // Refusing is coherent — but only the refusal this is about: the compiler saying it could
        // not compile the call. Any other failure is the fixture broken, and accepting it would let
        // every case pass without building anything.
        expect(String((error as Error).message)).toMatch(/call\(s\) could not be compiled/)
        return
      }

      const className = await exportedClass(outcome.js)
      const missing = className
        .split(' ')
        .filter(Boolean)
        .filter((token) => !hasRuleFor(outcome.css, token))
      expect(missing, `classes in the JS with no rule in the stylesheet (JS: ${JSON.stringify(className)})`).toEqual([])
    },
    120_000,
  )
})
