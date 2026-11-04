import glob from 'fast-glob'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { globIgnore, nodeRuntime, sourceMatcher } from '../src/node-runtime'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'bamboo-source-glob-')))
afterAll(() => rmSync(root, { force: true, recursive: true }))

const link = process.platform === 'win32' ? 'junction' : 'dir'
/** As the glob spells a path, which is with `/` on every platform. */
const path = (...segments: string[]) => join(...segments).replaceAll('\\', '/')

const files = (cwd: string, entries: string[]) => {
  for (const entry of entries) {
    mkdirSync(join(cwd, entry, '..'), { recursive: true })
    writeFileSync(join(cwd, entry), '')
  }
  return cwd
}

/**
 * Globs over a loop, each in a process of its own. The glob is synchronous, so a walk that never
 * ended would hang this worker — and a CI job with it, until the job's own limit — not fail it.
 */
const globApart = (
  inputs: Record<string, { cwd: string; include: string[] }>,
): { files: Record<string, string[]>; linked: Record<string, string[]> } => {
  const { BAMBOO_DEBUG: _, ...env } = process.env
  const script = `
    import { nodeRuntime } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../src/node-runtime.ts')).href)}
    const inputs = ${JSON.stringify(inputs)}
    const files = {}
    const linked = {}
    for (const [name, input] of Object.entries(inputs)) {
      linked[name] = []
      files[name] = nodeRuntime.fs.glob({ ...input, linked: linked[name] })
    }
    process.stdout.write(JSON.stringify({ files, linked }))
  `
  const cli = createRequire(import.meta.url).resolve('tsx/cli')
  return JSON.parse(execFileSync(process.execPath, [cli, '-e', script], { encoding: 'utf8', env, timeout: 30_000 }))
}

/**
 * The source glob follows symbolic links — a workspace package, a folder linked into `src` — and a
 * link back into a folder it was reading took it round again, lap after lap, until the system would
 * resolve no longer a chain of links: each file returned some thirty times. Two such links on the
 * way doubled the laps each time round, and the build hung at the glob, with nothing to say why.
 *
 * Each real folder is entered once now, so a link to one the walk reads already is read as empty,
 * as a loop's is: the folder is found where the walk reached it otherwise.
 */
