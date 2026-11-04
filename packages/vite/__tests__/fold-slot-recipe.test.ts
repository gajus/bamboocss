import { describe, expect, test } from 'vitest'
import { createFoldFixture, selectorsFor } from './fixture'

describe('config slot recipes', () => {
  test('compiles a statically selected slot to declaration atoms', () => {
    const fixture = createFoldFixture()
    const result = fixture.fold(
      `import { checkbox } from '../styled-system/recipes'\nexport const root = checkbox({ size: 'sm' }).root`,
    )

    const call = result.folded.find((entry) => entry.kind === 'class')
    expect(call?.className).toBe(fixture.runtimeCss({ display: 'flex', alignItems: 'center', gap: '2' }))
    expect(call?.className).not.toContain('checkbox')

    const css = fixture.getStyleSetCss()
    for (const selector of selectorsFor(call!.className)) expect(css).toContain(selector)
  })

  test('compiles a runtime selection without retaining a slot runtime', () => {
    const code = `import { checkbox } from '../styled-system/recipes'\ndeclare const size: 'sm' | 'md'\nexport const root = checkbox({ size }).root`
    const result = createFoldFixture().fold(code)
    expect(result.code).not.toContain('checkbox({ size })')
    expect(result.code).not.toContain('checkbox__root')
    expect(result.folded).toContainEqual(expect.objectContaining({ kind: 'class' }))
    expect(result.skipped).toHaveLength(0)
  })

  test('compiles the whole slot object with one atom string per slot', () => {
    const result = createFoldFixture().fold(
      `import { checkbox } from '../styled-system/recipes'\nexport const slots = checkbox({ size: 'sm' })`,
    )
    expect(result.folded).toContainEqual(expect.objectContaining({ kind: 'slots' }))
    expect(result.code).toContain('"root"')
    expect(result.code).toContain('"control"')
    expect(result.code).toContain('"label"')
    expect(result.skipped).toHaveLength(0)
  })

  test('does not widen arbitrary member access ranges', () => {
    const css = createFoldFixture().fold(
      `import { css } from '../styled-system/css'\nexport const value = css({ color: 'red' }).trim()`,
    )
    expect(css.code).toContain('"c_red".trim()')

    const recipe = createFoldFixture().fold(
      `import { buttonStyle } from '../styled-system/recipes'\nexport const value = buttonStyle({ size: 'sm' }).length`,
    )
    expect(recipe.code).toContain('.length')
    expect(recipe.code).not.toContain('buttonStyle--')
  })

  test('leaves recipe object members such as raw untouched', () => {
    const result = createFoldFixture().fold(
      `import { checkbox } from '../styled-system/recipes'\nexport const raw = checkbox({ size: 'sm' }).raw`,
    )
    expect(result.code).toContain('.raw')
  })
})

/**
 * An `sva()` written without `slots` has the slots its styles name: the stylesheet works them out
 * from `base`, `variants` and `compoundVariants`. The compiler took it for a `cva`, so neither the
 * call nor a slot of it was compiled, and the call left in the bundle throws.
 */
describe('an inline sva() without slots', () => {
  const source = `import { sva } from 'styled-system/css'
const card = sva({
  base: { root: { color: 'red' }, label: { fontSize: 'sm' } },
  variants: { size: { lg: { label: { fontSize: 'lg' } } } },
  compoundVariants: [{ size: 'lg', css: { icon: { width: '4' } } }],
})
export const whole = card({ size: 'lg' })
export const root = card().root
`

  test('compiles with the slots its styles name, as one that names them does', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(source)
    const named = createFoldFixture().foldStyleSets(
      source.replace('sva({\n', "sva({\n  slots: ['root', 'label', 'icon'],\n"),
    )

    expect(result.skipped).toHaveLength(0)
    expect(result.code).not.toContain('card(')
    expect(result.code.split('\n').filter((line) => line.startsWith('export const'))).toEqual(
      named.code.split('\n').filter((line) => line.startsWith('export const')),
    )
    expect(result.code).toContain('export const whole = {"root":"c_red","label":"fs_lg","icon":"w_4"}')

    const css = fixture.getStyleSetCss()
    for (const className of ['c_red', 'fs_lg', 'w_4']) {
      for (const selector of selectorsFor(className)) expect(css).toContain(selector)
    }
  })
})
