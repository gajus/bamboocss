import { createGeneratorContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/** The baseline sheet, which is where the global layer and its `:root` declaration are written. */
const baselineCss = (config?: Parameters<typeof createGeneratorContext>[0]) => {
  const ctx = createGeneratorContext(config)
  const sheet = ctx.createSheet()
  ctx.appendBaselineCss(sheet)
  return ctx.getCss(sheet)
}

describe('the made-with-bamboo declaration', () => {
  test('carries the emoji by default', () => {
    const css = baselineCss()
    expect(css).toContain('--made-with-bamboo')
    expect(css).toContain('🎋')
  })

  test('keeps the declaration and drops the emoji under `watermark: false`', () => {
    const css = baselineCss({ watermark: false })
    expect(css).toContain('--made-with-bamboo')
    expect(css).not.toContain('🎋')
  })
})
