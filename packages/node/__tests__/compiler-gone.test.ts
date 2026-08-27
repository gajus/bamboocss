import { execFileSync } from 'node:child_process'
import { createContext } from '@bamboocss/fixture'
import { logger } from '@bamboocss/logger'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { BambooContext } from '../src/create-context'

/**
 * A compiler that has died is one event, not one per file.
 *
 * bamboo parses every file through a single TypeScript 7 process, so a process that goes away
 * mid-pass — killed by the kernel on a machine that ran out of memory, or ended by its own
 * panic — makes every remaining file fail with the same `EPIPE: broken pipe, write`. Extraction
 * catches per file and carries on, which turned that into thousands of `Failed to parse` lines
 * naming thousands of files that were fine, with the one line explaining them buried somewhere
 * above. That is what this stops.
 *
 * The distinction is not cosmetic. `parseFailures` is a list of *files to fix*, and filling it
 * with a project's entire inventory tells an author to go and look at source that has nothing
 * wrong with it.
 */
const CSS = `
import { css } from 'styled-system/css'
export const style = css({ color: 'red' })
`

/** This process's direct children, which a compiler becomes one of. */
const childPids = (): Set<number> => {
  try {
    return new Set(
      execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' })
        .split('\n')
        .map((line) => Number(line.trim()))
        .filter((pid) => Number.isInteger(pid) && pid > 0),
    )
  } catch {
    // `pgrep` exits non-zero when nothing matches, which is a valid answer here.
    return new Set()
  }
}

const abs = (ctx: BambooContext, path: string) => ctx.runtime.path.abs(ctx.config.cwd, path)

/**
 * A context holding `count` files, and the compiler process it parses them through.
 *
 * The pid is taken as a difference across the first install rather than by matching on the
 * executable, because a vitest worker may be holding compilers belonging to other files and
 * killing one of those would fail an unrelated suite.
 *
 * `getFiles` is stubbed for the reason `extract-failure.test.ts` gives: the fixture globs an
 * empty `include`, so a context left to itself claims to hold nothing.
 */
const withFiles = (count: number) => {
  const ctx = createContext() as unknown as BambooContext
  const files: string[] = []
  ctx.getFiles = () => files

  const before = childPids()
  const entries: Array<readonly [string, string]> = []
  for (let index = 0; index < count; index++) {
    const path = abs(ctx, `app/src/f${index}.tsx`)
    entries.push([path, CSS])
    files.push(path)
  }

  // The bulk install, which is the one an extraction pass uses — and which deliberately does
  // not read the trees back. That is the shape being modelled: the compiler holds every tree,
  // and `parseFiles` fetches each as it reaches it, so a process that dies part-way through is
  // discovered on the next file. Installing one at a time instead reads each tree eagerly,
  // which caches all of them here and leaves nothing for a dead compiler to fail.
  const tsProject = (
    ctx.project as unknown as { project: { addSourceFiles(entries: Iterable<readonly [string, string]>): void } }
  ).project
  tsProject.addSourceFiles(entries)
  const compilerPid = [...childPids()].find((pid) => !before.has(pid))

  return { compilerPid, ctx, files }
}

/** A process's state letter, or `undefined` once the kernel has forgotten it entirely. */
const stateOf = (pid: number): string | undefined => {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim() || undefined
  } catch {
    return undefined
  }
}

/** Kill the compiler the way the OOM killer does: no notice, no chance to flush. */
const kill = (pid: number | undefined) => {
  expect(pid, 'no compiler process appeared when the context installed its files').toBeTypeOf('number')
  process.kill(pid!, 'SIGKILL')

  // Read the state rather than the liveness: this test is synchronous, so Node never reaps the
  // child and `kill(pid, 0)` goes on answering for the zombie it becomes. A zombie is already
  // enough — the pipe is torn down at termination, and that is what the next write finds.
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const state = stateOf(pid!)
    if (state === undefined || state.startsWith('Z')) return
  }
  throw new Error(`compiler ${pid} did not die`)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('an extraction pass whose compiler dies', () => {
  test('stops, rather than reporting every remaining file as unparseable', () => {
    const caught = vi.spyOn(logger, 'caughtError').mockImplementation(() => undefined)
    const { compilerPid, ctx } = withFiles(40)
    kill(compilerPid)

    expect(() => ctx.parseFiles()).toThrow(/The TypeScript compiler process bamboo parses through is gone/)

    // The whole point: not one line per file. `Failed to parse` is a claim about a file, and
    // every one of these files is fine.
    expect(caught).not.toHaveBeenCalled()
  })

  test('does not record the files as needing fixes', () => {
    vi.spyOn(logger, 'caughtError').mockImplementation(() => undefined)
    const { compilerPid, ctx } = withFiles(40)
    kill(compilerPid)

    try {
      ctx.parseFiles()
    } catch {
      // The throw is the previous test's assertion.
    }

    // `parseFailures` outlives the pass and is what `assertExtracted` reports. A compiler death
    // recorded there would name every file in the project, and — because the map is only
    // cleared by a file parsing successfully — would go on naming them after the compiler was
    // replaced, wedging a dev server that had already recovered.
    expect(Array.from(ctx.parseFailures.keys())).toEqual([])
    expect(() => ctx.assertExtracted()).not.toThrow()
  })
})
