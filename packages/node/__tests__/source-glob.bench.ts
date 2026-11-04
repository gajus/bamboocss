import glob from 'fast-glob'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, bench, describe } from 'vitest'
import { globIgnore, nodeRuntime } from '../src/node-runtime'

/**
 * The source glob, which every inventory scan runs: once per build, and in dev for each file added
 * or removed.
 *
 * Its walk enters each real folder once: the plain folders first, then each link it set aside,
 * read as empty where its folder was entered already and walked otherwise, through the folders
 * above it. Every folder read passes through that bookkeeping, which is the cost with no link in
 * the tree; a link adds its real path, resolved once, and the folders above it read again where it
 * leads somewhere new. Patterns `fast-glob` would walk once from `.` are walked each from its own
 * folder, so the last pair measures that. `fast-glob` alone is the control — the same walk,
 * following every link — so a reading that moves it moved the machine.
 */
const root = realpathSync(mkdtempSync(join(tmpdir(), 'bamboo-glob-bench-')))
afterAll(() => rmSync(root, { force: true, recursive: true }))

/** 5,000 files in 100 folders. */
const project = (name: string) => {
  const cwd = join(root, name)
  for (let folder = 0; folder < 100; folder++) {
    mkdirSync(join(cwd, `src/feature-${folder}`), { recursive: true })
    for (let file = 0; file < 50; file++) writeFileSync(join(cwd, `src/feature-${folder}/component-${file}.tsx`), '')
  }
  return cwd
}

const kind = process.platform === 'win32' ? 'junction' : 'dir'
const plain = project('plain')
const linked = project('linked')
// A folder linked into `src` as well, as a workspace package is: 50 of the files reached twice.
symlinkSync(join(linked, 'src/feature-0'), join(linked, 'src/shared'), kind)
// Every folder linked in a second time: a hundred links, each resolved and held up against the walk.
const links = project('links')
for (let folder = 0; folder < 100; folder++) {
  symlinkSync(join(links, `src/feature-${folder}`), join(links, `src/link-${folder}`), kind)
}

const include = ['src/**/*.{ts,tsx}']
// Three that `fast-glob` walks once, from `.`: the first starts there.
const several = ['*.ts', 'src/feature-1*/**/*.tsx', 'src/feature-2*/**/*.tsx']
const unwatched = (cwd: string, patterns = include) =>
  glob.sync(patterns, { cwd, ignore: globIgnore(undefined), absolute: true }).sort()
const options = { iterations: 50, warmupIterations: 10, time: 1000 }

describe('source glob', () => {
  bench('no link', () => void nodeRuntime.fs.glob({ cwd: plain, include }), options)

  bench('a linked folder', () => void nodeRuntime.fs.glob({ cwd: linked, include }), options)

  bench('fast-glob alone, no link', () => void unwatched(plain), options)

  bench('fast-glob alone, a linked folder', () => void unwatched(linked), options)

  bench('a hundred linked folders', () => void nodeRuntime.fs.glob({ cwd: links, include }), options)

  bench('fast-glob alone, a hundred linked folders', () => void unwatched(links), options)

  bench('patterns from several folders', () => void nodeRuntime.fs.glob({ cwd: plain, include: several }), options)

  bench('fast-glob alone, patterns from several folders', () => void unwatched(plain, several), options)
})
