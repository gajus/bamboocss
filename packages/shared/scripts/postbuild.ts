import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Each bundle another package ships as text, and where under `packages/` it reads it from. Both are
 * committed, so a change to what they bundle is a `pnpm build` away from reaching either.
 */
const fileMap = [
  // Every generated `styled-system`'s `helpers.mjs`.
  ['shared.mjs', 'generator/src/artifacts/generated/helpers.mjs.json'],
  // What the Vite plugin serves compiled code as `virtual:bamboo/compiled`.
  ['compiled.mjs', 'vite/src/generated/compiled.mjs.json'],
]

function main() {
  const packagesDir = join(__dirname, '..', '..')
  fileMap.forEach(([input, target]) => {
    const inputPath = join(__dirname, '..', 'dist', input)
    const content = readFileSync(inputPath, 'utf8')

    const outPath = join(packagesDir, target)
    mkdirSync(dirname(outPath), { recursive: true })
    // Trailing newline so the formatter has nothing to add. Without it every build
    // and every `pnpm fmt:fix` flip these files back and forth, and a plain
    // `pnpm build` leaves a dirty tree.
    writeFileSync(outPath, JSON.stringify({ content }, null, 2) + '\n', 'utf8')
  })
  console.log('[postbuild] Copied shared bundles to packages/generator and packages/vite ✅')
}

main()
