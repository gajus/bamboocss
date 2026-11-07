import { withoutMergeCodes } from '@bamboocss/fixture'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { logger } from '@bamboocss/logger'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import type { Plugin } from 'vite'
import { VIRTUAL_CSS_ID } from '../src/css'
import { bamboocss } from '../src/plugin'

/**
 * The output lifecycle across environments, hook by hook, in the orders a watch or a builder can
 * run them in: what a sheet is pruned against, which name a server's copy of it links, and what the
 * guard reads. The orders that matter here are the ones no single real build pins — one
 * environment's whole build phase between another's output pass and its write, a write another
 * plugin rejects — so the hooks are driven directly, as Vite calls them.
 */
const hookOf = (hook: unknown) =>
  (typeof hook === 'function' ? hook : (hook as { handler?: unknown } | undefined)?.handler) as (
    this: unknown,
    ...args: unknown[]
  ) => unknown

interface EnvironmentSpec {
  name: string
  consumer: 'client' | 'server'
  build?: Record<string, unknown>
}
const client: EnvironmentSpec = { name: 'client', consumer: 'client', build: { emitAssets: true } }
const ssr: EnvironmentSpec = { name: 'ssr', consumer: 'server', build: { ssr: true, emitAssets: false } }

const source = (sheetImport: string | false, ...widths: string[]) =>
  (sheetImport ? `import ${sheetImport}\n` : '') +
  `import { css } from 'styled-system/css'\n` +
  widths.map((width, index) => `export const c${index} = css({ width: '[${width}]' })\n`).join('')

/** A project of its own, outside the checkout, with every environment's output under it. */
const createProject = () => {
  const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), 'bamboo-output-lifecycle-')))
  mkdirSync(join(cwd, 'src'))
  writeFileSync(
    join(cwd, 'bamboo.config.ts'),
    // Readable, so the atoms a test follows across outputs can be found by name.
    `export default { include: ['./src/**/*.{js,jsx,ts,tsx}'], outdir: 'styled-system', hash: false }\n`,
  )
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }))
  return cwd
}

interface Behaviour {
  /** How the environment's graph reaches the stylesheet. */
  imports?: 'sheet' | 'url' | false
  /** Delete every asset after the early pass, as Vite does for an environment discarding them. */
  discard?: boolean
  /** Empty the output directory as rendering starts, as a watch rebuild with `emptyOutDir` does. */
  empty?: boolean
  /** Throw from a later plugin's `generateBundle`: nothing is written, and no hook says so. */
  reject?: boolean
  /** Run between the early pass and the late one. */
  between?: (bundle: Record<string, Record<string, unknown>>) => Promise<unknown> | void
  /** Run as the early pass ends, on the bundle as it left it, before anything is discarded. */
  afterEarly?: (bundle: Record<string, Record<string, unknown>>) => void
  /** Hold the output in memory (`build.write: false`) rather than writing it. */
  memory?: boolean
  /** Modules a lazily loaded chunk holds, whose atoms the split moves into a sheet of their own. */
  lazy?: string[]
  /** Run once the output's files are on disk, before the write is observed. */
  beforeObserver?: () => Promise<unknown> | void
  /** The entry chunk's file name, which a hashed one changes from build to build. */
  entryName?: string
  /** The name Vite gives the sheet; it moves when what is extracted does. */
  sheetName?: string
}

