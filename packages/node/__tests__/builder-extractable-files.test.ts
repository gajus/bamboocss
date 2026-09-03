import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'
import { Builder } from '../src/builder'

const temporaryDirectories = new Set<string>()
afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { force: true, recursive: true })
})

const createProject = () => {
  const directory = mkdtempSync(join(tmpdir(), 'bamboo-builder-extractable-'))
  temporaryDirectories.add(directory)
  mkdirSync(join(directory, 'src'), { recursive: true })
  writeFileSync(
    join(directory, 'bamboo.config.ts'),
    `export default { include: ['src/**/*.ts'], outdir: 'styled-system', preflight: false }\n`,
  )
  writeFileSync(
    join(directory, 'src/styles.ts'),
    `import { css, cva } from '../styled-system/css'\nconst styles = { color: 'red' }\nstyles.color = 'green'\nexport const className = css(styles)\nexport const badge = cva({ base: { backgroundColor: 'blue' } })\n`,
  )
  writeFileSync(
    join(directory, 'src/consumer.ts'),
    `import { className } from './styles'\nexport const used = className\n`,
  )
  writeFileSync(join(directory, 'src/unrelated.ts'), `export const unrelated = true\n`)
  return directory
}

test('a cold Builder pass parses only files that can reach bamboo', async () => {
  const builder = new Builder()
  await builder.setup({ cwd: createProject(), atomOrigins: true })
  const context = builder.getContextOrThrow()
  const parseFile = vi.spyOn(context, 'parseFile')
  const parseTypeScript = vi.spyOn(context.project, 'parseSourceFile')

  builder.extract()

  expect(parseFile.mock.calls.map(([file]) => basename(file))).toEqual(['consumer.ts', 'styles.ts'])
  expect(parseTypeScript).not.toHaveBeenCalled()
  const nativeCss = builder.toCss()
  expect(nativeCss).toContain('color: red')
  expect(nativeCss).toContain('background-color: blue')
  expect([...builder.getAtomOrigins().values()]).toContainEqual({
    filePath: join(context.config.cwd, 'src/styles.ts'),
    line: 4,
    column: 26,
  })

  process.env.BAMBOO_DISABLE_NATIVE_EXTRACTION = '1'
  try {
    const typescriptBuilder = new Builder()
    await typescriptBuilder.setup({ cwd: context.config.cwd })
    typescriptBuilder.extract()
    expect(typescriptBuilder.toCss()).toBe(nativeCss)
  } finally {
    delete process.env.BAMBOO_DISABLE_NATIVE_EXTRACTION
  }
})
