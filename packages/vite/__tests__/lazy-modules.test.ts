import { describe, expect, test, vi } from 'vitest'
import {
  createLazyBuilder,
  createLazyCssOutputModule,
  createLazyFoldModule,
  createRetryableLazy,
} from '../src/lazy-modules'

describe('lazy Vite dependencies', () => {
  test('shares one module load and Builder construction across concurrent callers', async () => {
    let finishLoad!: (module: { Builder: new () => { identity: string } }) => void
    let constructions = 0
    const loadNode = vi.fn(
      () =>
        new Promise<{ Builder: new () => { identity: string } }>((resolve) => {
          finishLoad = resolve
        }),
    )
    const getBuilder = createLazyBuilder(loadNode as never)

    const first = getBuilder()
    const concurrent = getBuilder()
    await vi.waitFor(() => expect(loadNode).toHaveBeenCalledTimes(1))

    finishLoad({
      Builder: class {
        identity = 'builder'

        constructor() {
          constructions++
        }
      },
    })

    const [firstBuilder, concurrentBuilder] = await Promise.all([first, concurrent])
    expect(firstBuilder).toBe(concurrentBuilder)
    expect((firstBuilder as unknown as { identity: string }).identity).toBe('builder')
    expect(loadNode).toHaveBeenCalledTimes(1)
    expect(constructions).toBe(1)

    expect(await getBuilder()).toBe(firstBuilder)
    expect(loadNode).toHaveBeenCalledTimes(1)
    expect(constructions).toBe(1)
  })

  test('clears only a rejected attempt so a later call can retry', async () => {
    const failure = new Error('temporary module failure')
    const value = { loaded: true }
    const load = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(value)
    const getValue = createRetryableLazy(load)

    const first = getValue()
    const concurrent = getValue()
    const failures = await Promise.allSettled([first, concurrent])

    expect(failures.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(failures.map((result) => (result.status === 'rejected' ? result.reason : undefined))).toEqual([
      failure,
      failure,
    ])
    expect(load).toHaveBeenCalledTimes(1)

    await expect(getValue()).resolves.toBe(value)
    expect(load).toHaveBeenCalledTimes(2)
    await expect(getValue()).resolves.toBe(value)
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('normalizes a synchronous loader throw into the retryable promise contract', async () => {
    const failure = new Error('synchronous loader failure')
    const load = vi.fn<() => string>()
    load.mockImplementationOnce(() => {
      throw failure
    })
    load.mockReturnValueOnce('recovered')
    const getValue = createRetryableLazy(load)

    await expect(getValue()).rejects.toBe(failure)
    await expect(getValue()).resolves.toBe('recovered')
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('shares a fold chunk across concurrent transforms and hot refolds, then retries a failed first load', async () => {
    const failure = new Error('temporary fold chunk failure')
    const foldModule = { foldSource: vi.fn() }
    let finishRetry!: (module: typeof foldModule) => void
    const load = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(
        () =>
          new Promise<typeof foldModule>((resolve) => {
            finishRetry = resolve
          }),
      )
    const getFoldModule = createLazyFoldModule(load as never)

    const clientTransform = getFoldModule()
    const ssrTransform = getFoldModule()
    await expect(Promise.allSettled([clientTransform, ssrTransform])).resolves.toEqual([
      expect.objectContaining({ status: 'rejected', reason: failure }),
      expect.objectContaining({ status: 'rejected', reason: failure }),
    ])
    expect(load).toHaveBeenCalledTimes(1)

    const retryingTransform = getFoldModule()
    const concurrentHotRefold = getFoldModule()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    finishRetry(foldModule)

    const [transformModule, refoldModule] = await Promise.all([retryingTransform, concurrentHotRefold])
    expect(transformModule).toBe(foldModule)
    expect(refoldModule).toBe(foldModule)
    expect(await getFoldModule()).toBe(foldModule)
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('loads no CSS-output code during construction, then shares and retries the first real output action', async () => {
    const failure = new Error('temporary CSS-output chunk failure')
    const cssOutputModule = { optimizeStaticCssAssets: vi.fn(), pruneStaticCss: vi.fn() }
    let finishRetry!: (module: typeof cssOutputModule) => void
    const load = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(
        () =>
          new Promise<typeof cssOutputModule>((resolve) => {
            finishRetry = resolve
          }),
      )
    const getCssOutputModule = createLazyCssOutputModule(load as never)

    // Constructing the boundary is what every synchronous `bamboocss()` factory call does.
    expect(load).not.toHaveBeenCalled()

    const clientLoad = getCssOutputModule()
    const ssrOutput = getCssOutputModule()
    await expect(Promise.allSettled([clientLoad, ssrOutput])).resolves.toEqual([
      expect.objectContaining({ status: 'rejected', reason: failure }),
      expect.objectContaining({ status: 'rejected', reason: failure }),
    ])
    expect(load).toHaveBeenCalledTimes(1)

    const retryingLoad = getCssOutputModule()
    const concurrentOutput = getCssOutputModule()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    finishRetry(cssOutputModule)

    const [loadModule, outputModule] = await Promise.all([retryingLoad, concurrentOutput])
    expect(loadModule).toBe(cssOutputModule)
    expect(outputModule).toBe(cssOutputModule)
    expect(await getCssOutputModule()).toBe(cssOutputModule)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
