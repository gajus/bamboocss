// @vitest-environment node

import { logger } from '@bamboocss/logger'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadTsrxParser } from '../src/tsrx-to-tsx'

describe('the parser a `.tsrx` file is read with', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const requiring = (available: Record<string, unknown>) =>
    ((id: string) => {
      if (id in available) return available[id]
      throw Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' })
    }) as unknown as NodeJS.Require

  test('loads `parseModule` from `@tsrx/core`', () => {
    const parseModule = () => ({})
    expect(loadTsrxParser(requiring({ '@tsrx/core': { parseModule } }))).toEqual({ parseModule })
  })

  // A Node too old to `require` an ES module, or a broken install: the package is there, and
  // asking for it to be installed would send the reader the wrong way.
  test('says why one that is installed failed to load', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const broken = (() => {
      throw new Error('require() of ES Module not supported')
    }) as unknown as NodeJS.Require
    expect(loadTsrxParser(broken)).toBeNull()
    expect(warn).toHaveBeenCalledWith('tsrx', expect.stringContaining('failed to load'))
  })

  test('says when there is none', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    expect(loadTsrxParser(requiring({}))).toBeNull()
    expect(warn).toHaveBeenCalledWith('tsrx', expect.stringContaining('Install `@tsrx/core`'))
  })
})
