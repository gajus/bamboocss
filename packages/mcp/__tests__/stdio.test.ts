// @vitest-environment node
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, test } from 'vitest'

/**
 * The server as a client starts it: a process speaking JSON-RPC over stdio.
 *
 * Its stdout is the protocol, and a line there that is not a message corrupts the stream. Loading
 * a config with a `logLevel` that logs put the logger back on, and the first usage report printed
 * `Analyzing N file(s)` into it. And with its client gone, it stayed: a write into a pipe without
 * a reader failed, the failure was logged into the same pipe, and that failed in turn.
 *
 * Run from source, through tsx, so this tests what is in the tree and not whatever `dist` holds.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const directories: string[] = []
const children: ChildProcess[] = []
afterAll(() => {
  for (const child of children) child.kill()
  for (const directory of directories) rmSync(directory, { force: true, recursive: true })
})

/** Start the server on a project logging at `info`, and initialize a session with it. */
const serve = async ({ before = '', logLevel = 'info' } = {}) => {
  const cwd = mkdtempSync(join(tmpdir(), 'bamboo-mcp-stdio-'))
  directories.push(cwd)
  const files = {
    'bamboo.config.ts': `${before}\nexport default { logLevel: '${logLevel}', preflight: false, include: ['src/**/*.tsx'], outdir: 'styled-system' }`,
    'src/app.tsx': `import { css } from '../styled-system/css'\nexport const a = css({ color: 'red.300' })\n`,
    // What `bin.js` does, from source rather than `dist`.
    'run.cts': `require(${JSON.stringify(join(root, 'src/cli.ts'))}).runMcpCli()\n`,
  }
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true })
    writeFileSync(join(cwd, file), contents)
  }

  // tsx's script, run by this Node, rather than its `.bin` shim: on Windows that is a `.cmd`,
  // which `spawn` cannot start without a shell.
  const tsx = createRequire(import.meta.url).resolve('tsx/cli')
  const child = spawn(process.execPath, [tsx, '--conditions=source', join(cwd, 'run.cts'), '--cwd', cwd], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)

  let buffer = ''
  const output = { lines: [] as string[], stderr: '' }
  const answered = new Map<number, () => void>()
  child.stderr.on('data', (chunk) => (output.stderr += chunk))
  child.stdout.on('data', (chunk) => {
    const complete = (buffer + chunk).split('\n')
    buffer = complete.pop()!
    for (const line of complete) {
      output.lines.push(line)
      answered.get(parse(line)?.id)?.()
    }
  })
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))

  const send = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  const request = async (id: number, method: string, params: object) => {
    const response = new Promise<void>((resolve) => answered.set(id, resolve))
    send({ id, method, params })
    if ((await within(response, 30_000)) === 'timed out') throw new Error(`No response to \`${method}\``)
  }

  await request(1, 'initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  })
  send({ method: 'notifications/initialized' })

  return { child, exited, output, request, send }
}

const usageReport = { name: 'get_usage_report', arguments: { scope: 'utility' } }

test('keeps stdout to the protocol, and exits when stdin ends', { timeout: 60_000 }, async () => {
  const { child, exited, output, request } = await serve()

  await request(2, 'tools/call', usageReport)
  child.stdin.end()

  expect(await within(exited, 10_000)).toBe(0)
  expect(output.lines.filter((line) => parse(line)?.jsonrpc !== '2.0')).toEqual([])
  expect(parse(output.lines.at(-1)!)).toMatchObject({ id: 2, result: { content: [{ type: 'text' }] } })
  // The log is still there, where a client shows it.
  expect(output.stderr).toContain('Analyzing 1 file(s) for usage')
})

test('exits when its client has gone', { timeout: 60_000 }, async () => {
  const { child, exited, send } = await serve()

  // Gone without closing stdin: no reader on either pipe the server writes to.
  child.stdout.destroy()
  child.stderr.destroy()
  send({ id: 2, method: 'tools/call', params: usageReport })

  expect(await within(exited, 10_000)).toBe(0)
})

// A config holding the event loop open — a timer, a watcher of its own — kept the server running once
// its client had closed stdin: nothing listened for it, and it took a write to find the pipe gone.
test('exits when stdin ends, though the config keeps the event loop busy', { timeout: 60_000 }, async () => {
  const { child, exited } = await serve({ before: 'setInterval(() => {}, 1000)' })

  child.stdin.end()

  expect(await within(exited, 10_000)).toBe(0)
})

// The handler `@bamboocss/node` installs for an uncaught error logged it and went on, and the logger
// here can be silent: a server in a state the error left unknown went on answering, saying nothing.
test('leaves on an uncaught error, saying so on stderr though the logger is silent', { timeout: 60_000 }, async () => {
  const { exited, output } = await serve({
    before: "setTimeout(() => { throw new Error('the config broke') }, 200)",
    logLevel: 'silent',
  })

  expect(await within(exited, 10_000)).toBe(1)
  expect(output.stderr).toContain('uncaught exception: Error: the config broke')
})

// A client may stop reading the log and go on with the protocol.
test('goes on serving when only its log has no reader', { timeout: 60_000 }, async () => {
  const { child, exited, output, request } = await serve()

  child.stderr.destroy()
  await request(2, 'tools/call', usageReport)
  await request(3, 'tools/call', usageReport)

  expect(parse(output.lines.at(-1)!)).toMatchObject({ id: 3, result: { content: [{ type: 'text' }] } })
  child.stdin.end()
  expect(await within(exited, 10_000)).toBe(0)
})

const parse = (line: string) => {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<'timed out'>((resolve) => setTimeout(resolve, ms, 'timed out'))])
