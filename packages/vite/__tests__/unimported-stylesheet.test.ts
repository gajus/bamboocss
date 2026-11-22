import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { unimportedStylesheetWarning } from '../src/css'
import { UNIMPORTED_STYLESHEET_GRACE_MS, watchUnimportedStylesheet } from '../src/unimported-stylesheet'

/**
 * A dev server compiling classes for a page that never imports `virtual:bamboo.css` said nothing,
 * and the page rendered unstyled; only a build failed on it. It says so once now, when the server
 * has gone quiet after serving something.
 */
describe('a dev server with nothing importing the stylesheet', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const server = () => {
    let middleware: Parameters<Parameters<typeof watchUnimportedStylesheet>[0]>[0] | undefined
    const warnings: string[][] = []
    const watch = watchUnimportedStylesheet(
      (handler) => {
        middleware = handler
      },
      (compiled) => warnings.push([...compiled]),
    )
    /** A request, answered when the returned function is called. */
    const request = () => {
      const response = new EventEmitter()
      middleware!({} as IncomingMessage, response as unknown as ServerResponse, () => {})
      return () => response.emit('close')
    }
    const quiet = () => vi.advanceTimersByTime(UNIMPORTED_STYLESHEET_GRACE_MS)
    return { watch, request, quiet, warnings }
  }

  test('says so once, naming what was compiled, when the server goes quiet', () => {
    const { watch, request, quiet, warnings } = server()

    const answer = request()
    watch.compiled('/app/src/app.tsx')
    watch.compiled('/app/src/button.tsx')
    answer()
    quiet()
    quiet()
    request()()
    quiet()

    expect(warnings).toEqual([['/app/src/app.tsx', '/app/src/button.tsx']])
  })

  test('says nothing once the stylesheet is asked for, before or after the compile', () => {
    for (const order of ['loaded first', 'compiled first']) {
      const { watch, request, quiet, warnings } = server()

      const answer = request()
      if (order === 'loaded first') watch.loaded()
      watch.compiled('/app/src/app.tsx')
      if (order === 'compiled first') watch.loaded()
      answer()
      quiet()

      expect(warnings, order).toEqual([])
    }
  })

  // `server.warmup` transforms modules at start-up, before anything has loaded the entry.
  test('waits for a request before judging what was compiled', () => {
    const { watch, request, quiet, warnings } = server()

    watch.compiled('/app/src/app.tsx')
    quiet()
    expect(warnings).toEqual([])

    request()()
    quiet()
    expect(warnings).toHaveLength(1)
  })

  // A slow render can load the stylesheet last.
  test('waits for every request still open', () => {
    const { watch, request, quiet, warnings } = server()

    const render = request()
    watch.compiled('/app/src/app.tsx')
    request()()
    quiet()
    expect(warnings).toEqual([])

    watch.loaded()
    render()
    quiet()
    expect(warnings).toEqual([])
  })

  test('says nothing where nothing was compiled', () => {
    const { request, quiet, warnings } = server()

    request()()
    quiet()

    expect(warnings).toEqual([])
  })

  test('says which module, how many, and that a build fails', () => {
    expect(unimportedStylesheetWarning('/app', new Set(['/app/src/app.tsx']))).toBe(
      'bamboocss: src/app.tsx was compiled to Bamboo class values, but nothing has imported "virtual:bamboo.css", ' +
        'so it renders unstyled. Add `import "virtual:bamboo.css"` once, from a JavaScript or TypeScript module in ' +
        'the application entry graph; `vite build` fails until it is there.',
    )
    expect(unimportedStylesheetWarning('/app', new Set(['/app/src/app.tsx', '/app/src/button.tsx']))).toContain(
      '2 modules, src/app.tsx among them, were compiled to Bamboo class values, but nothing has imported ' +
        '"virtual:bamboo.css", so they render unstyled.',
    )
  })
})
