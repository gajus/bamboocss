import { createGeneratorContext } from '@bamboocss/fixture'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

/**
 * The generated recipe modules load, and every recipe they export throws until compiled — in
 * every naming mode, and for slot recipes with and without a `root` anchor.
 *
 * Loaded from disk rather than read as text, so an import that does not resolve fails here:
 * the runtime is now a callable plus `splitVariantProps`, and the thing most likely to break
 * it is a helper it imports going missing from `helpers.mjs`.
 *
 * This used to be a class-parity check — `classNameMap` against the emitted stylesheet, after a
 * bug formatted anchor-less slot classes twice. The runtime no longer carries a class of its own,
 * so there is nothing left for it to disagree about; `checkNamingAgreement` covers the build.
 */

const RECIPES = {
  /** No `root` slot. */
  menu: {
    className: 'menu',
    slots: ['trigger', 'positioner', 'content'],
    base: { trigger: { display: 'flex' }, positioner: { zIndex: '1' }, content: { color: 'red.300' } },
  },
  /** Declares `root`. */
  combobox: {
    className: 'combobox',
    slots: ['root', 'control', 'content'],
    base: { root: { display: 'flex' }, control: { color: 'red.300' }, content: { padding: '2' } },
  },
} as const

const build = (options: { hash?: boolean; prefix?: string }) =>
  createGeneratorContext({
    ...options,
    preflight: false,
    theme: { extend: { slotRecipes: RECIPES } },
    staticCss: { recipes: { menu: ['*'], combobox: ['*'] } },
  } as any) as any

/**
 * Write the generated system to disk and import it, so the runtime answers for itself.
 *
 * Artifacts carry their own `dir`, already including the outdir; the few without one — the
 * helpers the recipes import as `../helpers` — belong at its root.
 */
const written: string[] = []

const loadRuntime = async (ctx: any) => {
  // Inside the project: vitest resolves a dynamic import through vite, which will not load a
  // file outside the root however it is spelled.
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.bamboo-recipe-runtime-'))
  written.push(root)
  for (const artifact of ctx.getArtifacts() ?? []) {
    for (const file of artifact.files ?? []) {
      if (!file.code) continue
      const path = join(root, ...(artifact.dir ?? ['styled-system']), file.file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, file.code)
    }
  }
  // @vite-ignore: the path is a temp dir, so vitest must not try to resolve it at transform time
  return import(/* @vite-ignore */ pathToFileURL(join(root, 'styled-system', 'recipes', 'index.mjs')).href)
}

afterAll(() => written.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const MATRIX: [string, { hash?: boolean; prefix?: string }][] = [
  ['plain', {}],
  ['hashed', { hash: true }],
  ['prefixed', { prefix: 'bam' }],
  ['hashed and prefixed', { hash: true, prefix: 'bam' }],
]

describe('generated recipe runtime', () => {
  test.each(MATRIX)('loads, and a slot recipe throws until compiled, in a %s build', async (_label, options) => {
    const ctx = build(options)
    const runtime = await loadRuntime(ctx)
    expect(() => runtime.menu({})).toThrow('was not compiled')
    expect(() => runtime.combobox({})).toThrow('was not compiled')
  })

  test.each(MATRIX)('splitVariantProps still works in a %s build', async (_label, options) => {
    const ctx = build(options)
    const runtime = await loadRuntime(ctx)
    expect(runtime.menu.splitVariantProps({ id: 'x' })).toEqual([{}, { id: 'x' }])
  })
})
