import { disposeAllProjects, kindNameOf } from '@bamboocss/ts-ast'
import { afterAll, expect } from 'vitest'

expect.addSnapshotSerializer({
  serialize(value) {
    return kindNameOf((value as { kind?: number }).kind)
  },
  test(value) {
    // Structural, because TypeScript 7 publishes no `isNode`. A node is the only thing here
    // carrying a numeric `kind` alongside a source span.
    const candidate = value as { kind?: unknown; pos?: unknown; end?: unknown } | null
    return (
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof candidate.kind === 'number' &&
      typeof candidate.pos === 'number' &&
      typeof candidate.end === 'number'
    )
  },
})

/**
 * Close this file's compilers when it finishes.
 *
 * Every `Project` owns a Go process. A build makes a handful; a test run makes hundreds, and
 * without this each worker holds every one it has ever started for as long as the run lasts —
 * which starves the machine of CPU and turns up as timeouts in whichever suite happens to be
 * running. Setup files run per test file, so this closes only what that file opened.
 */
afterAll(() => {
  disposeAllProjects()
})
