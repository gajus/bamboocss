/**
 * Loads a built binary, extracts one call with it, and has it panic, as the release workflow does
 * for each binary on the oldest system that binary is for.
 *
 *   node scripts/smoke.cjs [path/to/binary.node]
 */
'use strict'

const { join, resolve } = require('node:path')

const binary = resolve(process.argv[2] ?? join(__dirname, '..', 'bamboo-native-extractor.node'))
const native = require(binary)
const extract = () =>
  native.analyze('smoke.ts', "import { css } from 'styled-system/css'; css({ color: 'red' })", [
    { kind: 'css', modules: ['styled-system/css'], names: ['css'] },
  ])
const result = extract()
if (result.errors.length || result.calls.length !== 1) {
  throw new Error(`${binary} did not extract the one call: ${JSON.stringify(result)}`)
}

// A panic is thrown as an error only where the binary unwinds to the N-API boundary, which is the
// platform's unwinder. Where it cannot, the process ends here instead.
native.__panicNext()
let thrown
try {
  extract()
} catch (error) {
  thrown = error
}
if (!String(thrown?.message).includes('__panicNext')) {
  throw new Error(`${binary} did not throw a panic as an error: ${thrown}`)
}

const { glibcVersionRuntime } = process.report.getReport().header
const libc = process.platform === 'linux' ? (glibcVersionRuntime ? ` glibc ${glibcVersionRuntime}` : ' musl') : ''
console.log(
  `Extracted with ${binary} on ${process.platform}-${process.arch}${libc}, Node ${process.version}, and threw a panic`,
)
