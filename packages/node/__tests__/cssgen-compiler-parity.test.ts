import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { Builder } from '../src/builder'
import { loadConfigAndCreateContext } from '../src/config'
import { cssgen } from '../src/cssgen'
import { generate } from '../src/generate'

/**
 * `bamboo cssgen` must emit the same compiled sheet Vite serves: observed recipes become
 * shared utility atoms, and the recipe layer is gone. The css-in-js-bench lane skipped `cva`
 * because cssgen still wrote named recipe rules the compiler does not.
 */
const temporaryDirectories = new Set<string>()
afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { force: true, recursive: true })
  temporaryDirectories.clear()
})

const createProject = () => {
  const directory = mkdtempSync(join(tmpdir(), 'bamboo-cssgen-compiler-'))
  temporaryDirectories.add(directory)
  writeFileSync(
    join(directory, 'bamboo.config.ts'),
    `export default {
  preflight: false,
  include: ['src/**/*.ts'],
  outdir: 'styled-system',
  theme: {
    extend: {
      recipes: {
        chip: {
          className: 'chip',
          base: { display: 'flex', color: 'red.300' },
          variants: { size: { sm: { fontSize: '14px' } } },
        },
      },
    },
  },
}
`,
  )
  mkdirSync(join(directory, 'src'), { recursive: true })
  writeFileSync(
    join(directory, 'src/ui.ts'),
    `import { css } from '../styled-system/css'
import { chip } from '../styled-system/recipes'

export const fromRecipe = chip({ size: 'sm' })
export const fromCss = css({ display: 'flex' })
`,
  )
  return directory
}

const emitCssgen = async (cwd: string) => {
  const outfile = join(cwd, 'from-cssgen.css')
  const ctx = await loadConfigAndCreateContext({ cwd })
  await cssgen(ctx, { cwd, outfile })
  return readFileSync(outfile, 'utf8')
}

describe('cssgen compiled sheet', () => {
  test('matches Vite builder emission and shares recipe declarations as atoms', async () => {
    const cwd = createProject()
    const fromCssgen = await emitCssgen(cwd)

    const builder = new Builder()
    await builder.setup({ cwd })
    await builder.emit()
    builder.extract()
    const fromVite = builder.toCss({ layerParams: true, includeRecipes: false })

    expect(fromCssgen).toBe(fromVite)
    expect(fromCssgen).toContain('.d_flex')
    expect(fromCssgen).toContain('.c_red\\.300')
    expect(fromCssgen).toContain('.fs_14px')
    expect(fromCssgen).not.toContain('.chip')
    expect(fromCssgen).not.toMatch(/@layer recipes\b/)
  })

  test('matches the CLI bamboo command', async () => {
    const cwd = createProject()
    const fromCssgen = await emitCssgen(cwd)

    await generate({ cwd }, join(cwd, 'bamboo.config.ts'))
    const fromGenerate = readFileSync(join(cwd, 'styled-system/styles.css'), 'utf8')

    expect(fromGenerate).toBe(fromCssgen)
  })

  test('splitting omits the recipe layer and removes leftovers from a previous run', async () => {
    const cwd = createProject()
    const stylesDir = join(cwd, 'styled-system/styles')
    mkdirSync(join(stylesDir, 'recipes'), { recursive: true })
    writeFileSync(join(stylesDir, 'recipes.css'), "@import './recipes/chip.css';\n")
    writeFileSync(join(stylesDir, 'recipes/chip.css'), '.chip { display: flex }\n')

    const ctx = await loadConfigAndCreateContext({ cwd })
    await cssgen(ctx, { cwd, splitting: true })

    const index = readFileSync(join(cwd, 'styled-system/styles.css'), 'utf8')
    expect(index).toContain('@layer reset, base, tokens, utilities;')
    expect(index).not.toMatch(/recipes/)
    expect(readFileSync(join(stylesDir, 'utilities.css'), 'utf8')).toContain('.d_flex')
    expect(existsSync(join(stylesDir, 'recipes.css'))).toBe(false)
    expect(existsSync(join(stylesDir, 'recipes'))).toBe(false)
  })
})