describe('the source glob, round a loop', () => {
  const cycle = files(join(root, 'cycle'), ['src/a/app.tsx', 'x.css'])
  symlinkSync(join(cycle, 'src'), join(cycle, 'src/a/loop'), link)
  symlinkSync(join(cycle, 'src/a'), join(cycle, 'src/alias'), link)

  const mutual = files(join(root, 'mutual'), ['src/a/a.tsx', 'src/b/b.tsx'])
  symlinkSync(join(mutual, 'src/b'), join(mutual, 'src/a/to-b'), link)
  symlinkSync(join(mutual, 'src/a'), join(mutual, 'src/b/to-a'), link)

  // Every project under `tmpdir()` on macOS is reached through a link: `/var` is `/private/var`.
  const project = files(join(root, 'real-project'), ['src/a/app.tsx'])
  symlinkSync(join(project, 'src'), join(project, 'src/a/loop'), link)
  const linked = join(root, 'linked-project')
  symlinkSync(project, linked, link)

  const above = files(join(root, 'above'), ['src/app.tsx'])
  symlinkSync(above, join(above, 'src/up'), link)

  let results: Record<string, string[]>
  let reported: Record<string, string[]>
  beforeAll(() => {
    ;({ files: results, linked: reported } = globApart({
      above: { cwd: above, include: ['src/**/*.tsx'] },
      beside: { cwd: cycle, include: ['src/*/*.tsx', 'src/a/loop/**/*.tsx'] },
      cycle: { cwd: cycle, include: ['src/**/*.tsx'] },
      cycleOnly: { cwd: cycle, include: ['src/*/loop/**/*.tsx'] },
      fromLoop: { cwd: cycle, include: ['src/a/loop/**/*.tsx'] },
      linked: { cwd: linked, include: ['src/**/*.tsx'] },
      merged: { cwd: cycle, include: ['*.css', 'src/a/loop/**/*.tsx'] },
      mutual: { cwd: mutual, include: ['src/**/*.tsx'] },
      shallow: { cwd: cycle, include: ['src/*/*.tsx'] },
    }))
  }, 60_000)

  // `src/alias` leads to `src/a`, read already: one folder, found by its own path.
  test('ends at a link back into a folder it is reading, and at one to a folder it read', () => {
    expect(results.cycle).toEqual([path(cycle, 'src/a/app.tsx')])
  })

  // Where a path it returns may really be elsewhere: where the walk began, and each link it went
  // through — not one it read as empty, which leads to a folder found by another path.
  test('reports where it began and no link it read as empty', () => {
    expect(reported.cycle!.sort()).toEqual([path(cycle, 'src')])
  })

  test('ends at two links into one another', () => {
    expect(results.mutual).toEqual([path(mutual, 'src/a/a.tsx'), path(mutual, 'src/b/b.tsx')])
  })

  // Closed where a real one's is, not a lap later.
  test('ends as soon from a cwd reached through a link', () => {
    expect(results.linked).toEqual([path(linked, 'src/a/app.tsx')])
  })

  // Above where the walk began, so the walk goes through the link, and finds there only the folder it
  // began at, read already.
  test('ends at a link to a folder above the one it began at', () => {
    expect(results.above).toEqual([path(above, 'src/app.tsx')])
  })

  // Through the link that closes the loop, which is not followed: a pattern only a path round it
  // can meet matches nothing, as with `find -L`. It met a lap's worth of paths, some thirty.
  test('matches nothing for a pattern only a path round the loop meets', () => {
    expect(results.cycleOnly).toEqual([])
  })

  // Begun inside the loop, a walk goes round it once from there.
  test('goes round once from a walk begun inside the loop', () => {
    expect(results.fromLoop).toEqual([path(cycle, 'src/a/loop/a/app.tsx')])
  })

  // Each pattern is walked from its own folder: one that reads the folder another begins at, and
  // lists that as a link, takes nothing from what the other matches — nor does one that would have
  // `fast-glob` begin a single walk for both at `.`.
  test('matches for each pattern what it matches alone', () => {
    expect(results.beside).toEqual([...new Set([...results.shallow!, ...results.fromLoop!])].sort())
    expect(results.beside).toHaveLength(2)
    expect(results.merged).toEqual([...results.fromLoop!, path(cycle, 'x.css')])
  })
})

/**
 * No loop, so every path is one `fast-glob` gives: a folder only a link reaches, a link to nothing,
 * and a link inside a linked folder to a sibling whose name begins with that folder's — no loop,
 * though a check by prefix would take it for one and lose what is in it. Of two links to one folder,
 * the first: the folder is entered once.
 */
test('the source glob returns what fast-glob does, a folder two links reach by the first', () => {
  const cwd = files(join(root, 'acyclic'), ['src/app.tsx'])
  files(root, ['packages/ui/button.tsx', 'packages/ui-theme/theme.tsx'])
  symlinkSync(join(root, 'packages/ui'), join(cwd, 'src/ui'), link)
  symlinkSync(join(root, 'packages/ui'), join(cwd, 'src/ui-again'), link)
  symlinkSync(join(root, 'packages/ui-theme'), join(root, 'packages/ui/theme'), link)
  symlinkSync(join(cwd, 'src/missing'), join(cwd, 'src/gone'), link)
  const include = ['src/**/*.tsx']
  const linked: string[] = []

  const result = nodeRuntime.fs.glob({ cwd, include, linked })

  const fastGlob = glob.sync(include, { absolute: true, cwd, ignore: globIgnore(undefined) }).sort()
  expect(result).toEqual(fastGlob.filter((file) => !file.includes('/src/ui-again/')))
  expect(result).toContain(path(cwd, 'src/ui/theme/theme.tsx'))
  expect(linked.sort()).toEqual([path(cwd, 'src'), path(cwd, 'src/ui'), path(cwd, 'src/ui/theme')])
})

