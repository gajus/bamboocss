import { describe, expect, test } from 'vitest'
import { createCompilationHost, type CompilationBuilder } from '../src/compilation-host'

/**
 * A Builder with the four members the host touches, and a way to replace its context.
 *
 * Deliberately not the real one: what is under test is who calls `setup`, how often, and what
 * may run while a stylesheet pass holds the shared AST. A real Builder would answer all of
 * that through a config load and a ts-morph project, which is `plugin.test.ts`'s job.
 */
const stubBuilder = () => {
  const newContext = () => ({ encoder: { clone: () => ({ owner: 'clone' }) } })

  let context = newContext()
  let failNext: Error | undefined
  const setups: Array<{ dev?: boolean }> = []
  const reloaded: string[] = []
  const removed: string[] = []

  const builder = {
    get context() {
      return context
    },
    getContextOrThrow: () => context,
    setup: async (options: { dev?: boolean }) => {
      setups.push(options)
      if (!failNext) return
      const thrown = failNext
      failNext = undefined
      throw thrown
    },
    reloadSource: (filePath: string) => {
      reloaded.push(filePath)
    },
    removeSource: (filePath: string) => {
      removed.push(filePath)
    },
  }

  return {
    builder: builder as unknown as CompilationBuilder,
    setups,
    reloaded,
    removed,
    failNextSetup: (error: Error) => {
      failNext = error
    },
    replaceContext: () => {
      context = newContext()
    },
  }
}

const hostOf = () => {
  const stub = stubBuilder()
  return { stub, host: createCompilationHost({ loadBuilder: async () => stub.builder }) }
}

