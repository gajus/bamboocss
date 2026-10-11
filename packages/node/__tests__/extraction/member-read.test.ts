import { describe, expect, test } from 'vitest'
import { parseAndExtract } from './fixture'

/**
 * A property read off an object yields that property, and nothing of its siblings.
 *
 * An object's undecided values are recorded per property. A read used to keep all of them, so
 * `theme.w` beside `px: dense ? '2' : '4'` emitted the `px` rules as if the call had asked for
 * them, and the read itself counted as undecided.
 */
describe('a property read', () => {
  test('emits the property, without its siblings’ undecided values', () => {
    const result = parseAndExtract(`
    import { css } from "styled-system/css"
    const dense = Math.random() > 0.5
    const theme = { px: dense ? '2' : '4', w: '10' }
    css({ width: theme.w })
    `)

    expect(result.css).toContain('width: var(--sizes-10)')
    expect(result.css).not.toContain('padding-inline')
  })

  test('of an undecided property still emits every value it may take', () => {
    const result = parseAndExtract(`
    import { css } from "styled-system/css"
    const dense = Math.random() > 0.5
    const theme = { px: dense ? '2' : '4', w: '10' }
    css({ paddingInline: theme.px })
    `)

    expect(result.css).toContain('padding-inline: var(--spacing-2)')
    expect(result.css).toContain('padding-inline: var(--spacing-4)')
    expect(result.css).not.toContain('width:')
  })

  test('of a choice between two objects yields each one’s property', () => {
    const result = parseAndExtract(`
    import { css } from "styled-system/css"
    const dense = Math.random() > 0.5
    css({ width: (dense ? { w: '10' } : { w: '12' }).w })
    `)

    expect(result.css).toContain('width: var(--sizes-10)')
    expect(result.css).toContain('width: var(--sizes-12)')
  })
})