/** Drives every hook of the plugin a Vite environment build reaches, in order, against one project. */
const createRun = async (cwd: string, watch: boolean, announced: string[] | false) => {
  const list = bamboocss({ cwd, reportSummary: false })
  const css = list.find((plugin) => plugin.name === 'bamboocss:css')!
  const early = list.find((plugin) => plugin.name === 'bamboocss:css-early')!
  const compiler = list.find((plugin) => plugin.name === 'bamboocss:compiler')!
  const resolvedCss = hookOf(css.resolveId).call({}, VIRTUAL_CSS_ID, undefined, {}) as string
  const plugins: Plugin[] = []
  const config = {
    command: 'build',
    root: cwd,
    build: { sourcemap: false, watch: watch ? {} : null, cssCodeSplit: true },
    css: {},
    configFileDependencies: [],
    plugins,
    ...(announced ? { builder: {}, environments: Object.fromEntries(announced.map((name) => [name, {}])) } : {}),
  }
  const exitListeners = new Set(process.listeners('beforeExit'))
  await hookOf(css.configResolved).call({}, config)
  await hookOf(compiler.configResolved).call({}, config)
  const exitWarnings = process.listeners('beforeExit').filter((listener) => !exitListeners.has(listener))
  for (const listener of exitWarnings) process.off('beforeExit', listener)
  const observer = plugins.find((plugin) => plugin.name === 'bamboocss:output-write-observer')!
  const memoryCommitter = plugins.find((plugin) => plugin.name === 'bamboocss:output-memory-committer')!
  const outputs = new Map<string, { dir: string; plugins: Array<Record<string, unknown>> }>()

  /** One generation, in two halves: `start` runs it through `transform`, what it returns the rest. */
  const start = async (
    spec: EnvironmentSpec,
    modules: Array<{ id: string; code: string }>,
    behaviour: Behaviour = {},
  ) => {
    const environment = {
      name: spec.name,
      config: { consumer: spec.consumer, build: { sourcemap: false, cssCodeSplit: true, ...spec.build } },
    }
    const imports = behaviour.imports ?? false
    const ids = [
      ...modules.map((module) => module.id),
      ...(imports === 'sheet'
        ? [resolvedCss]
        : imports === 'url'
          ? [`${resolvedCss}?url`, `${resolvedCss}?transform-only`]
          : []),
    ]
    const context = { addWatchFile() {}, environment, getModuleIds: () => ids.values(), getModuleInfo: () => null }
    const dir = join(cwd, `out-${spec.name}`)
    let output = outputs.get(spec.name)
    if (!output) {
      output = { dir, plugins: [] }
      outputs.set(spec.name, output)
    }
    hookOf(compiler.options).call({ environment }, { output })
    const [startMarker] = output.plugins
    const finalizer = output.plugins.at(-1)!
    hookOf(observer.buildStart).call(context)
    await hookOf(css.buildStart).call(context, {})
    await hookOf(compiler.buildStart).call(context, {})
    const sheet = imports ? ((await hookOf(css.load).call(context, resolvedCss, {})) as string) : undefined
    for (const module of modules) await hookOf(compiler.transform).call(context, module.code, module.id, {})

    return async () => {
      hookOf(compiler.buildEnd).call(context, undefined)
      hookOf(startMarker!.renderStart).call(context)
      hookOf(early.renderStart).call(context, output)
      if (behaviour.empty) rmSync(dir, { recursive: true, force: true })
      const sheetName = behaviour.sheetName ?? 'assets/style-ORIGINAL.css'
      const lazy = new Set(behaviour.lazy ?? [])
      const chunk = (fileName: string, isEntry: boolean, ids: string[], code: string) => ({
        type: 'chunk',
        fileName,
        name: fileName.replace(/\.js$/, ''),
        isEntry,
        imports: [],
        modules: Object.fromEntries(ids.map((id) => [id, {}])),
        code,
        viteMetadata: { importedCss: new Set<string>() },
      })
      const bundle: Record<string, Record<string, unknown>> = {
        [behaviour.entryName ?? 'entry.js']: chunk(
          behaviour.entryName ?? 'entry.js',
          true,
          modules.map((module) => module.id).filter((id) => !lazy.has(id)),
          imports === 'url' ? `export const href = "/${sheetName}"\n` : `export const x = 1\n`,
        ),
        ...(lazy.size ? { 'lazy.js': chunk('lazy.js', false, [...lazy], `export const y = 1\n`) } : {}),
        ...(sheet === undefined
          ? {}
          : { [sheetName]: { type: 'asset', fileName: sheetName, names: [], originalFileNames: [], source: sheet } }),
      }
      // What lets the early pass split the sheet per chunk.
      let emitted = 0
      const outputContext = {
        environment,
        emitFile: (file: { name?: string; source: string }) => {
          const fileName = `assets/${(file.name ?? 'chunk.css').replace(/\.css$/, '')}-${++emitted}.css`
          bundle[fileName] = { type: 'asset', fileName, names: [], originalFileNames: [], source: file.source }
          return fileName
        },
        getFileName: (reference: string) => reference,
      }
      const write = !behaviour.memory
      await hookOf(early.generateBundle).call(outputContext, output, bundle, write)
      behaviour.afterEarly?.(bundle)
      if (behaviour.discard) {
        for (const key of Object.keys(bundle)) if (bundle[key]!.type === 'asset') delete bundle[key]
      }
      await behaviour.between?.(bundle)
      await hookOf(css.generateBundle).call(outputContext, output, bundle, write)
      if (behaviour.reject) throw new Error(`a later plugin rejected the ${spec.name} output`)
      hookOf(finalizer.generateBundle).call(output, output, bundle, write)
      if (!write) {
        await hookOf(memoryCommitter.closeBundle).call(context)
        return bundle
      }
      for (const entry of Object.values(bundle)) {
        const path = join(dir, entry.fileName as string)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, (entry.type === 'asset' ? entry.source : entry.code) as string)
      }
      await behaviour.beforeObserver?.()
      await hookOf(observer.writeBundle).call(context, output, bundle)
      return bundle
    }
  }
  const round = async (spec: EnvironmentSpec, modules: Array<{ id: string; code: string }>, behaviour?: Behaviour) =>
    (await start(spec, modules, behaviour))()

  const sheets = (name: string) => {
    const walk = (directory: string): string[] =>
      existsSync(directory)
        ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
            entry.isDirectory()
              ? walk(join(directory, entry.name))
              : entry.name.endsWith('.css')
                ? [join(directory, entry.name)]
                : [],
          )
        : []
    return walk(join(cwd, `out-${name}`))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
  }
  /** Every stylesheet the server's written entry links, and whether the client wrote it. */
  const serverLinks = () =>
    [...readFileSync(join(cwd, 'out-ssr/entry.js'), 'utf8').matchAll(/assets\/[\w.-]+\.css/g)].map(([href]) => ({
      href,
      written: existsSync(join(cwd, 'out-client', href)),
    }))
  /** What the process says as it exits. */
  const exit = () => {
    const warnings: string[] = []
    const spy = vi
      .spyOn(logger, 'warn')
      .mockImplementation((_scope: string, message: string) => void warnings.push(message))
    try {
      for (const listener of exitWarnings) (listener as (code: number) => void)(0)
    } finally {
      spy.mockRestore()
    }
    return warnings
  }
  return { start, round, sheets, serverLinks, exit }
}

