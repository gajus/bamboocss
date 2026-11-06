import { createContext } from '@bamboocss/fixture'
import type { Config, Dict } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { stringify } from '../src/stringify'
import { createRuleProcessor } from './fixture'

/**
 * A mixin is the base of the style object it is applied in — what composing it with anything else
 * means.
 *
 * The compiler's style-set tests assert the rendering this produces. These pin the expansion
 * itself, the encoder's half — the declarations the compiler asks for once it writes a mixin out
 * have to have rules — and the rules that write a mixin out in place of the compiler: `global.css`,
 * a recipe's own classes and a mixin's own class.
 */
/**
 * Not in the type — a mixin's value is the `css()` property set, which has no `mixin` — but
 * reachable from an untyped config, where expanding still has to terminate.
 */
const untyped: Record<string, any> = {
  stacked: { value: { mixin: 'cardB', padding: '1px' } },
  stackedAfter: { value: { padding: '1px', mixin: 'boxed' } },
  loopA: { value: { mixin: 'loopB', color: 'red' } },
  loopB: { value: { mixin: 'loopA' } },
}

const mixins = {
  cardA: { value: { color: 'red', letterSpacing: '0.1em' } },
  cardB: { value: { color: 'blue' } },
  boxed: { value: { padding: '4px', color: 'blue' } },
  firm: { value: { color: 'gray !important' } },
  hoverable: { value: { color: 'gray', _hover: { color: 'yellow' } } },
  ...untyped,
}

const createMixinContext = () => createContext({ theme: { extend: { mixins } } })

