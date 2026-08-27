import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { forEachDescendant, is } from '../src/node'
import { Project } from '../src/project'

/**
 * The four calls every consumer makes — `createSourceFile`, `reloadSourceFile`,
 * `removeSourceFile`, `addSourceFile` — over a compiler that owns its own tree in another
 * process.
 *
 * ts-morph could be handed a string because its filesystem lived here. These have to say what
 * moved and let the Go process re-read, which is a different failure mode: the call can succeed
 * while the program still holds the previous bytes. So every assertion below reads a value back
 * out of the tree rather than trusting the call returned.
 */
let root: string
let project: Project

const file = (relative: string) => path.join(root, relative)

const write = (relative: string, contents: string) => {
  const target = file(relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
  return target
}

/** Every string literal the file's tree currently holds — a cheap probe for "which bytes?". */
const literalsIn = (filePath: string): string[] => {
  const sourceFile = project.getSourceFile(filePath)
  if (!sourceFile) return []
  const found: string[] = []
  forEachDescendant(sourceFile, (node) => {
    if (is.isStringLiteral(node)) found.push(node.text)
  })
  return found
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bamboo-lifecycle-'))
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        jsx: 'preserve',
        module: 'preserve',
        moduleResolution: 'bundler',
        noEmit: true,
        target: 'esnext',
      },
      include: ['src'],
    }),
  )
  write('src/app.ts', `export const a = 'original'\n`)
  project = new Project({ cwd: root, tsConfigFilePath: path.join(root, 'tsconfig.json') })
  // Installed, not discovered. A project holds the files it is given — the compiler is opened
  // on a config naming exactly those, so an `include` glob no longer populates it. That is the
  // contract every caller already used: the parser has always set `skipAddingFilesFromTsConfig`
  // and added its inventory itself, and letting the compiler adopt a tree instead costs about
  // 2 GB per project. See `Project#writeConfig`.
  project.createSourceFile(file('src/app.ts'))
})

afterEach(() => {
  project.dispose()
  rmSync(root, { force: true, recursive: true })
})

describe('reloadSourceFile', () => {
  test('the program sees the new bytes, not the ones it already had', () => {
    expect(literalsIn(file('src/app.ts'))).toEqual(['original'])

    writeFileSync(file('src/app.ts'), `export const a = 'edited'\n`)
    project.reloadSourceFile(file('src/app.ts'))

    expect(literalsIn(file('src/app.ts'))).toEqual(['edited'])
  })

  /** Without this the call is a no-op that looks like a success. */
  test('an edit not announced is an edit not seen', () => {
    writeFileSync(file('src/app.ts'), `export const a = 'edited'\n`)

    expect(literalsIn(file('src/app.ts'))).toEqual(['original'])
  })
})

describe('createSourceFile', () => {
  test('a file written after the project opened joins the program', () => {
    expect(project.getSourceFile(file('src/late.ts'))).toBeUndefined()

    write('src/late.ts', `export const b = 'arrived'\n`)
    project.createSourceFile(file('src/late.ts'))

    expect(literalsIn(file('src/late.ts'))).toEqual(['arrived'])
  })
})

describe('removeSourceFile', () => {
  test('a deleted file leaves the program', () => {
    expect(project.getSourceFile(file('src/app.ts'))).toBeDefined()

    unlinkSync(file('src/app.ts'))

    expect(project.removeSourceFile(file('src/app.ts'))).toBe(true)
    expect(project.getSourceFile(file('src/app.ts'))).toBeUndefined()
  })

  test('reports whether the project was actually holding it', () => {
    expect(project.removeSourceFile(file('src/never-existed.ts'))).toBe(false)
  })
})

describe('addSourceFile', () => {
  test('installs content for a path with nothing behind it', () => {
    project.addSourceFile(file('src/virtual.ts'), `export const c = 'synthesized'\n`)

    expect(literalsIn(file('src/virtual.ts'))).toEqual(['synthesized'])
  })

  /**
   * The bundler case: same filename, different bytes. Vite hands over a module with JSX already
   * lowered, so the overlay has to win over the disk or the parse reads source that no longer
   * describes what is being built.
   */
  test('overrides a real file that exists under the same path', () => {
    expect(literalsIn(file('src/app.ts'))).toEqual(['original'])

    project.addSourceFile(file('src/app.ts'), `export const a = 'transformed'\n`)

    expect(literalsIn(file('src/app.ts'))).toEqual(['transformed'])
  })

  test('a second add replaces the first', () => {
    project.addSourceFile(file('src/app.ts'), `export const a = 'first'\n`)
    project.addSourceFile(file('src/app.ts'), `export const a = 'second'\n`)

    expect(literalsIn(file('src/app.ts'))).toEqual(['second'])
  })

  /**
   * The transform path adds every module before parsing it, and on a 6,307-file build 6,001 of
   * those were byte-identical to what the project already held. Re-adding the same text must not
   * cost a snapshot update, or the bundler pays for a re-read per module per build.
   */
  test('re-adding identical text is a no-op', () => {
    const contents = `export const a = 'stable'\n`
    project.addSourceFile(file('src/app.ts'), contents)
    const first = project.getSourceFile(file('src/app.ts'))

    project.addSourceFile(file('src/app.ts'), contents)

    expect(project.getSourceFile(file('src/app.ts'))).toBe(first)
    expect(literalsIn(file('src/app.ts'))).toEqual(['stable'])
  })

  test('removing an added file drops the override, exposing the file underneath', () => {
    project.addSourceFile(file('src/app.ts'), `export const a = 'override'\n`)
    expect(literalsIn(file('src/app.ts'))).toEqual(['override'])

    project.removeSourceFile(file('src/app.ts'))
    project.createSourceFile(file('src/app.ts'))

    expect(literalsIn(file('src/app.ts'))).toEqual(['original'])
  })

  test('reloading drops the override, because the disk is the newer truth', () => {
    project.addSourceFile(file('src/app.ts'), `export const a = 'override'\n`)
    writeFileSync(file('src/app.ts'), `export const a = 'from disk'\n`)

    project.reloadSourceFile(file('src/app.ts'))

    expect(literalsIn(file('src/app.ts'))).toEqual(['from disk'])
  })
})

/**
 * What the parser needs from a project besides its trees. ts-morph answered these through
 * `getFileSystem()` and `getModuleResolutionHost()`; here they are on the project itself,
 * because the filesystem is a delegate rather than an object this process owns.
 */
describe('project surface', () => {
  test('reports the compiler options the Go compiler parsed', () => {
    const options = project.getCompilerOptions()

    expect(options).toBeDefined()
    expect(options?.noEmit).toBe(true)
  })

  test('reports the directory it is rooted at', () => {
    expect(project.getCurrentDirectory()).toBe(root)
  })

  /**
   * The read has to go through the same order the compiler does. A caller that reaches the disk
   * directly sees a module as written rather than as transformed, which is the whole point of
   * the overlay.
   */
  test('reads through the overlay, not past it', () => {
    expect(project.readFile(file('src/app.ts'))).toBe(`export const a = 'original'\n`)

    project.addSourceFile(file('src/app.ts'), `export const a = 'installed'\n`)

    expect(project.readFile(file('src/app.ts'))).toBe(`export const a = 'installed'\n`)
  })

  test('reading a path with nothing behind it answers undefined rather than throwing', () => {
    expect(project.readFile(file('src/absent.ts'))).toBeUndefined()
  })

  test('realpath answers for a path that does not resolve rather than throwing', () => {
    expect(project.realpath(file('src/absent.ts'))).toBe(file('src/absent.ts'))
  })
})