describe('a watch round with a sibling replacing its output', () => {
  /**
   * Its output pass ran before this environment began replacing, so its sheet was pruned unheld
   * and is final. Read past as one still to be pruned, the class shipped with no rule and no error.
   */
  test("one environment's whole build between the other's output pass and its write still fails the guard", async () => {
    const cwd = createProject()
    const widths = { kept: '75.1px', pruned: '75.2px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.pruned))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }]
    await run.round(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    let failure: unknown
    await run.round(client, clientModules, {
      imports: 'sheet',
      between: async () => {
        await run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.pruned) }]).catch((error) => {
          failure = error
        })
      },
    })

    expect(String(failure)).toContain('already pruned out of a stylesheet')
    expect(String(failure)).toContain('w_\\[75\\.2px\\]')
  })

  /**
   * Nothing reports an output another plugin rejects after Bamboo's output pass, and the
   * environment went on replacing an output it never wrote: an SSR rebuild alone, newly using a
   * class the sheet on disk lacks, passed.
   */
  test('an output rejected after the output pass still answers for what its sheet lost', async () => {
    const cwd = createProject()
    const widths = { kept: '71.1px', fresh: '71.2px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }]
    await run.round(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    await expect(run.round(client, clientModules, { imports: 'sheet', reject: true })).rejects.toThrow(
      'a later plugin rejected the client output',
    )
    await expect(run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }])).rejects.toThrow(
      'already pruned out of a stylesheet',
    )
  })

  /**
   * A sheet pruned while a sibling replaced its output, whose own output then failed in one of
   * Bamboo's output hooks, which no hook reports: the environment went on replacing an output it
   * never wrote, and a sibling's guard read past its sheet for good. The sheet on disk is the old
   * one, and the guard reads what that lost.
   */
  test('a sheet whose output Bamboo itself failed is not read past', async () => {
    const cwd = createProject()
    const widths = { kept: '76.1px', fresh: '76.2px', more: '76.3px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept, widths.more))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = (...used: string[]) => [{ id: clientId, code: source(`'virtual:bamboo.css'`, ...used) }]
    await run.round(client, clientModules(widths.kept), { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    // SSR is replacing its output while the client's sheet is pruned; the client's output then
    // loses the sheet, and the late pass fails the output.
    const finishSsr = await run.start(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }])
    await expect(
      run.round(client, clientModules(widths.kept, widths.more), { imports: 'sheet', discard: true }),
    ).rejects.toThrow('no emitted asset carries the generated stylesheet')
    await expect(finishSsr()).rejects.toThrow('already pruned out of a stylesheet')
  })

  /**
   * A class both newly use, while the client's output pass ran before SSR began replacing: the
   * client's new sheet keeps it, and only the one it replaces lost it. Read with the old sheet's
   * losses, SSR's rebuild failed on a sheet about to be replaced by one holding the class.
   */
  test("a class the replacing sheet keeps is not refused for the old sheet's losing it", async () => {
    const cwd = createProject()
    const widths = { kept: '81.1px', both: '81.2px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept, widths.both))
    writeFileSync(serverId, source(false, widths.kept, widths.both))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    await run.round(client, [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }], { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])
    expect(run.sheets('client')).not.toContain('81\\.2px')

    await run.round(client, [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept, widths.both) }], {
      imports: 'sheet',
      between: () => run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.both) }]),
    })
    expect(withoutMergeCodes(run.sheets('client'))).toContain('.w_\\[81\\.2px\\]')
  })

  /**
   * SSR began replacing before the client's output pass, which another plugin then rejected:
   * nothing reports that, and the client goes on replacing an output it never writes. Standing
   * aside for it, SSR's guard has the sheet on disk pruned again once its own output is written, and
   * again on each SSR rebuild after it, so that sheet holds every class SSR's written output uses.
   */
  test('a sheet stood aside for is pruned again with the output that stood aside, written or not', async () => {
    const cwd = createProject()
    const widths = { kept: '82.1px', fresh: '82.2px', later: '82.4px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh, widths.later))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }]
    await run.round(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    const finishSsr = await run.start(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }])
    await expect(run.round(client, clientModules, { imports: 'sheet', reject: true })).rejects.toThrow(
      'a later plugin rejected the client output',
    )
    await finishSsr()
    expect(withoutMergeCodes(run.sheets('client'))).toContain('.w_\\[82\\.2px\\]')

    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh, widths.later) }])
    expect(withoutMergeCodes(run.sheets('client'))).toContain('.w_\\[82\\.4px\\]')
  })

  /**
   * The client's previous sheet still waited for SSR when its next output pass pruned a final one:
   * that one, about to be written, is what the guard reads, and an older sheet waiting to be pruned
   * again does not hide it.
   */
  test("a sheet still waiting from an earlier round does not hide the client's final one", async () => {
    const cwd = createProject()
    const widths = { kept: '87.1px', fresh: '87.2px', later: '87.3px', clientNew: '87.4px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept, widths.clientNew))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh, widths.later))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = (...used: string[]) => [{ id: clientId, code: source(`'virtual:bamboo.css'`, ...used) }]
    await run.round(client, clientModules(widths.kept), { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    const finishFirstSsr = await run.start(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }])
    await run.round(client, clientModules(widths.kept), { imports: 'sheet' })
    let secondSsr: unknown
    const finishSecondClient = await run.start(client, clientModules(widths.kept, widths.clientNew), {
      imports: 'sheet',
      between: async () => {
        await run
          .round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh, widths.later) }])
          .catch((error: unknown) => {
            secondSsr = error
          })
      },
    })
    await finishFirstSsr()
    await finishSecondClient()
    expect(String(secondSsr)).toContain('w_\\[87\\.3px\\]')
  })

  /**
   * SSR's guard stood aside for the client's written sheet; the client then built again, and
   * Bamboo's late pass failed that output. The sheet stood aside for is the one still on disk, and
   * is pruned again with SSR's output all the same.
   */
  test('a sheet stood aside for stays so through a later output of its own that fails', async () => {
    const cwd = createProject()
    const widths = { kept: '84.1px', fresh: '84.2px', more: '84.3px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept, widths.more))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = (...used: string[]) => [{ id: clientId, code: source(`'virtual:bamboo.css'`, ...used) }]
    await run.round(client, clientModules(widths.kept), { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    const finishSsr = await run.start(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }], {
      between: async () => {
        await expect(
          run.round(client, clientModules(widths.kept, widths.more), { imports: 'sheet', discard: true }),
        ).rejects.toThrow('no emitted asset carries the generated stylesheet')
      },
    })
    await run.round(client, clientModules(widths.kept), { imports: 'sheet' })
    await finishSsr()
    expect(withoutMergeCodes(run.sheets('client'))).toContain('.w_\\[84\\.2px\\]')
  })

  /**
   * The sheet SSR's guard stood aside for was extracted before SSR's class was: pruned again from
   * that source, it can restore nothing for it, which the client's own build writes. Checked for a
   * rule it cannot have, the prune failed SSR's write — in an output that did nothing wrong.
   */
  test("a sheet stood aside for, extracted before the class the sibling adds, does not fail the sibling's write", async () => {
    const cwd = createProject()
    const widths = { kept: '88.1px', added: '88.2px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }]
    await run.round(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    // The client starts replacing its output, and an edit adds a class only SSR's output names. The
    // client's round read its sheet before the edit, and is refused for that class in its own output
    // pass; the edit's own client round writes its rule.
    const finishStaleClient = await run.start(client, clientModules, { imports: 'sheet' })
    writeFileSync(serverId, source(false, widths.kept, widths.added))
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.added) }])
    await expect(finishStaleClient()).rejects.toThrow('NOT extracted')
    await run.round(client, clientModules, { imports: 'sheet' })
    expect(withoutMergeCodes(run.sheets('client'))).toContain('.w_\\[88\\.2px\\]')
  })

  /**
   * An edit makes SSR use a class nothing extracted before, and SSR writes while the client is
   * still replacing its output: the client's sheet on disk, stood aside for, is from before the
   * class, and its own round writes the rule. Pruned again then and checked for that rule, the
   * sheet failed SSR's write.
   */
  test('a class the sibling adds does not fail its write for the sheet still on disk', async () => {
    const cwd = createProject()
    const widths = { kept: '93.1px', added: '93.2px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }]
    await run.round(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    writeFileSync(serverId, source(false, widths.kept, widths.added))
    const finishClient = await run.start(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.added) }])
    await finishClient()
    expect(withoutMergeCodes(run.sheets('client'))).toContain('.w_\\[93\\.2px\\]')
  })

  /**
   * Held in memory, a sheet has no file to prune again, so it waits for nothing: a sibling's guard
   * reads what it lost, as nothing else answers for it. Waiting for a sibling's replacement for
   * good, it was read past on every rebuild after.
   */
  test('a sheet held in memory is read, on every rebuild of a sibling', async () => {
    const cwd = createProject()
    const widths = { kept: '91.1px', fresh: '91.2px', other: '91.3px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh, widths.other))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }]
    await run.round(client, clientModules, { imports: 'sheet', memory: true })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }], { memory: true })

    const finishSsr = await run.start(ssr, [{ id: serverId, code: source(false, widths.kept, widths.other) }], {
      memory: true,
    })
    await run.round(client, clientModules, { imports: 'sheet', memory: true })
    await expect(finishSsr()).rejects.toThrow('w_\\[91\\.3px\\]')
    await expect(
      run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }], { memory: true }),
    ).rejects.toThrow('w_\\[91\\.2px\\]')
  })

  /**
   * A first build's sheet, held for the run, is finalized when its last environment completes it —
   * against a sibling's old output, when that sibling is replacing it then. Stood aside for, it is
   * pruned again once the sibling's new output is written.
   */
  test("a sheet held for the run is pruned again with a sibling's output written after the run completes", async () => {
    const cwd = createProject()
    const widths = { kept: '92.1px', later: '92.2px', edgeOnly: '92.3px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    const edgeId = join(cwd, 'src/edge.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.later))
    writeFileSync(edgeId, source(false, widths.edgeOnly))
    const edge: EnvironmentSpec = { name: 'edge', consumer: 'server', build: { ssr: true, emitAssets: false } }
    const run = await createRun(cwd, true, ['client', 'ssr', 'edge'])
    await run.round(client, [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }], { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.later) }], {
      between: () => run.round(edge, [{ id: edgeId, code: source(false, widths.edgeOnly) }]),
    })
    expect(withoutMergeCodes(run.sheets('client'))).toContain('.w_\\[92\\.2px\\]')
  })

  /**
   * Its environment had written a file of the same name, not yet recorded as that output's, when a
   * sibling's write made it due: pruned again then, the file the new output links was renamed from
   * under it. That file is the newer output's to answer for, as its write is observed.
   */
  test('a sheet is not pruned again from under a newer output of its own name', async () => {
    const cwd = createProject()
    const widths = { kept: '89.1px', fresh: '89.2px' }
    const appId = join(cwd, 'src/app.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(appId, source(`href from 'virtual:bamboo.css?url'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const app = [{ id: appId, code: source(`href from 'virtual:bamboo.css?url'`, widths.kept) }]
    await run.round(client, app, { imports: 'url' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    // The client rebuilds to the same bytes, under the same name; SSR, newly using a class the
    // sheet lost, stood aside for the client, and is written between the client's files and the
    // client's write being observed.
    const finishSsr = await run.start(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }])
    const finishClient = await run.start(client, app, {
      imports: 'url',
      beforeObserver: finishSsr,
      entryName: 'entry-2.js',
    })
    await finishClient()
    const linked = readFileSync(join(cwd, 'out-client/entry-2.js'), 'utf8').match(/assets\/[\w.-]+\.css/)![0]
    expect(existsSync(join(cwd, 'out-client', linked)), `the client links ${linked}, which is not there`).toBe(true)
    expect(withoutMergeCodes(readFileSync(join(cwd, 'out-client', linked), 'utf8'))).toContain('.w_\\[89\\.2px\\]')
  })

  /**
   * Pruned again as its own output is written, the sheet's new name reaches the bundle a later
   * plugin's `writeBundle` reads, as it reaches the files on disk.
   */
  test('a sheet pruned again in its own write is renamed in the bundle later plugins read', async () => {
    const cwd = createProject()
    const widths = { kept: '90.1px', fresh: '90.2px' }
    const appId = join(cwd, 'src/app.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(appId, source(`href from 'virtual:bamboo.css?url'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const app = [{ id: appId, code: source(`href from 'virtual:bamboo.css?url'`, widths.kept) }]
    await run.round(client, app, { imports: 'url' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    // SSR is replacing as the client's output pass prunes its sheet, and is written before the
    // client's own output is.
    const finishSsr = await run.start(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }])
    const bundle = await run.round(client, app, { imports: 'url', between: finishSsr })
    const sheet = Object.values(bundle).find((output) => output.type === 'asset')!.fileName as string
    expect(bundle['entry.js']!.code).toContain(`/${sheet}`)
    expect(withoutMergeCodes(readFileSync(join(cwd, 'out-client', sheet), 'utf8'))).toContain('.w_\\[90\\.2px\\]')
  })

  /**
   * Pruned again from a source extracted before a class was dropped from what is extracted, a
   * sheet keeps that class's rule, which nothing names: no rule came back that anything needs, and
   * the sheet keeps its name rather than being renamed for a dead rule.
   */
  test('a sheet is not renamed for a rule only a dropped class had', async () => {
    const cwd = createProject()
    const widths = { kept: '94.1px', dropped: '94.2px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    const droppedId = join(cwd, 'src/dropped.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept))
    // Extracted, and named by nothing: the client's sheet prunes it.
    writeFileSync(droppedId, source(false, widths.dropped))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }]
    await run.round(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])
    const written = readdirSync(join(cwd, 'out-client/assets'))

    rmSync(droppedId)
    const finishClient = await run.start(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])
    expect(readdirSync(join(cwd, 'out-client/assets'))).toEqual(written)
    await finishClient()
  })

  /**
   * The other order of the run completing: a sibling's new output is written first, and the sheet
   * held for the run is pruned again then, under a new name. The run's finalization prunes that
   * file, not the one it was held under, which is gone.
   */
  test("a sheet held for the run, pruned again with a sibling's output first, is finalized as the run completes", async () => {
    const cwd = createProject()
    const widths = { kept: '94.1px', later: '94.2px', edgeOnly: '94.3px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    const edgeId = join(cwd, 'src/edge.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.later))
    writeFileSync(edgeId, source(false, widths.edgeOnly))
    const edge: EnvironmentSpec = { name: 'edge', consumer: 'server', build: { ssr: true, emitAssets: false } }
    const run = await createRun(cwd, true, ['client', 'ssr', 'edge'])
    await run.round(client, [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }], { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept, widths.later) }])
    await run.round(edge, [{ id: edgeId, code: source(false, widths.edgeOnly) }])
    expect(withoutMergeCodes(run.sheets('client'))).toContain('.w_\\[94\\.2px\\]')
    expect(withoutMergeCodes(run.sheets('client'))).toContain('.w_\\[94\\.3px\\]')
  })

  /** A sheet written again with the same bytes after it was recorded is the same sheet, pruned again. */
  test('a sheet rewritten with its own bytes is still pruned again', async () => {
    const cwd = createProject()
    const widths = { kept: '95.1px', fresh: '95.2px' }
    const clientId = join(cwd, 'src/client.tsx')
    const serverId = join(cwd, 'src/server.tsx')
    writeFileSync(clientId, source(`'virtual:bamboo.css'`, widths.kept))
    writeFileSync(serverId, source(false, widths.kept, widths.fresh))
    const run = await createRun(cwd, true, ['client', 'ssr'])
    const clientModules = [{ id: clientId, code: source(`'virtual:bamboo.css'`, widths.kept) }]
    await run.round(client, clientModules, { imports: 'sheet' })
    await run.round(ssr, [{ id: serverId, code: source(false, widths.kept) }])

    const finishSsr = await run.start(ssr, [{ id: serverId, code: source(false, widths.kept, widths.fresh) }])
    await run.round(client, clientModules, { imports: 'sheet' })
    // What a later plugin's `writeBundle`, or any tool, may do: the same bytes, written again.
    await new Promise((settle) => setTimeout(settle, 20))
    const assets = join(cwd, 'out-client/assets')
    for (const file of readdirSync(assets)) writeFileSync(join(assets, file), readFileSync(join(assets, file)))
    await finishSsr()
    expect(withoutMergeCodes(run.sheets('client'))).toContain('.w_\\[95\\.2px\\]')
  })
})

