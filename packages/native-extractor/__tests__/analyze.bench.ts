import { createRequire } from 'node:module'
import { bench, describe } from 'vitest'
import type { NativeEntrypoint, NativeFileAnalysis, NativeSource } from '../index'

const require = createRequire(import.meta.url)
const { analyzeMany } = require('../index.cjs') as {
  analyzeMany(sources: NativeSource[], entrypoints: NativeEntrypoint[]): NativeFileAnalysis[]
}

const entrypoints: NativeEntrypoint[] = [
  { kind: 'css', modules: ['styled-system/css'], names: ['css', 'cva', 'sva', 'cx'] },
]
const sources = Array.from({ length: 500 }, (_, file) => ({
  filename: `src/file-${file}.tsx`,
  source: `
    import { css, cx } from 'styled-system/css'
    const base = { display: 'flex', gap: '${file % 8}' }
    export const a = css({ ...base, color: 'red.300' })
    export const b = cx(a, css({ padding: [0, 1, 2], _hover: { color: 'blue.500' } }))
  `,
}))
/**
 * One large module, as a design system's primitives can be. Each call's line, column and UTF-16
 * offsets come from its file, so a cost per call that grows with the file shows here and not in
 * the 500 modules above, which hold three calls each. Not ASCII, as a label or a comment need not
 * be, so its UTF-16 offsets are not its byte offsets.
 */
const largeModule = [
  {
    filename: 'src/large.tsx',
    source: [
      `import { css } from 'styled-system/css'`,
      ...Array.from(
        { length: 1000 },
        (_, call) => `export const s${call} = css({ color: 'red.300', padding: '${call % 8}' }) // Größe ${call}`,
      ),
    ].join('\n'),
  },
]
const compactTransferControl = JSON.stringify(
  sources.map(({ filename }) => ({
    filename,
    calls: [],
    errors: [],
    dependencies: [],
    pendingCandidates: [],
    configurationFiles: [],
  })),
)

describe('native cold extraction', () => {
  bench('compact result transfer control', () => {
    JSON.parse(compactTransferControl)
  })

  bench(
    'parse + analyze 500 modules in one N-API call',
    () => {
      analyzeMany(sources, entrypoints)
    },
    { warmupIterations: 3, time: 3000 },
  )

  bench(
    'parse + analyze one module of 1,000 calls',
    () => {
      analyzeMany(largeModule, entrypoints)
    },
    { warmupIterations: 3, time: 3000 },
  )
})
