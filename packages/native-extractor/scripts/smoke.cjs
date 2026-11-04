/**
 * Loads a built binary and extracts one call with it, as the release workflow does for each binary
 * on the oldest system that binary is for.
 *
 *   node scripts/smoke.cjs [path/to/binary.node]
 */
'use strict'

const { join, resolve } = require('node:path')

const binary = resolve(process.argv[2] ?? join(__dirname, '..', 'bamboo-native-extractor.node'))
const { analyze } = require(binary)
const result = analyze('smoke.ts', "import { css } from 'styled-system/css'; css({ color: 'red' })", [
  { kind: 'css', modules: ['styled-system/css'], names: ['css'] },
])
if (result.errors.length || result.calls.length !== 1) {
  throw new Error(`${binary} did not extract the one call: ${JSON.stringify(result)}`)
}

const { glibcVersionRuntime } = process.report.getReport().header
const libc = process.platform === 'linux' ? (glibcVersionRuntime ? ` glibc ${glibcVersionRuntime}` : ' musl') : ''
console.log(`Extracted with ${binary} on ${process.platform}-${process.arch}${libc}, Node ${process.version}`)