/**
 * A pnpm workspace, each package's `node_modules` linking its siblings. Through `../**` the walk
 * went down every sequence of links — 109,600 paths to these 8 files, and a minute — and returned a
 * package's files under each. Each real folder is entered once, and first by its own path.
 */
test('the source glob enters each package of a workspace once, whatever links them', () => {
  const workspace = join(root, 'workspace')
  const names = Array.from({ length: 8 }, (_, index) => `p${index}`)
  for (const name of names) {
    files(workspace, [`packages/${name}/src/index.ts`])
    mkdirSync(join(workspace, 'packages', name, 'node_modules/@ws'), { recursive: true })
    for (const other of names) {
      if (other !== name) {
        symlinkSync(
          join(workspace, 'packages', other),
          join(workspace, 'packages', name, 'node_modules/@ws', other),
          link,
        )
      }
    }
  }
  const cwd = join(workspace, 'packages/p0')

  const { files: found, linked } = globApart({ workspace: { cwd, include: ['../**/src/*.ts'] } })

  expect(found.workspace).toEqual(names.map((name) => path(workspace, 'packages', name, 'src/index.ts')))
  expect(linked.workspace).toEqual([path(workspace, 'packages')])
}, 60_000)

// Entered means entered: a folder the walk passes over, as `exclude` has it, is still reached
// through a link that `include` names.
test('the source glob follows a link into a folder it passes over', () => {
  const cwd = files(join(root, 'passed-over'), ['src/app.tsx', 'src/vendor/lib/lib.tsx'])
  symlinkSync(join(cwd, 'src/vendor/lib'), join(cwd, 'src/shared'), link)

  expect(nodeRuntime.fs.glob({ cwd, include: ['src/**/*.tsx'], exclude: ['src/vendor/**'] })).toEqual([
    path(cwd, 'src/app.tsx'),
    path(cwd, 'src/shared/lib.tsx'),
  ])
})

// Plain folders first, so a file the walk reaches directly is found where it really is, though a
// link to its folder comes earlier and nearer the top.
test('the source glob finds a folder by its own path before a link to it', () => {
  const cwd = files(join(root, 'own-path'), ['src/zone/deep/card.tsx'])
  symlinkSync(join(cwd, 'src/zone/deep'), join(cwd, 'src/alias'), link)

  expect(nodeRuntime.fs.glob({ cwd, include: ['src/**/*.tsx'] })).toEqual([path(cwd, 'src/zone/deep/card.tsx')])
})

// Where a returned path may really be elsewhere, as a bundler names it: a link to a file as much as
// one to a folder. Windows grants a link to a file only to an administrator.
test.skipIf(process.platform === 'win32')('the source glob reports a link to a file it returns', () => {
  const cwd = files(join(root, 'file-link'), ['shared/card.tsx', 'src/app.tsx'])
  symlinkSync(join(cwd, 'shared/card.tsx'), join(cwd, 'src/card.tsx'), 'file')
  const linked: string[] = []

  expect(nodeRuntime.fs.glob({ cwd, include: ['src/**/*.tsx'], linked })).toEqual([
    path(cwd, 'src/app.tsx'),
    path(cwd, 'src/card.tsx'),
  ])
  expect(linked.sort()).toEqual([path(cwd, 'src'), path(cwd, 'src/card.tsx')])
})

/**
 * The glob finds the inventory, and `Builder.isPotentialSourceFile` — this matcher — decides
 * whether a file that appears later belongs to it, and whether the compiler reads a module at all.
 * Where the two disagree, a module is compiled into classes the stylesheet was never built from, or
 * a file that is no source sets off a scan of them all.
 */