describe('the compilation host', () => {
  /**
   * The compiler runs `enforce: 'pre'`, so its `buildStart` reaches the host before the CSS
   * plugin's does. Both used to load a config: the compiler its own, the CSS plugin the
   * Builder's. One setup for the pair is the point of the host, and the pre-hook must not
   * consume the change detection the stylesheet pass depends on either.
   */
  test('answers the compiler pre-hook and the stylesheet pass that follows it with one setup', async () => {
    const { host, stub } = hostOf()

    const early = await host.ensureGeneration()
    const passed = await host.runCssPass(async (builder, generation) => {
      expect(builder).toBe(stub.builder)
      return generation
    })

    expect(stub.setups).toHaveLength(1)
    expect(passed).toBe(early)
  })

  test('joins concurrent environments to one setup rather than reloading the config per hook', async () => {
    const { host, stub } = hostOf()

    const [client, ssr, sheet] = await Promise.all([
      host.ensureGeneration(),
      host.ensureGeneration(),
      host.runCssPass(async (_builder, generation) => generation),
    ])

    expect(stub.setups).toHaveLength(1)
    expect(client).toBe(ssr)
    expect(sheet).toBe(client)
  })

  test('runs a setup per stylesheet pass, since that is where changed files are selected', async () => {
    const { host, stub } = hostOf()

    await host.runCssPass(async () => undefined)
    await host.runCssPass(async () => undefined)

    expect(stub.setups).toHaveLength(2)
  })

  /**
   * `dev` is the one setup input a later setter could not correct: it reaches `hash: 'auto'`,
   * so the class names in the bundle are already named from it by the time anything else runs.
   */
  test('carries the resolved command into the Builder', async () => {
    const { host, stub } = hostOf()

    host.setCommand('serve')
    await host.ensureGeneration()

    expect(stub.setups).toEqual([expect.objectContaining({ dev: true })])
  })

  test('retries a failed setup for the next hook, publishing nothing from the attempt', async () => {
    const { host, stub } = hostOf()
    const failure = new Error('config file threw')
    stub.failNextSetup(failure)

    await expect(host.ensureGeneration()).rejects.toBe(failure)
    expect(host.current()).toBeUndefined()

    await expect(host.ensureGeneration()).resolves.toEqual(expect.objectContaining({ id: 1 }))
    expect(stub.setups).toHaveLength(2)
  })

  /**
   * Everything the compiler derives — the runtime `css`, the style-set compiler, the private
   * parse encoder — is a closure over one context, and `Builder.setup` replaces its context
   * when the config reloads. A generation whose identity did not change must stay the same
   * object, or the compiler re-derives on every transform for nothing.
   */
  test('is a new generation exactly when the Builder replaced its context', async () => {
    const { host, stub } = hostOf()

    const first = await host.runCssPass(async (_builder, generation) => generation)
    const unchanged = await host.runCssPass(async (_builder, generation) => generation)
    expect(unchanged).toBe(first)

    stub.replaceContext()
    const reloaded = await host.runCssPass(async (_builder, generation) => generation)

    expect(reloaded).not.toBe(first)
    expect(reloaded.id).toBe(first.id + 1)
    expect(reloaded.context).not.toBe(first.context)
  })

  /**
   * The compiler's parses must not reach the encoder the stylesheet is emitted from: they would
   * add a second, unowned contribution for every module in the graph. A clone is the seam.
   */
  test('hands the compiler a parse encoder the context does not emit from', async () => {
    const { host } = hostOf()

    const generation = await host.ensureGeneration()

    expect(generation.encoder).not.toBe(generation.context.encoder)
  })

  /**
   * Extraction fills the encoder and `toCss` reads it back, with a deliberate macrotask
   * between them. A fold landing in that window re-prepares a source the pass has already read.
   */
  test('holds compiler work until the stylesheet pass has finished', async () => {
    const { host } = hostOf()
    const order: string[] = []

    const pass = host.runCssPass(async () => {
      order.push('extract')
      await new Promise<void>((settle) => setImmediate(settle))
      order.push('toCss')
    })

    // Started while the pass is open, which is what a `pre` transform does on a dev server.
    const work = host.runCompilerWork(() => order.push('fold'))

    await Promise.all([pass, work])
    expect(order).toEqual(['extract', 'toCss', 'fold'])
    expect(host.isCssPassActive()).toBe(false)
  })

  test('does not publish the previous generation while a stylesheet setup is replacing it', async () => {
    const { host, stub } = hostOf()
    const previous = await host.runCssPass(async (_builder, generation) => generation)
    let setupStarted!: () => void
    let releaseSetup!: () => void
    const started = new Promise<void>((resolve) => {
      setupStarted = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      releaseSetup = resolve
    })
    stub.builder.setup = async () => {
      setupStarted()
      await blocked
      stub.replaceContext()
    }

    const pass = host.runCssPass(async (_builder, generation) => generation)
    await started
    let resolved = false
    const compiler = host.ensureGeneration().then((generation) => {
      resolved = true
      return generation
    })
    await new Promise<void>((settle) => setImmediate(settle))
    expect(resolved, 'the old generation must not escape while setup is active').toBe(false)

    releaseSetup()
    const [sheetGeneration, compilerGeneration] = await Promise.all([pass, compiler])
    expect(sheetGeneration.id).toBe(previous.id + 1)
    expect(compilerGeneration).toBe(sheetGeneration)
  })

  test('reports an open pass, so speculative work can decline instead of waiting', async () => {
    const { host } = hostOf()
    let active: boolean | undefined

    await host.runCssPass(async () => {
      active = host.isCssPassActive()
    })

    expect(active).toBe(true)
    expect(host.isCssPassActive()).toBe(false)
  })

  /**
   * The Builder owns the mutation because it snapshots the resolution ledger before the first
   * one — that snapshot is the graph the next extraction pass walks to find the edited file's
   * dependents, and reloading retracts the file's own forward edges.
   */
  test('routes source mutations through the Builder and re-runs setup for the next pass', async () => {
    const { host, stub } = hostOf()

    const before = await host.ensureGeneration()
    host.reloadSource('/app/src/edited.ts')
    host.removeSource('/app/src/deleted.ts')

    expect(stub.reloaded).toEqual(['/app/src/edited.ts'])
    expect(stub.removed).toEqual(['/app/src/deleted.ts'])

    await host.runCssPass(async () => undefined)
    // The pre-hook's setup predates the edit, so answering the pass with it would report
    // nothing changed. The context object is untouched, so the generation is still the same.
    expect(stub.setups).toHaveLength(2)
    expect(host.current()).toBe(before)
  })

  test('never overlaps two stylesheet passes over the one context', async () => {
    const { host } = hostOf()
    const order: string[] = []

    const first = host.runCssPass(async () => {
      order.push('first:start')
      await new Promise<void>((settle) => setImmediate(settle))
      order.push('first:end')
    })
    const second = host.runCssPass(async () => {
      order.push('second:start')
      order.push('second:end')
    })

    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  test('leaves the shared AST free after a stylesheet pass throws', async () => {
    const { host } = hostOf()
    const failure = new Error('toCss threw')

    await expect(
      host.runCssPass(async () => {
        throw failure
      }),
    ).rejects.toBe(failure)

    expect(host.isCssPassActive()).toBe(false)
    await expect(host.runCompilerWork(() => 'folded')).resolves.toBe('folded')
  })
})
