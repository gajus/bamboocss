import { rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bamboocss from '@bamboocss/vite'
import { build, type Rollup } from 'vite'
import { afterAll, describe, expect, test } from 'vitest'

/**
 * Every class the compiled JavaScript names has a rule in the stylesheet, or the build fails.
 *
 * Two engines used to decide those two halves: the stylesheet was extracted in Rust, while the
 * class names written into the JavaScript came from the TypeScript evaluator behind the fold.
 * Wherever they disagreed about a value, the JavaScript named a class the stylesheet never
 * emitted, and the build passed — the element simply rendered unstyled.
 *
 * Each case below is a value shape the two engines once disagreed on. The assertion does not
 * care which engine is right, only that the outcome is coherent: either the class ships with a
 * rule, or the build refuses.
 */
const here = dirname(fileURLToPath(import.meta.url))
const cwd = join(here, '..')
const written: string[] = []

afterAll(() => {
  for (const file of written) rmSync(file, { force: true })
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
}

const buildCase = async (name: string, body: string) => {
  const entry = join(cwd, `src/__engine-agreement-${name.replaceAll(/\W+/g, '-')}.tsx`)
  written.push(entry)
  writeFileSync(entry, `import 'virtual:bamboo.css'\nimport { css } from '../styled-system/css'\n${body}\n`)

  const result = (await build({
    root: cwd,
    logLevel: 'silent',
    css: { postcss: { plugins: [] } },
    plugins: [bamboocss({ cwd, reportSummary: false })],
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
  test.each(Object.entries(CASES))('%s', async (name, body) => {
    let outcome: { css: string; js: string }
    try {
      outcome = await buildCase(name, body)
    } catch (error) {
      // Refusing is coherent: the build said it could not compile the call.
      expect(String((error as Error).message)).toMatch(/could not be compiled|was not compiled|bamboocss/)
      return
    }

    const className = await exportedClass(outcome.js)
    const missing = className
      .split(' ')
      .filter(Boolean)
      .filter((token) => !hasRuleFor(outcome.css, token))
    expect(missing, `classes in the JS with no rule in the stylesheet (JS: ${JSON.stringify(className)})`).toEqual([])
  }, 120_000)
})
