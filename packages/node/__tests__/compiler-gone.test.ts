import { createContext } from '@bamboocss/fixture'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { BambooContext } from '../src/create-context'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('native-only extraction', () => {
  test('does not ask the TypeScript compiler to parse source files', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bamboo-native-no-compiler-'))
    roots.push(cwd)
    mkdirSync(join(cwd, 'src'))
    const files = Array.from({ length: 40 }, (_, index) => join(cwd, `src/f${index}.tsx`))
    for (const file of files) {
      writeFileSync(file, `import { css } from 'styled-system/css'\nexport const style = css({ color: 'red' })\n`)
    }

    const ctx = createContext({ cwd, include: ['src/**/*.tsx'] }) as unknown as BambooContext
    ctx.getFiles = () => files
    const parseTypeScript = vi.spyOn(ctx.project, 'parseSourceFile')
    const materializeTypeScript = vi.spyOn(ctx.project, 'getSourceFile')

    expect(ctx.parseFiles().files).toEqual(files)
    expect(ctx.project.hasMaterializedCompiler()).toBe(false)
    expect(parseTypeScript).not.toHaveBeenCalled()
    expect(materializeTypeScript).not.toHaveBeenCalled()
    expect(ctx.parseFailures.size).toBe(0)
  })
})
