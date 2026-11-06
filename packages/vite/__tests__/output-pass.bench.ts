import { esc } from '@bamboocss/shared'
import { bench, describe } from 'vitest'
import { bamboocssCssEarly } from '../src/css'
import { pruneStaticCss } from '../src/css-output-module'
import { createStaticCompilationSession, type StaticCompilationSession } from '../src/static-session'

/**
 * What the early output pass costs an output, which had no benchmark: once per output rather than
 * per module, but on the path every build ends in, and every round of a watch.
 *
 * A sheet of 3,000 atoms a third of which nothing reaches, as an environment writing it prunes it
 * and as a server environment, whose copy Vite discards, does. `prune only` is the control: the
 * parse and prune the pass is built around, which neither naming nor splitting touches — a reading
 * that moves it moved the machine.
 */
const ATOMS = 3000
const atoms = Array.from({ length: ATOMS }, (_, index) => `w_[${index}.5px]`)
const SHEET =
  `@layer reset, base, tokens, utilities;` +
  `@layer utilities{${atoms.map((atom, index) => `.${esc(atom)}{width:${index}.5px}`).join('')}}` +
  `:root{--made-with-bamboo:🌱}`
const ORIGINAL = 'assets/index.css'

const session = createStaticCompilationSession()
for (const atom of atoms) session.prunableClasses.add(esc(atom))
for (const atom of atoms.slice(0, 2000)) session.markClassUsed(atom)
const requiredClasses = new Set([...session.usedClasses])

const generate = bamboocssCssEarly({ session, pruneCss: true }).generateBundle as {
  handler: (this: unknown, outputOptions: object, bundle: object, isWrite: boolean) => Promise<void>
}
const environments = {
  client: { name: 'client', config: { consumer: 'client', build: { emitAssets: true } } },
  ssr: { name: 'ssr', config: { consumer: 'server', build: { ssr: true, emitAssets: false } } },
}
/** A fresh bundle and output each time: the pass renames the asset in place, and remembers both. */
const pass = (environment: (typeof environments)[keyof typeof environments]) =>
  generate.handler.call(
    { environment },
    {},
    {
      [ORIGINAL]: { type: 'asset', fileName: ORIGINAL, names: [], source: SHEET },
      'entry.js': {
        type: 'chunk',
        fileName: 'entry.js',
        name: 'entry',
        isEntry: true,
        imports: [],
        modules: {},
        code: `export const href = "/${ORIGINAL}"\n`,
      },
    },
    false,
  )

// The client's sheet is written under the original name first, as the copy a server discards
// takes its name from it.
await pass(environments.client)

/**
 * The same pass splitting the sheet per lazily loaded chunk, which the two cases above never reach:
 * their one chunk is an entry holding no module, so nothing is owned and the split returns at once.
 *
 * Twelve route chunks hold a module each, and each module writes 100 of the used atoms, five to a
 * class string. Where joined, 20 of each route's atoms are ones a `cx()` there joins with a class
 * passed in at runtime, which keeps them in the entry sheet: read against the case without, the
 * difference is what asking each module for them costs, plus the 240 rules that no longer move.
 */
const ROUTES = 12
const routeAtoms = (route: number) => atoms.slice(route * 100, route * 100 + 100)
const routeOf = (moduleId: string) => Number(/route-(\d+)/.exec(moduleId)?.[1] ?? -1)

const splitSession = (joined: boolean) => {
  const split = createStaticCompilationSession()
  for (const atom of atoms) split.prunableClasses.add(esc(atom))
  for (const atom of atoms.slice(0, 2000)) split.markClassUsed(atom)
  split.classNamesOf = (_environment, moduleId) => {
    const route = routeOf(moduleId)
    if (route < 0) return undefined
    const own = routeAtoms(route)
    return Array.from({ length: own.length / 5 }, (_, index) => own.slice(index * 5, index * 5 + 5).join(' '))
  }
  if (joined) {
    split.joinedClassNamesOf = (_environment, moduleId) => {
      const route = routeOf(moduleId)
      return route < 0 ? undefined : routeAtoms(route).slice(0, 20)
    }
  }
  return split
}

/** A fresh bundle of the entry and its routes each time, with the hooks the split emits through. */
const splitPass = (split: StaticCompilationSession) => {
  const run = bamboocssCssEarly({ session: split, pruneCss: true }).generateBundle as typeof generate
  return async () => {
    const bundle: Record<string, object> = {
      [ORIGINAL]: { type: 'asset', fileName: ORIGINAL, names: [], source: SHEET },
      'entry.js': {
        type: 'chunk',
        fileName: 'entry.js',
        name: 'entry',
        isEntry: true,
        imports: [],
        modules: { '/src/entry.tsx': {} },
        code: `export const href = "/${ORIGINAL}"\n`,
        viteMetadata: { importedCss: new Set([ORIGINAL]) },
      },
    }
    for (let route = 0; route < ROUTES; route++) {
      bundle[`route-${route}.js`] = {
        type: 'chunk',
        fileName: `route-${route}.js`,
        name: `route-${route}`,
        isEntry: false,
        imports: [],
        modules: { [`/src/route-${route}.tsx`]: {} },
        code: '',
        viteMetadata: { importedCss: new Set<string>() },
      }
    }
    let emitted = 0
    const context = {
      environment: environments.client,
      emitFile: ({ name, source }: { name: string; source: string }) => {
        const fileName = `assets/${name.replace(/\.css$/, '')}-${emitted++}.css`
        bundle[fileName] = { type: 'asset', fileName, names: [name], source }
        return fileName
      },
      getFileName: (referenceId: string) => referenceId,
    }
    await run.handler.call(context, {}, bundle, false)
    return bundle
  }
}

// A split that stopped happening would leave both cases timing the pass above under another name.
const sampled = Object.values(await splitPass(splitSession(false))()).filter((output) =>
  (output as { fileName?: string }).fileName?.endsWith('.css'),
)
if (sampled.length !== ROUTES + 1) {
  throw new Error(`Expected the entry sheet and one per route, found ${sampled.length} sheet(s).`)
}

const benchOptions = { iterations: 30, warmupIterations: 10, time: 1000 }

describe('early output pass, 3,000 atoms', () => {
  bench(
    'control: prune only',
    () => {
      pruneStaticCss(SHEET, session, { requiredClasses })
    },
    benchOptions,
  )

  bench(
    'a sheet the environment writes',
    async () => {
      await pass(environments.client)
    },
    benchOptions,
  )

  bench(
    'a copy the environment discards',
    async () => {
      await pass(environments.ssr)
    },
    benchOptions,
  )

  const split = splitPass(splitSession(false))
  bench(
    `a sheet split across ${ROUTES} lazy chunks`,
    async () => {
      await split()
    },
    benchOptions,
  )

  const joined = splitPass(splitSession(true))
  bench(
    `the same split, ${ROUTES * 20} atoms joined at runtime`,
    async () => {
      await joined()
    },
    benchOptions,
  )
})
