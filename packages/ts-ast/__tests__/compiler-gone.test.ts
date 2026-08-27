import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CompilerGoneError, isCompilerGone, Project } from '../src/project'

/**
 * What every call does once the Go process behind the project has died.
 *
 * Not a hypothetical. bamboo parses a whole project through one child process, and a large
 * project on a small machine gets that process killed by the kernel — which reaches this side
 * as `EPIPE: broken pipe, write` on the *next* request, and identically on every request after
 * it. A cold pass makes one request per file, so the untranslated failure is thousands of
 * syscall errors naming thousands of files that are not the problem, printed above and below
 * whichever panic or OOM kill was.
 *
 * The child is killed for real rather than mocked, because the thing under test is precisely
 * how a dead pipe surfaces: `writeSync` throwing `EPIPE` is what the channel does, and a stub
 * asserting that it does is a test of the stub.
 */
let root: string
let project: Project
let compilerPid: number | undefined

/** This process's direct children, which the compiler becomes one of. */
const childPids = (): Set<number> => {
  try {
    return new Set(
      execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' })
        .split('\n')
        .map((line) => Number(line.trim()))
        .filter((pid) => Number.isInteger(pid) && pid > 0),
    )
  } catch {
    // `pgrep` exits non-zero when nothing matches, which is a valid answer before the first
    // project exists.
    return new Set()
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bamboo-compiler-gone-'))
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true } }))

  // Identified by what appeared, rather than by name: `#api` is a private field with no way
  // through it, and matching on the executable would also match a compiler another test file's
  // worker happens to be holding.
  const before = childPids()
  project = new Project({ cwd: root })
  compilerPid = [...childPids()].find((pid) => !before.has(pid))
})

afterEach(() => {
  // Repeatable on purpose: a test may have disposed already, and `closeQuietly` swallows a
  // second close.
  project.dispose()
  rmSync(root, { force: true, recursive: true })
})

/** A process's state letter, or `undefined` once the kernel has forgotten it entirely. */
const stateOf = (pid: number): string | undefined => {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim() || undefined
  } catch {
    return undefined
  }
}

/** Kill the compiler the way the OOM killer does: no notice, no chance to flush. */
const killCompiler = () => {
  expect(compilerPid, 'no compiler process appeared when the project was constructed').toBeTypeOf('number')
  process.kill(compilerPid!, 'SIGKILL')

  // SIGKILL is delivered asynchronously and this test is synchronous, so the event loop never
  // turns and Node never reaps the child — `kill(pid, 0)` goes on answering for the zombie it
  // becomes, which is why the state has to be read rather than the liveness. A zombie is
  // already enough: the pipe is torn down when the process terminates, not when it is reaped,
  // and the tear-down is what the next write discovers.
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const state = stateOf(compilerPid!)
    if (state === undefined || state.startsWith('Z')) return
  }
  throw new Error(`compiler ${compilerPid} did not die`)
}

/** Install a source, which is a write to the compiler, and hand back whatever it threw. */
const install = (name: string): unknown => {
  try {
    project.addSourceFile(path.join(root, 'src', name), `export const ${path.parse(name).name} = 1`)
  } catch (error) {
    return error
  }
  return undefined
}

describe('a compiler that has died', () => {
  test('reports what happened instead of the syscall that noticed', () => {
    expect(install('a.ts')).toBeUndefined()

    killCompiler()

    const thrown = install('b.ts')
    expect(thrown).toBeInstanceOf(CompilerGoneError)
    expect((thrown as Error).message).toContain('The TypeScript compiler process bamboo parses through is gone')
    // Naming the syscall is what the untranslated failure did, and it is the thing that made
    // the real cause unfindable: `EPIPE` describes a write, not a compiler.
    expect((thrown as Error).message).toContain('nothing after this point can be read')
    // The syscall is kept as the cause, for a caller that wants it.
    expect(isCompilerGone((thrown as Error).cause)).toBe(true)
  })

  test('names the signal once the event loop has collected it', async () => {
    install('a.ts')
    killCompiler()
    // Node fills `signalCode` when it reaps the child, and that happens on the event loop —
    // which a synchronous extraction pass never turns. A watch rebuild does, and this is that
    // case: the signal is the half that separates an OOM kill from a panic.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect((install('b.ts') as Error).message).toContain('killed by signal SIGKILL')
  })

  test('says so plainly when the status has not been collected', () => {
    install('a.ts')
    killCompiler()

    // The synchronous case, which is the one this error exists for. `exitCode` and
    // `signalCode` are both still null here, and reading them naively reports the process as
    // *running* — the opposite of what happened.
    const message = (install('b.ts') as Error).message
    expect(message).toContain('exit status not collected yet')
    expect(message).not.toContain('still running')
  })

  test('answers the same way every time, without going back to the pipe', () => {
    install('a.ts')
    killCompiler()

    const first = install('b.ts')
    expect(first).toBeInstanceOf(CompilerGoneError)

    // Identity, not just equality: the latch is what keeps a 4,000-file pass from making 4,000
    // more writes to a pipe that has already reported it has no reader, and 4,000 log lines
    // about files that were never the problem.
    for (const attempt of [1, 2, 3]) expect(install(`n${attempt}.ts`)).toBe(first)
  })
})

describe('a project that was disposed', () => {
  test('says so, rather than blaming the OOM killer', () => {
    install('a.ts')
    project.dispose()

    const thrown = install('b.ts')
    expect(thrown).toBeInstanceOf(CompilerGoneError)
    expect((thrown as Error).message).toContain('This project has been disposed')
    // The channel cannot tell a closed fd from a dead process, so without this a deliberate
    // close is reported with the memory advice — and the reader goes looking for an OOM kill
    // that never happened.
    expect((thrown as Error).message).not.toContain('OOM killer')
  })
})

describe('classifying a failure', () => {
  test('reads a raw channel error as a dead compiler', () => {
    // The extractor walks nodes the project handed out, so a death noticed mid-walk throws the
    // channel's own error rather than the wrapped one. Both have to answer the same.
    expect(isCompilerGone(Object.assign(new Error('EPIPE: broken pipe, write'), { code: 'EPIPE' }))).toBe(true)
    expect(isCompilerGone(new Error('Unexpected EOF while reading from child process (exited with code 2)'))).toBe(true)
    expect(isCompilerGone(new Error('SyncRpcChannel is closed'))).toBe(true)
  })

  test('does not read a parse or filesystem error as one', () => {
    expect(isCompilerGone(new Error("';' expected."))).toBe(false)
    expect(isCompilerGone(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }))).toBe(false)
    expect(isCompilerGone(undefined)).toBe(false)
  })
})
