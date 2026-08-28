import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Snapshot } from '@typescript/api/unstable/sync'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { forEachDescendant } from '../src/node'
import { Project } from '../src/project'

/**
 * A project must let go of the snapshots it replaces.
 *
 * `updateSnapshot` carries the previous snapshot's cached trees forward and then releases that
 * snapshot's own references only if it has been disposed. Nothing disposed one, so every
 * snapshot a build ever made stayed live — and the client keeps a per-snapshot set naming every
 * path fetched through it, each new snapshot inheriting the last one's paths. That grows as the
 * square of the number of updates.
 *
 * Counted here rather than measured. Peak RSS is the quantity that actually matters and it is
 * far too machine-dependent to assert, but the release behind it is exact: one `dispose` for
 * every snapshot a project stops using. `memo.test.ts` locks down serialization the same way,
 * and for the same reason — a wall-clock threshold fails on a busy runner rather than on a
 * regression.
 *
 * Counted on `Snapshot.prototype`, because `#api` is a private field with no way through it.
 * That is the more direct assertion anyway: it names the call the client watches for, rather
 * than a data structure the client happens to keep today.
 */
let root: string
let project: Project
let disposals: number

beforeEach(() => {
  disposals = 0
  const dispose = Snapshot.prototype.dispose
  vi.spyOn(Snapshot.prototype, 'dispose').mockImplementation(function (this: Snapshot) {
    if (!this.isDisposed()) disposals++
    return dispose.call(this)
  })

  root = mkdtempSync(path.join(tmpdir(), 'bamboo-snapshot-lifetime-'))
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true } }))
  project = new Project({ cwd: root })
})

afterEach(() => {
  project.dispose()
  vi.restoreAllMocks()
  rmSync(root, { force: true, recursive: true })
})

const at = (index: number) => path.join(root, 'src', `mod-${index}.ts`)

/** One install and one read, which is the shape the resolution walk repeats per importer. */
const churn = (count: number) => {
  const held = []
  for (let index = 0; index < count; index++) {
    project.addSourceFile(at(index), `export const value${index} = ${index}\n`)
    const source = project.getSourceFile(at(index))
    if (source) held.push(source)
  }
  return held
}

describe('replacing a snapshot', () => {
  test('releases the one it replaced', () => {
    churn(25)

    // One release per replacement. Nothing released any of them before, so this counted zero
    // however much the project churned — and every snapshot stayed live in both processes.
    expect(disposals).toBeGreaterThanOrEqual(24)
  })

  test('keeps a node taken from a snapshot that has since been replaced', () => {
    // The reason disposing is safe, and the thing that would break if it were not: bamboo hands
    // source files to the extractor and walks them long after the snapshot they came from has
    // been superseded. What a node reads is a buffer this process already holds.
    const held = churn(25)
    expect(held).toHaveLength(25)

    let nodes = 0
    for (const source of held) forEachDescendant(source, () => (nodes++, undefined))
    expect(nodes).toBeGreaterThan(0)
  })

  test('releases nothing when there is nothing to replace', () => {
    // A project that never advances past its first snapshot has none to let go of, and a
    // release issued against the live one would take the current program with it.
    expect(disposals).toBe(0)
  })
})