describe('the source glob, against membership', () => {
  const cwd = join(root, 'membership')
  const entries = [
    '.hidden/a.stories.tsx',
    '.hidden/app.tsx',
    '.hidden/y.d.ts',
    '.storybook/legacy/q.tsx',
    'README.md',
    'lib/util.ts',
    'src/app.tsx',
    'src/legacy/deep/older.tsx',
    'src/legacy/old.tsx',
    'src/ui/a.stories.tsx',
    'src/ui/button.tsx',
  ]
  files(cwd, entries)

  test.each<[string[], string[]?]>([
    // A glob matches files, so a directory alone matches nothing — not everything under it.
    [['src']],
    [['src/']],
    // A trailing slash names only a directory, kept or ignored.
    [['src/*/']],
    [['src/**/*.tsx'], ['src/legacy/']],
    [['src/**/*.tsx', '!src/legacy/']],
    [['src/**/*.tsx'], ['src/legacy/**']],
    // A folder passed over is passed over whole: the glob does not read it.
    [['src/**/*.tsx'], ['src/legacy']],
    [['src/**/*.tsx'], ['**/legacy']],
    [['src/**/*.tsx'], ['src/legacy/deep']],
    // A negated `include` pattern passes over, where a matcher handed it matched every other path.
    [['src/**/*.tsx', '!src/legacy/**']],
    [['src/**/*.tsx', '!src/legacy']],
    [['src/**/*.tsx', '!**/old.tsx']],
    // A wildcard in a folder's last segment does not stop the walk there: it passes over entries.
    [['src/**/*.tsx'], ['src/legacy/*']],
    [['src/**/*.tsx'], ['src/l*']],
    [['src/**/*.tsx', '!src/ui/*']],
    // A pattern without a glob is looked up, not walked, so a folder passed over does not hide it.
    [['src/**/*.tsx', 'src/legacy/old.tsx'], ['src/legacy']],
    // Nor the folder a walk begins at, which the walk never tests.
    [['src/legacy/**/*.tsx'], ['src/legacy']],
    // A negation in `exclude` reads as what it names, without the `!`.
    [['src/**/*.tsx'], ['!src/ui/**']],
    // A hidden folder is not entered, though a pattern starting at `.` reaches everything else —
    // and what is passed over is passed over in one `include` does name.
    [['**/*.tsx']],
    [['**/*']],
    [['.hidden/**/*.tsx'], ['**/*.stories.tsx']],
    [['.hidden/**/*.ts']],
    // Below a hidden folder a walk begins at, a folder is tested as the walk reads names: `**` does
    // not reach into `.storybook`, so `**/legacy` does not stop it there.
    [['.storybook/**/*.tsx'], ['**/legacy']],
    // `..` resolved on the way down — in what is read from, not in what is passed over.
    [['src/x/../**/*.tsx']],
    [['src/**/*.tsx'], ['src/x/../legacy']],
    // Each walk as its own patterns spell what it meets: an absolute `exclude` stops an absolute
    // walk, and none from `cwd`.
    [[`${path(cwd)}/src/**/*.tsx`], [`${path(cwd)}/src/legacy`]],
    [['src/**/*.tsx'], [`${path(cwd)}/src/legacy`]],
  ])('%j, excluding %j', (include, exclude) => {
    const member = sourceMatcher(include, exclude, cwd)

    expect(nodeRuntime.fs.glob({ cwd, exclude, include })).toEqual(
      entries.filter((entry) => member(entry)).map((entry) => path(cwd, entry)),
    )
  })

  test('counts nothing a negated pattern does not name a member', () => {
    const member = sourceMatcher(['src/**/*.tsx', '!src/legacy/**'], undefined, cwd)

    expect(['README.md', 'node_modules/react/index.js', 'src/legacy/old.tsx'].filter((file) => member(file))).toEqual(
      [],
    )
    expect(member('src/app.tsx')).toBe(true)
  })

  // The glob walks from `cwd` down, so nothing above it, however a pattern starting with `**` reads.
  test('counts nothing outside cwd a member', () => {
    expect(sourceMatcher(['**/*.tsx'], undefined, cwd)('../outside/card.tsx')).toBe(false)
  })
})
