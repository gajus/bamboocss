import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'
import { Builder } from '../src/builder'

const temporaryDirectories = new Set<string>()
afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { force: true, recursive: true })
})

const createCorpus = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-parity-'))
  temporaryDirectories.add(cwd)
  mkdirSync(join(cwd, 'src'))
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    `export default {
      preflight: false,
      include: ['src/**/*.{ts,tsx}'],
      outdir: 'styled-system',
      theme: {
        extend: {
          recipes: {
            button: {
              className: 'button',
              base: { display: 'inline-flex' },
              variants: { size: { sm: { fontSize: '14px' } } },
            },
          },
        },
      },
      patterns: {
        extend: {
          stack: {
            properties: { gap: { type: 'property', value: 'gap' } },
            transform(props) { return { display: 'flex', flexDirection: 'column', ...props } },
          },
        },
      },
    }\n`,
  )
  const sources = {
    'static.ts': `import { css as c, cva, cx, sva } from '../styled-system/css'
const tone = 'red'
const base = { display: 'flex', padding: { base: '1', md: '2' } }
export const utility = c({ ...base, color: tone, gridTemplateAreas: \`'a'\n  'b'\` })
export const recipe = cva({ base: { borderWidth: '1px' }, variants: { active: { true: { opacity: 1 } } } })
export const slots = sva({ slots: ['root', 'icon'], base: { root: { gap: '2' }, icon: { color: 'blue' } } })
export const joined = cx(utility, c({ margin: 2 }))
`,
    'configured.ts': `import { button } from '../styled-system/recipes'
import { stack } from '../styled-system/patterns'
export const configuredRecipe = button({ size: 'sm' })
export const configuredPattern = stack({ gap: '4' })
`,
    'shared.ts': `export const shared = { backgroundColor: 'purple' }\n`,
    'cross-file.ts': `import { css } from '../styled-system/css'
import { shared } from './shared'
export const crossFile = css(shared)
`,
    'dynamic.ts': `import { css } from '../styled-system/css'
export const dynamic = (color: string) => css({ color })
`,
    'component.tsx': `export const component = <Button size="sm" />\n`,
    'unrelated.ts': `export const value = 42\n`,
  }
  for (const [filename, source] of Object.entries(sources)) writeFileSync(join(cwd, 'src', filename), source)
  return cwd
}

const createDeadCallProject = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-diagnostic-'))
  temporaryDirectories.add(cwd)
  mkdirSync(join(cwd, 'src'))
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    `export default {
      include: ['src/**/*.ts'],
      outdir: 'styled-system',
      patterns: { extend: { stack: { transform: (props) => props } } },
    }\n`,
  )
  writeFileSync(
    join(cwd, 'src/invalid.ts'),
    `import { absent } from '../styled-system/patterns'\nexport const value = absent({ gap: '2' })\n`,
  )
  return cwd
}

const extract = async (cwd: string, typescriptOnly: boolean) => {
  if (typescriptOnly) process.env.BAMBOO_DISABLE_NATIVE_EXTRACTION = '1'
  try {
    const builder = new Builder()
    await builder.setup({ cwd, atomOrigins: true })
    const parseTypeScript = vi.spyOn(builder.getContextOrThrow().project, 'parseSourceFile')
    builder.extract()
    return {
      css: builder.toCss(),
      origins: builder.getAtomOrigins(),
      typescriptFiles: parseTypeScript.mock.calls.map(([file]) => file),
    }
  } finally {
    if (typescriptOnly) delete process.env.BAMBOO_DISABLE_NATIVE_EXTRACTION
  }
}

const extractFailure = async (cwd: string, typescriptOnly: boolean) => {
  if (typescriptOnly) process.env.BAMBOO_DISABLE_NATIVE_EXTRACTION = '1'
  try {
    const builder = new Builder()
    await builder.setup({ cwd })
    const parseTypeScript = vi.spyOn(builder.getContextOrThrow().project, 'parseSourceFile')
    let message = ''
    try {
      builder.extract()
    } catch (error) {
      message = (error as Error).message
    }
    return { message, typescriptFiles: parseTypeScript.mock.calls.map(([file]) => file) }
  } finally {
    if (typescriptOnly) delete process.env.BAMBOO_DISABLE_NATIVE_EXTRACTION
  }
}

test('native-safe and TypeScript-fallback files produce the same corpus stylesheet and origins', async () => {
  const cwd = createCorpus()
  const native = await extract(cwd, false)
  const typescript = await extract(cwd, true)

  expect(native.css).toBe(typescript.css)
  expect(native.origins).toEqual(typescript.origins)
  expect(native.typescriptFiles.length).toBeGreaterThan(0)
  expect(native.typescriptFiles.length).toBeLessThan(typescript.typescriptFiles.length)
})

test('an unknown generated entrypoint retains TypeScript diagnostics', async () => {
  const cwd = createDeadCallProject()
  const native = await extractFailure(cwd, false)
  const typescript = await extractFailure(cwd, true)

  expect(native.message).not.toBe('')
  expect(native.message).toBe(typescript.message)
  expect(native.typescriptFiles).toHaveLength(1)
})
