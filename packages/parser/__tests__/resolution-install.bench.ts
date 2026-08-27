import { createContext } from '@bamboocss/fixture'
import { bench, describe } from 'vitest'

/**
 * What it costs to pull modules into the project that the inventory did not cover.
 *
 * The shape is a monorepo's: an app whose `include` covers its own pages, importing modules
 * that live in a workspace sibling. `node_modules` is excluded from the import walk, but a
 * sibling resolves to a real path inside the checkout — so every cross-package import names a
 * module outside the bulk-installed inventory, and the resolution walk has to install it.
 *
 * That install is a round trip that moves the project's membership, and a membership move
 * rewrites the synthesized tsconfig's whole `files` list and tells the compiler its config
 * changed. Done once per import, the compiler re-derives its program once per import, over a
 * list one entry longer each time. On a synthetic project the one-at-a-time path cost 27.4s
 * for 2,000 modules against 92ms installed together, and the gap widens with the project — it
 * is quadratic, and it is what a large monorepo's cold build spends its time in.
 *
 * Read the control, not just the case. `siblings already installed` does identical extraction
 * with the walk installing nothing, so nothing about this path can move it. If it moves
 * between two readings, the machine did and the comparison is void.
 *
 * pnpm bench resolution-install
 */
const ENTRIES = 40
const FANOUT = 15
const SIBLINGS = 600

/**
 * A context whose siblings are resolvable but, unless `preinstalled`, not project members.
 *
 * Written through the project's own filesystem rather than to disk: that is what puts a module
 * where the resolver will find it while leaving it outside the inventory, which is precisely
 * the state a workspace sibling is in.
 *
 * The `preinstalled` arm installs them *in bulk*, not one at a time. Installing them singly
 * makes the control pay the very cost it exists to exclude — it read 3x slower than the case
 * under test, because 600 one-at-a-time installs cost more than the walk being measured.
 */
const build = (preinstalled: boolean) => {
  const ctx = createContext({}) as never as {
    config: { cwd: string }
    getFiles: () => string[]
    parseFiles: () => unknown
    project: {
      addSourceFile: (path: string, code: string) => unknown
      project: {
        addSourceFiles: (entries: Iterable<readonly [string, string]>) => void
        getFileSystem: () => { writeFileSync: (path: string, code: string) => void }
      }
    }
  }
  const cwd = ctx.config.cwd
  const fileSystem = ctx.project.project.getFileSystem()

  const siblings: Array<readonly [string, string]> = []
  for (let sibling = 0; sibling < SIBLINGS; sibling++) {
    const path = `${cwd}/packages/ui/src/mod-${sibling}.ts`
    const code = `export const token${sibling} = 'red'\n`
    if (preinstalled) siblings.push([path, code])
    else fileSystem.writeFileSync(path, code)
  }
  if (siblings.length) ctx.project.project.addSourceFiles(siblings)

  const files: string[] = []
  for (let entry = 0; entry < ENTRIES; entry++) {
    const imports = Array.from({ length: FANOUT }, (_, index) => {
      const sibling = (entry * FANOUT + index) % SIBLINGS
      return `import { token${sibling} } from '../../../packages/ui/src/mod-${sibling}'`
    }).join('\n')
    const path = `${cwd}/apps/web/src/page-${entry}.tsx`
    ctx.project.addSourceFile(
      path,
      `${imports}\nimport { css } from '../../../styled-system/css'\nexport const s${entry} = css({ color: 'red' })\n`,
    )
    files.push(path)
  }

  ctx.getFiles = () => files
  return ctx
}

describe(`${ENTRIES} entries x ${FANOUT} imports over ${SIBLINGS} workspace siblings`, () => {
  // Each iteration needs a project that has not already installed the siblings, so the setup
  // is inside the timed body. The control carries the identical setup, which is what makes the
  // difference between them attributable to the install path rather than to the fixture.
  bench('the walk installs the siblings', () => {
    build(false).parseFiles()
  })

  bench('siblings already installed (control)', () => {
    build(true).parseFiles()
  })
})
