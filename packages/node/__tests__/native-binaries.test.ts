import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { NATIVE_BINARIES, nativeBinaryName } from '../src/native-extractor'

/**
 * An installed `@bamboocss/node` loads its binary from `dist/native`, under a name the release
 * workflow has to have built. One the loader names and the workflow does not build fails only on
 * that platform, which nothing CI runs on would notice: Alpine went to the glibc binary and Windows
 * on Arm had none.
 */
const workflow = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../.github/workflows/release.yaml'),
  'utf8',
)
const loaded = Object.values(NATIVE_BINARIES).sort()

test('the release workflow builds every binary the loader looks for, and no other', () => {
  const built = [...workflow.matchAll(/^\s+binary: (\S+)$/gm)].map(([, name]) => name).sort()

  expect(built).toEqual(loaded)
})

test('the release checks the package holds every one before publishing it', () => {
  const step = /for binary in \\\n([\s\S]*?)\n\s*do\n/.exec(workflow)?.[1] ?? ''
  const checked = [...step.matchAll(/\S+\.node/g)].map(([name]) => name).sort()

  expect(checked).toEqual(loaded)
})

/** `/usr/bin/ldd` decides, and the report Node writes about itself says which C library it has. */
test.runIf(process.platform === 'linux')('names the binary for the C library this Node runs on', () => {
  const { header } = process.report.getReport() as { header: { glibcVersionRuntime?: string } }

  expect(nativeBinaryName()).toBe(`linux-${process.arch}-${header.glibcVersionRuntime ? 'gnu' : 'musl'}.node`)
})
