import { createGeneratorContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { generateCvaFn } from '../src/artifacts/js/cva'
import { generateSvaFn } from '../src/artifacts/js/sva'

/**
 * The runtime `cva`/`sva` a compiled build keeps is a callable that throws and
 * `splitVariantProps` — everything else compiles away or fails the build.
 *
 * Pinned by what the module imports rather than by a snapshot of its text, because the imports
 * are what decide the bundle: the removed engine pulled `mergeCss`, and through it the shorthand
 * table, into every bundle that imported `cva`.
 */
describe.each([
  ['cva', generateCvaFn],
  ['sva', generateSvaFn],
])('generate %s', (name, generate) => {
  const { js } = generate(createGeneratorContext() as any)

  test('imports only splitProps and uncompiledStyle', () => {
    const imports = [...js.matchAll(/^import .*$/gm)].map((match) => match[0])
    expect(imports).toEqual([`import { splitProps, uncompiledStyle } from '../helpers.mjs';`])
  })

  test('carries none of the removed engine', () => {
    for (const removed of ['mergeCss', 'raw', 'resolve', 'merge', 'variantMap', 'getVariantProps', 'config,']) {
      expect(js, removed).not.toMatch(new RegExp(`\\b${removed}\\b`))
    }
  })

  test(`throws until compiled, naming ${name}`, () => {
    expect(js).toContain(`uncompiledStyle('${name}')`)
  })
})
