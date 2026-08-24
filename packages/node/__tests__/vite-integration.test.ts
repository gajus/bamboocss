import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { setupPostcss } from '../src/setup-config'
import { isStaticCompilerActive as isStaticCompilerActiveFromRoot } from '../src'
import { isStaticCompilerActive, markStaticCompilerActive } from '../src/static-compiler'
import { findViteConfig, hasUncompilableSources } from '../src/vite-integration'

/**
 * Which projects still author styles in a template the compiler does not fold.
 */
const projects: string[] = []

const project = (contents: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'bamboo-vite-integration-'))
  projects.push(dir)
  for (const [name, content] of Object.entries(contents)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}

afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('the static compiler boundary', () => {
  test('the lightweight subpath and established root exports share one realm flag', () => {
    const realm = globalThis as Record<symbol, unknown>
    const flag = Symbol.for('bamboocss.static-compiler')
    const previous = realm[flag]

    try {
      realm[flag] = false
      expect(isStaticCompilerActive()).toBe(false)
      expect(isStaticCompilerActiveFromRoot()).toBe(false)

      markStaticCompilerActive()
      expect(isStaticCompilerActive()).toBe(true)
      expect(isStaticCompilerActiveFromRoot()).toBe(true)
    } finally {
      if (previous === undefined) Reflect.deleteProperty(realm, flag)
      else realm[flag] = previous
    }
  })
})

describe('finding a Vite config', () => {
  test('any extension Vite itself accepts', () => {
    expect(findViteConfig(project({ 'vite.config.mts': '' }))).toMatch(/vite\.config\.mts$/)
    expect(findViteConfig(project({}))).toBeUndefined()
    // Not a Vite config. A project with only this builds with something else and runs Vitest.
    expect(findViteConfig(project({ 'vitest.config.ts': '' }))).toBeUndefined()
  })
})

describe('sources the compiler cannot reach', () => {
  test('named by the resolved include globs', () => {
    const cwd = project({ 'package.json': '{}' })

    expect(hasUncompilableSources({ cwd, include: ['./src/**/*.{js,svelte,ts}'] })).toBe(false)
    expect(hasUncompilableSources({ cwd, include: ['./src/**/*.{ts,tsx,mdx}'] })).toBe(false)
    expect(hasUncompilableSources({ cwd, include: ['./src/**/*.{html}'] })).toBe(true)
    expect(hasUncompilableSources({ cwd, include: ['./src/**/*.{js,jsx,ts,tsx}'] })).toBe(false)
  })

  test('or by the dependency list, which is all `bamboo init` has', () => {
    const svelte = project({ 'package.json': JSON.stringify({ devDependencies: { svelte: '^5' } }) })
    const react = project({ 'package.json': JSON.stringify({ dependencies: { react: '^19' } }) })

    expect(hasUncompilableSources({ cwd: svelte })).toBe(false)
    expect(hasUncompilableSources({ cwd: react })).toBe(false)
  })

  test('and a project with neither is not a reason to throw', () => {
    expect(hasUncompilableSources({ cwd: project({}) })).toBe(false)
    expect(hasUncompilableSources({ cwd: project({ 'package.json': 'not json' }) })).toBe(false)
  })
})

describe('bamboo init --postcss', () => {
  test('refuses: PostCSS is not a styling integration', async () => {
    const cwd = project({ 'package.json': '{}' })
    await expect(setupPostcss(cwd)).rejects.toThrow('@bamboocss/vite')
  })
})
