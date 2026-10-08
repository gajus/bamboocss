import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/**
 * A mixin written out where it is applied — what composing it with anything else means.
 *
 * The compiler's style-set tests assert the rendering this produces. These pin the expansion
 * itself, and the encoder's half: the declarations the compiler asks for once it writes a
 * mixin out have to have rules.
 */
/**
 * Not in the type — a mixin's value is the `css()` property set, which has no `mixin` — but
 * reachable from an untyped config, where expanding still has to terminate.
 */
const untyped: Record<string, any> = {
  stacked: { value: { mixin: 'cardB', padding: '1px' } },
  loopA: { value: { mixin: 'loopB', color: 'red' } },
  loopB: { value: { mixin: 'loopA' } },
}

const createMixinContext = () =>
  createContext({
    theme: {
      extend: {
        mixins: {
          cardA: { value: { color: 'red', letterSpacing: '0.1em' } },
          cardB: { value: { color: 'blue' } },
          hoverable: { value: { color: 'gray', _hover: { color: 'yellow' } } },
          ...untyped,
        },
      },
    },
  })

describe('expanding mixins', () => {
  test('a key written after a mixin wins over it, and the mixin over one written before', () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ color: 'green', mixin: 'cardA' })).toEqual({ color: 'red', letterSpacing: '0.1em' })
    expect(mixins.expand({ mixin: 'cardA', color: 'green' })).toEqual({ color: 'green', letterSpacing: '0.1em' })
  })

  test("a mixin's conditions stay conditions beside a property that overrides its base value", () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ mixin: 'hoverable', color: 'blue' })).toEqual({ color: 'blue', _hover: { color: 'yellow' } })
  })

  test('a mixin under a condition, and one chosen per condition', () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ _hover: { mixin: 'cardB' } })).toEqual({ _hover: { color: 'blue' } })
    expect(mixins.expand({ mixin: { base: 'cardA', md: 'cardB' } })).toEqual({
      color: 'red',
      letterSpacing: '0.1em',
      md: { color: 'blue' },
    })
  })

  test('a mixin a mixin applies is written out too, and one applying itself stops', () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ mixin: 'stacked' })).toEqual({ color: 'blue', padding: '1px' })
    expect(mixins.expand({ mixin: 'loopA' })).toEqual({ mixin: 'loopA', color: 'red' })
  })

  test('an unknown mixin is left as written, for the encoder to report', () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ mixin: 'nope', color: 'red' })).toEqual({ mixin: 'nope', color: 'red' })
  })

  test('a style that applies no mixin comes back as it is', () => {
    const { mixins } = createMixinContext()
    const style = { color: 'red', _hover: { color: 'blue' } }

    expect(mixins.expand(style)).toBe(style)
    expect(mixins.has(style)).toBe(false)
    expect(mixins.has({ _hover: { mixin: 'cardB' } })).toBe(true)
    expect(mixins.has({ mixin: undefined })).toBe(false)
  })
})

describe('the encoder and mixin atoms', () => {
  const cssOf = (encode: (ctx: ReturnType<typeof createMixinContext>) => void) => {
    const ctx = createMixinContext()
    encode(ctx)
    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    return ctx.getCss(sheet)
  }

  test("interns a mixin's declarations beside its class, for a sheet the compiler is checked against", () => {
    const css = cssOf(({ encoder }) => encoder.withMixinAtoms(() => encoder.processAtomic({ mixin: 'cardA' })))

    expect(css).toContain('.mixin_cardA')
    expect(css).toContain('.c_red')
    expect(css).toContain('.ls_0\\.1em')
  })

  test('interns the class alone otherwise, as the rule processor and staticCss always have', () => {
    const css = cssOf(({ encoder }) => encoder.processAtomic({ mixin: 'cardA' }))

    expect(css).toContain('.mixin_cardA')
    expect(css).not.toContain('.c_red')
  })
})
