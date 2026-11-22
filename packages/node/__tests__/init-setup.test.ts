// @vitest-environment node
// Writes and reads real files in temporary projects, which happy-dom's module reading does not need
// but its `process.cwd()` does not answer as Node does.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { BambooContext } from '../src/create-context'
import { setupGitIgnore } from '../src/git-ignore'
import { detectInitProject, setupConfig } from '../src/setup-config'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

/** A folder on disk holding `files`, an object written as JSON. Its path is canonical. */
const folder = (files: Record<string, string | object> = {}) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-init-')))
  roots.push(root)
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), typeof contents === 'string' ? contents : JSON.stringify(contents))
  }
  return root
}

const dependingOn = (...names: string[]) => ({
  name: 'app',
  dependencies: Object.fromEntries(names.map((name) => [name, '*'])),
})

describe('the include `bamboo init` writes', () => {
  test.each([
    ['nothing it knows', [], {}, 'vite', ['./src/**/*.{js,jsx,ts,tsx}', './pages/**/*.{js,jsx,ts,tsx}']],
    ['React Router', ['react', '@react-router/dev'], {}, 'react-router', ['./app/**/*.{js,jsx,ts,tsx}']],
    ['TanStack Start', ['react', '@tanstack/react-start'], {}, 'tanstack-start', ['./src/**/*.{js,jsx,ts,tsx}']],
    ['Vue', ['vue'], {}, 'vue', ['./src/**/*.{js,jsx,ts,tsx,vue}']],
    ['SvelteKit', ['svelte', '@sveltejs/kit'], {}, 'svelte', ['./src/**/*.{js,jsx,ts,tsx,svelte}']],
    ['Astro with Vue islands', ['astro', 'vue'], {}, 'astro', ['./src/**/*.{js,jsx,ts,tsx,vue,astro}']],
    ['Solid', ['solid-js'], {}, 'solidjs', ['./src/**/*.{js,jsx,ts,tsx}', './pages/**/*.{js,jsx,ts,tsx}']],
    [
      'Nuxt with its folders at the root',
      ['nuxt', 'vue'],
      { 'app.vue': '<template />' },
      'nuxt',
      [
        './app.vue',
        './components/**/*.{js,jsx,ts,tsx,vue}',
        './layouts/**/*.{js,jsx,ts,tsx,vue}',
        './pages/**/*.{js,jsx,ts,tsx,vue}',
      ],
    ],
    ['Nuxt 4 with `app/`', ['nuxt'], { 'app/app.vue': '<template />' }, 'nuxt', ['./app/**/*.{js,jsx,ts,tsx,vue}']],
    [
      'Storybook with a stories folder',
      ['react', 'storybook'],
      { 'stories/button.stories.tsx': '' },
      'vite',
      ['./src/**/*.{js,jsx,ts,tsx}', './pages/**/*.{js,jsx,ts,tsx}', './stories/**/*.{js,jsx,ts,tsx}'],
    ],
  ] as const)('for %s', (_name, names, files, guide, include) => {
    const cwd = folder({ 'package.json': dependingOn(...names), ...files })

    expect(detectInitProject(cwd)).toMatchObject({ guide, include })
  })

  test('is what the config it creates says', async () => {
    const cwd = folder({ 'package.json': dependingOn('react', '@react-router/dev'), 'tsconfig.json': '{}' })

    expect(await setupConfig(cwd)).toMatchObject({ framework: 'React Router', guide: 'react-router' })
    expect(readFileSync(join(cwd, 'bamboo.config.ts'), 'utf8')).toMatch(
      /include: \[\s*["']\.\/app\/\*\*\/\*\.\{js,jsx,ts,tsx\}["'],?\s*\]/,
    )
  })
})

describe('the .gitignore `bamboo init` updates', () => {
  const contextFor = (cwd: string, outdir = 'styled-system') =>
    ({ config: { cwd, outdir, gitignore: true } }) as unknown as BambooContext
  const read = (file: string) => readFileSync(file, 'utf8')

  // Run from somewhere else entirely: `--cwd` used to be ignored, and the shell's folder was read.
  test("is the project's, wherever the command ran from", () => {
    const repo = folder({ '.git/HEAD': '', 'apps/web/package.json': '{}' })

    setupGitIgnore(contextFor(join(repo, 'apps/web')))

    expect(read(join(repo, 'apps/web/.gitignore'))).toBe('## Bamboo\nstyled-system\n')
    expect(existsSync(join(repo, '.gitignore'))).toBe(false)
  })

  // Anchored to the folder the file is in, so the line says where in the repository the outdir is.
  test("names the outdir from the file's folder when the file is the repository's", () => {
    const repo = folder({ '.git/HEAD': '', '.gitignore': 'node_modules', 'apps/web/package.json': '{}' })

    setupGitIgnore(contextFor(join(repo, 'apps/web'), 'src/styled-system'))

    expect(read(join(repo, '.gitignore'))).toBe('node_modules\n\n## Bamboo\napps/web/src/styled-system\n')
  })

  test('leaves a file that ignores the outdir already alone', () => {
    // A name with no `/` ignores that name at any depth.
    const repo = folder({ '.git/HEAD': '', '.gitignore': 'node_modules\n/styled-system/\n' })
    const nested = folder({ '.git/HEAD': '', '.gitignore': 'styled-system\n', 'apps/web/package.json': '{}' })

    setupGitIgnore(contextFor(repo))
    setupGitIgnore(contextFor(join(nested, 'apps/web'), 'src/styled-system'))

    expect(read(join(repo, '.gitignore'))).toBe('node_modules\n/styled-system/\n')
    expect(read(join(nested, '.gitignore'))).toBe('styled-system\n')
  })

  // Whose a parent's is cannot be told: a home folder's, say.
  test("is the project's own outside any repository", () => {
    const parent = folder({ '.gitignore': 'unrelated\n', 'app/package.json': '{}' })

    setupGitIgnore(contextFor(join(parent, 'app')))

    expect(read(join(parent, '.gitignore'))).toBe('unrelated\n')
    expect(read(join(parent, 'app/.gitignore'))).toBe('## Bamboo\nstyled-system\n')
  })

  test('does not reach past the repository for one', () => {
    const outside = folder({ '.gitignore': 'unrelated\n', 'repo/.git/HEAD': '' })

    setupGitIgnore(contextFor(join(outside, 'repo')))

    expect(read(join(outside, '.gitignore'))).toBe('unrelated\n')
    expect(read(join(outside, 'repo/.gitignore'))).toBe('## Bamboo\nstyled-system\n')
  })
})
