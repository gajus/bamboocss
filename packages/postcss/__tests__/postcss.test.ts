import { join } from 'path'
import postcss from 'postcss'
import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { logger } from '@bamboocss/logger'
import { describe, expect, test } from 'vitest'

import bamboocss, { type PluginOptions } from '../src/index'

async function run(input: string, options: PluginOptions, from?: string) {
  return postcss([bamboocss(options)]).process(input, { from: from || '/foo.css' })
}

describe('PostCSS plugin', () => {
  test('skip node modules files', async () => {
    const input = '@layer reset, base, tokens, recipes, utilities;'
    const result = await run(input, {}, '/node_modules/foo.css')

    expect(result.css).toBe(input)
  })

  test('skip non-css files', async () => {
    const input = '@layer reset, base, tokens, recipes, utilities;'
    const result = await run(input, {}, '/foo.js')

    expect(result.css).toBe(input)
  })

  test('use configured log file', async () => {
    const input = '@layer reset, base, tokens, recipes, utilities;'
    const logFilePath = join(__dirname, 'samples', 'bamboo.log')

    await expect(run(input, { logfile: logFilePath })).rejects.toThrow('@bamboocss/vite')

    logger.info('test', 'foo')

    expect(existsSync(logFilePath)).toBe(true)
    await rm(logFilePath, { force: true })
  })

  test('refuses to emit a stylesheet', async () => {
    const input = '@layer reset, base, tokens, recipes, utilities;'
    await expect(run(input, {})).rejects.toThrow('@bamboocss/vite')
  })

  test('leaves CSS without Bamboo layer order alone', async () => {
    const input = 'body { color: red }'
    const result = await run(input, {})
    expect(result.css).toBe(input)
  })

  test('refuses a recipes-only layer sheet', async () => {
    const input = '@layer recipes { .button { color: red } }'
    await expect(run(input, {})).rejects.toThrow('@bamboocss/vite')
  })
})
