// @vitest-environment node
// The bundle a scan is checked against imports the config it writes, which the repo's default
// `happy-dom` environment cannot resolve outside the project.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { bundle } from '../src/bundle-config'
import { getConfigDependencies } from '../src/get-mod-deps'
import { convertTsPathsToRegexes } from '../src/ts-config-paths'

/**
 * What the config imports, read off its source before it is loaded: `vite dev` declares it to Vite
 * so that editing one restarts the server, and a config that failed to load is watched through it.
 */
describe('config dependencies', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
  })

  /** A project on disk. Its root is canonical, as the paths a scan returns are. */
  const project = (files: Record<string, string | object>) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-config-deps-')))
    roots.push(root)
    for (const [file, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), typeof contents === 'string' ? contents : JSON.stringify(contents))
    }
    return root
  }

  /** A workspace package linked into `node_modules`, as pnpm and npm link one. A junction needs no privilege on Windows. */
  const link = (root: string, name: string, target: string) => {
    mkdirSync(dirname(join(root, 'node_modules', name)), { recursive: true })
    symlinkSync(join(root, target), join(root, 'node_modules', name), 'junction')
  }

  const relativeTo = (root: string, files: Iterable<string>) =>
    [...files].map((file) => relative(root, file).replaceAll('\\', '/')).sort()

  /** `@bamboocss/dev` as it is installed: its types beside its builds, importing another package's. */
  const installedDev = {
    'node_modules/@bamboocss/dev/package.json': {
      name: '@bamboocss/dev',
      main: 'dist/index.cjs',
      module: 'dist/index.mjs',
      types: 'dist/index.d.cts',
      exports: {
        '.': {
          types: './dist/index.d.cts',
          require: './dist/index.cjs',
          import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
        },
      },
    },
    'node_modules/@bamboocss/dev/dist/index.mjs': 'export const defineConfig = (config) => config\n',
    'node_modules/@bamboocss/dev/dist/index.cjs': 'exports.defineConfig = (config) => config\n',
    'node_modules/@bamboocss/dev/dist/index.d.mts': `import type { Config } from '@bamboocss/types'\nexport declare const defineConfig: (config: Config) => Config\n`,
    'node_modules/@bamboocss/dev/dist/index.d.cts': `import type { Config } from '@bamboocss/types'\nexport declare const defineConfig: (config: Config) => Config\n`,
    'node_modules/@bamboocss/types/package.json': { name: '@bamboocss/types', types: 'dist/index.d.ts' },
    'node_modules/@bamboocss/types/dist/index.d.ts': 'export interface Config {}\n',
  }

  /**
   * A config importing the ways a package can be reached: installed, a workspace package whose
   * `main` is its source, one whose `exports` give its source to an import and its build to a
   * `require`, a built one, and a `#` import of the config's own package.
   */
  const workspace = () => {
    const root = project({
      ...installedDev,
      'package.json': { name: 'app', private: true, imports: { '#theme/*': './theme/*.ts' } },
      'bamboo.config.ts': [
        `import { defineConfig } from '@bamboocss/dev'`,
        `import preset from '@acme/preset'`,
        `import { tokens } from '@acme/tokens/tokens'`,
        `import built from '@acme/built'`,
        `import { colors } from '#theme/colors'`,
        `const { recipes } = require('@acme/tokens/recipes')`,
        `export default defineConfig({ presets: [preset, built], theme: { tokens: { ...tokens, colors }, recipes } })`,
        ``,
      ].join('\n'),
      'theme/colors.ts': `export const colors = { brand: { value: 'red' } }\n`,
      'packages/preset/package.json': { name: '@acme/preset', main: 'src/index.ts' },
      'packages/preset/src/index.ts': `import { radii } from './radii'\nexport default { theme: { tokens: { radii } } }\n`,
      'packages/preset/src/radii.ts': `export const radii = { sm: { value: '2px' } }\n`,
      'packages/tokens/package.json': {
        name: '@acme/tokens',
        exports: {
          './*': { types: './dist/*.d.ts', source: './src/*.ts', import: './src/*.ts', require: './dist/*.cjs' },
        },
      },
      'packages/tokens/src/tokens.ts': `export const tokens = { spacing: { 1: { value: '4px' } } }\n`,
      'packages/tokens/src/recipes.ts': 'export const recipes = {}\n',
      'packages/tokens/dist/tokens.d.ts': 'export declare const tokens: object\n',
      'packages/tokens/dist/recipes.d.ts': 'export declare const recipes: object\n',
      'packages/tokens/dist/recipes.cjs': 'exports.recipes = {}\n',
      'packages/built/package.json': {
        name: '@acme/built',
        main: './dist/index.js',
        module: './dist/index.mjs',
        types: './dist/index.d.mts',
      },
      'packages/built/dist/index.mjs': 'export default {}\n',
      'packages/built/dist/index.js': 'module.exports = {}\n',
      'packages/built/dist/index.d.mts': `import type { Config } from '@bamboocss/types'\ndeclare const preset: Config\nexport default preset\n`,
    })
    for (const name of ['preset', 'tokens', 'built']) link(root, `@acme/${name}`, `packages/${name}`)
    return root
  }

  test('follows a workspace package into its TypeScript source, as the config bundle reads it', async () => {
    const root = workspace()
    const config = join(root, 'bamboo.config.ts')

    // The real paths: a workspace package is linked into `node_modules`, which Vite does not watch.
    expect(relativeTo(root, getConfigDependencies(config).deps)).toEqual([
      'bamboo.config.ts',
      'packages/preset/src/index.ts',
      'packages/preset/src/radii.ts',
      'packages/tokens/src/tokens.ts',
      'theme/colors.ts',
    ])

    // Nothing the bundle does not run: its `require` reads the build, which is not followed, and
    // so is every installed package and the built preset, which the bundle's inputs declare once
    // the config has loaded.
    const { dependencies } = await bundle(config, root)
    const bundled = dependencies.map((file) => realpathSync.native(resolve(root, file)))
    expect(relativeTo(root, bundled)).toEqual(
      expect.arrayContaining(relativeTo(root, getConfigDependencies(config).deps)),
    )
    expect(relativeTo(root, bundled)).toContain('packages/tokens/dist/recipes.cjs')
  })

  // They were followed for the types an import has, which is never what the config runs:
  // `@bamboocss/dev` alone led to two of them.
  test('does not follow a package into its declaration files', () => {
    const root = project({
      ...installedDev,
      'bamboo.config.ts': `import { defineConfig } from '@bamboocss/dev'\nexport default defineConfig({})\n`,
    })

    expect(relativeTo(root, getConfigDependencies(join(root, 'bamboo.config.ts')).deps)).toEqual(['bamboo.config.ts'])
  })

  test("reads the tsconfig's paths and baseUrl before node_modules", () => {
    const root = project({
      'bamboo.config.ts': `import { a } from '@theme/a'\nimport { b } from 'shared/b'\nexport default { a, b }\n`,
      'src/theme/a.ts': `export const a = 1\n`,
      'src/shared/b.ts': `export const b = 2\n`,
      // A package by the alias's name is not what the import reads.
      'node_modules/@theme/a/package.json': { name: '@theme/a', main: 'index.ts' },
      'node_modules/@theme/a/index.ts': `export const a = 0\n`,
    })
    const pathMappings = convertTsPathsToRegexes({ '@theme/*': ['./src/theme/*'] }, root)
    const { deps } = getConfigDependencies(
      join(root, 'bamboo.config.ts'),
      { pathMappings },
      { baseUrl: join(root, 'src') },
    )

    expect(relativeTo(root, deps)).toEqual(['bamboo.config.ts', 'src/shared/b.ts', 'src/theme/a.ts'])
  })

  // Loading the compiler to resolve them was a third of a small app's `vite dev` start, and made
  // TypeScript a dependency of every install.
  test('resolves a bare import without loading TypeScript', () => {
    expect(getConfigDependencies(join(workspace(), 'bamboo.config.ts')).deps.size).toBeGreaterThan(1)

    // Loaded at any point in this process, by this scan or an earlier one, it stays in the cache.
    const require = createRequire(import.meta.url)
    expect(Object.keys(require.cache)).not.toContain(require.resolve('typescript'))
  })
})