describe("a server's link to its discarded copy of the sheet", () => {
  const setUp = async (watch: boolean) => {
    const cwd = createProject()
    const widths = { kept: '72.1px', fresh: '72.2px', clientOnly: '72.3px' }
    const appId = join(cwd, 'src/app.tsx')
    writeFileSync(appId, source(`href from 'virtual:bamboo.css?url'`, widths.kept))
    // Extracted, and reached by nothing until an edit reaches it.
    writeFileSync(join(cwd, 'src/inventory.tsx'), source(false, widths.fresh, widths.clientOnly))
    const run = await createRun(cwd, watch, ['client', 'ssr'])
    const app = (...used: string[]) => [{ id: appId, code: source(`href from 'virtual:bamboo.css?url'`, ...used) }]
    return { run, app, widths }
  }
  const written = (links: Array<{ href: string; written: boolean }>) => {
    expect(links).not.toEqual([])
    for (const link of links)
      expect(link, `${link.href} is not in the client's output`).toMatchObject({ written: true })
  }

  test('names the sheet the client wrote first', async () => {
    const { run, app, widths } = await setUp(false)
    await run.round(client, app(widths.kept), { imports: 'url' })
    await run.round(ssr, app(widths.kept), { imports: 'url', discard: true })
    written(run.serverLinks())
  })

  test('written first, moves to the sheet the client writes after it', async () => {
    const { run, app, widths } = await setUp(false)
    await run.round(ssr, app(widths.kept), { imports: 'url', discard: true })
    await run.round(client, app(widths.kept, widths.fresh), { imports: 'url' })
    written(run.serverLinks())
    expect(run.exit()).toEqual([])
  })

  /**
   * The edit moves reachability and not what is extracted, so Vite's name for the sheet stays, and
   * SSR's output, first, took the name the client's sheet had before. That sheet is gone once the
   * output directory is emptied, and nothing moved the link.
   */
  test('in a watch, moves with a sheet the client writes again after it', async () => {
    const { run, app, widths } = await setUp(true)
    await run.round(client, app(widths.kept), { imports: 'url', empty: true })
    await run.round(ssr, app(widths.kept), { imports: 'url', discard: true, empty: true })
    const finishClient = await run.start(client, app(widths.kept, widths.fresh), { imports: 'url', empty: true })
    await run.round(ssr, app(widths.kept, widths.fresh), { imports: 'url', discard: true, empty: true })
    await finishClient()
    written(run.serverLinks())
  })

  /**
   * The edit changes what is extracted, so Vite names the sheet anew. The client named and wrote
   * its sheet between SSR's output pass and SSR's write, and the link was moved in SSR's files from
   * the round before, which the write after it replaced.
   */
  test('in a watch, moves only the links its own written output makes', async () => {
    const { run, app, widths } = await setUp(true)
    await run.round(client, app(widths.kept), { imports: 'url', empty: true })
    await run.round(ssr, app(widths.kept), { imports: 'url', discard: true, empty: true })
    const sheetName = 'assets/style-CHANGED.css'
    // The client reaches a class SSR does not, so the sheet it writes is named after other bytes.
    const finishClient = await run.start(client, app(widths.kept, widths.fresh, widths.clientOnly), {
      imports: 'url',
      empty: true,
      sheetName,
    })
    await run.round(ssr, app(widths.kept, widths.fresh), {
      imports: 'url',
      discard: true,
      empty: true,
      sheetName,
      between: finishClient,
    })
    written(run.serverLinks())
  })

  test('says so as the process exits when no sheet of its name was ever written', async () => {
    const { run, app, widths } = await setUp(false)
    await run.round(ssr, app(widths.kept), { imports: 'url', discard: true })
    expect(run.exit().join('\n')).toContain('"ssr" links assets/style-ORIGINAL')
  })

  /**
   * Imported for its effect, the copy is linked by nothing, and nothing has to serve its name — a
   * manifest listing it, as Vite's does when asked for one, links nothing either.
   */
  test('says nothing for a copy its output never links', async () => {
    const cwd = createProject()
    const entry = join(cwd, 'src/entry.server.tsx')
    writeFileSync(entry, source(`'virtual:bamboo.css'`, '74.1px'))
    writeFileSync(join(cwd, 'src/unused.tsx'), source(false, '74.2px'))
    const run = await createRun(cwd, false, false)
    let copy = ''
    await run.round(ssr, [{ id: entry, code: source(`'virtual:bamboo.css'`, '74.1px') }], {
      imports: 'sheet',
      discard: true,
      afterEarly: (bundle) => {
        copy = Object.values(bundle).find((output) => output.type === 'asset')!.fileName as string
      },
      between: (bundle) => {
        const manifest = JSON.stringify({ 'src/entry.server.tsx': { file: 'entry.js', css: [copy] } })
        bundle['.vite/manifest.json'] = { type: 'asset', fileName: '.vite/manifest.json', source: manifest }
      },
    })
    expect(copy).toMatch(/\.css$/)
    expect(run.exit()).toEqual([])
  })

  /**
   * Held in memory, the client's sheet is written nowhere, and still the name a copy takes: split
   * per chunk where the server inlines the chunk, its bytes are not the copy's.
   */
  test("names the sheet the client's output held in memory", async () => {
    const cwd = createProject()
    const appId = join(cwd, 'src/app.tsx')
    const lazyId = join(cwd, 'src/lazy.tsx')
    writeFileSync(appId, source(`href from 'virtual:bamboo.css?url'`, '86.1px'))
    writeFileSync(lazyId, source(false, '86.2px'))
    writeFileSync(join(cwd, 'src/unused.tsx'), source(false, '86.3px'))
    const run = await createRun(cwd, false, ['client', 'ssr'])
    const modules = [
      { id: appId, code: source(`href from 'virtual:bamboo.css?url'`, '86.1px') },
      { id: lazyId, code: source(false, '86.2px') },
    ]
    const clientBundle = await run.round(client, modules, { imports: 'url', memory: true, lazy: [lazyId] })
    const serverBundle = await run.round(ssr, modules, { imports: 'url', discard: true, memory: true })
    const sheet = (clientBundle['entry.js']!.code as string).match(/assets\/[\w.-]+\.css/)![0]
    expect(Object.keys(clientBundle).filter((name) => name.endsWith('.css'))).toHaveLength(2)
    expect(serverBundle['entry.js']!.code).toContain(`/${sheet}`)
  })
})