describe('expanding mixins', () => {
  test('a mixin is the base of the object it is applied in, wherever its key is written', () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ color: 'green', mixin: 'cardA' })).toEqual({ color: 'green', letterSpacing: '0.1em' })
    expect(mixins.expand({ mixin: 'cardA', color: 'green' })).toEqual({ color: 'green', letterSpacing: '0.1em' })
  })

  test("a mixin's conditions stay conditions beside a property that overrides its base value", () => {
    const { mixins } = createMixinContext()
    const hovering = { color: 'blue', _hover: { color: 'yellow' } }

    expect(mixins.expand({ mixin: 'hoverable', color: 'blue' })).toEqual(hovering)
    expect(mixins.expand({ color: 'blue', mixin: 'hoverable' })).toEqual(hovering)
    expect(mixins.expand({ _hover: { color: 'green' }, mixin: 'hoverable' })).toEqual({
      color: 'gray',
      _hover: { color: 'green' },
    })
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

  test("mixins listed apply in order, a later one over an earlier one, and the object's own after them", () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ mixin: ['cardA', 'cardB'] })).toEqual({ color: 'blue', letterSpacing: '0.1em' })
    expect(mixins.expand({ mixin: ['cardB', 'cardA'] })).toEqual({ color: 'red', letterSpacing: '0.1em' })
    expect(mixins.expand({ color: 'green', mixin: ['cardA', 'cardB'] })).toEqual({
      color: 'green',
      letterSpacing: '0.1em',
    })
    expect(mixins.expand({ mixin: [], color: 'green' })).toEqual({ color: 'green' })
  })

  test('a list chosen per condition', () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ mixin: { base: 'cardB', md: ['cardA', 'hoverable'] } })).toEqual({
      color: 'blue',
      md: { color: 'gray', letterSpacing: '0.1em', _hover: { color: 'yellow' } },
    })
  })

  test("a mixin's important declaration is kept against the object's own that is not, as in one CSS rule", () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ mixin: 'firm', color: 'red' })).toEqual({ color: 'gray !important' })
    expect(mixins.expand({ mixin: 'firm', color: 'red !important' })).toEqual({ color: 'red !important' })
  })

  test('a mixin a mixin applies is written out too, its own declarations over it, and one applying itself stops', () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ mixin: 'stacked' })).toEqual({ color: 'blue', padding: '1px' })
    expect(mixins.expand({ mixin: 'stackedAfter' })).toEqual({ padding: '1px', color: 'blue' })
    expect(mixins.expand({ mixin: 'loopA' })).toEqual({ mixin: 'loopA', color: 'red' })
  })

  test('an unknown mixin is left as written, for the encoder to report, in a list too', () => {
    const { mixins } = createMixinContext()

    expect(mixins.expand({ mixin: 'nope', color: 'red' })).toEqual({ mixin: 'nope', color: 'red' })
    expect(mixins.expand({ mixin: ['cardB', 'nope'] })).toEqual({ color: 'blue', mixin: 'nope' })
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

describe('a style as written', () => {
  test('leaves out each mixin that lists mixins, which no class stands for', () => {
    const { mixins } = createMixinContext()

    expect(mixins.asWritten({ mixin: ['cardA', 'cardB'], color: 'red', _hover: { mixin: 'cardB' } })).toEqual({
      color: 'red',
      _hover: { mixin: 'cardB' },
    })
    expect(mixins.asWritten({ md: { mixin: { base: 'cardA', lg: ['cardB'] } } })).toEqual({ md: {} })
  })

  test('is the style itself where no mixin lists mixins', () => {
    const { mixins } = createMixinContext()
    const style = { mixin: 'cardA', _hover: { mixin: { base: 'cardB' } } }

    expect(mixins.asWritten(style)).toBe(style)
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

  test('writes a list of mixins out wherever it is applied, having no class to intern', () => {
    const css = cssOf(({ encoder }) => encoder.processAtomic({ mixin: ['cardA', 'cardB'] }))

    expect(css).toContain('.c_blue')
    expect(css).toContain('.ls_0\\.1em')
    expect(css).not.toContain('mixin_')
    expect(css).not.toContain('.c_red')
  })
})

describe('a rule writing a mixin out in place of the compiler', () => {
  const config = {
    theme: {
      extend: {
        mixins,
        recipes: {
          before: { className: 'before', base: { padding: '1px', mixin: 'boxed' } },
          after: { className: 'after', base: { mixin: 'boxed', padding: '1px' } },
          toned: { className: 'toned', variants: { tone: { muted: { color: 'red', mixin: 'cardB' } } } },
        },
      },
    },
  } as Config

  const globalCss = (css: Dict) => stringify(createContext(config).createSheet().serialize(css))

  const recipeCss = (name: string, variants: Dict = {}) => {
    const processor = createRuleProcessor(config)
    processor.recipe(name, variants)
    return processor.toCss()
  }

  test("global.css: the object's own declarations override its mixin wherever the key is written", () => {
    // `padding` is a shorthand, which a rule sorts ahead of other declarations: as one atom, the
    // mixin was placed after it however it was written, and its padding replaced the object's.
    const expected = 'p.x {padding: 1px;\ncolor: blue;\n}\n'
    expect(globalCss({ 'p.x': { padding: '1px', mixin: 'boxed' } })).toBe(expected)
    expect(globalCss({ 'p.x': { mixin: 'boxed', padding: '1px' } })).toBe(expected)
  })

  test('global.css: a list of mixins applies in order', () => {
    // An array used to reach the rule as an object keyed by index: `0: cardA; 1: cardB`.
    expect(globalCss({ 'p.x': { mixin: ['cardA', 'cardB'] } })).toMatchInlineSnapshot(`
      "p.x {color: blue;
      letter-spacing: 0.1em;
      }
      "
    `)
  })

  test("a recipe's base and variants: the object's own declarations override its mixin", () => {
    expect(recipeCss('before')).toContain('.before {\n    padding: 1px;\n    color: blue;')
    expect(recipeCss('after')).toContain('.after {\n    padding: 1px;\n    color: blue;')

    const toned = recipeCss('toned', { tone: 'muted' })
    expect(toned).toContain('.toned--tone_muted {\n    color: red;')
    expect(toned).not.toContain('blue')
  })

  test("a mixin's own class: its declarations override a mixin it applies, wherever the key is written", () => {
    const processor = createRuleProcessor(config)
    processor.css({ mixin: 'stackedAfter' })

    expect(processor.toCss()).toContain('.mixin_stackedAfter {\n      padding: 1px;\n      color: blue;')
  })
})
