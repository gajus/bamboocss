import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { describe, expect, test } from 'vitest'
import { cascadeEntries, compareCascade, type CascadeEntry } from '../../core/__tests__/cascade-oracle'
import { bare } from '../src/class-name'
import { createFoldFixture, selectorsFor } from './fixture'

/**
 * Mixins composed with anything else.
 *
 * Applied alone, a mixin is one class in the `compositions` layer, below every other utility.
 * That is right while nothing else on the element sets what the mixin sets. Composed with
 * something that does — a recipe's variant over its base, a compound over a variant, `cx()`
 * over two calls, another property in the same object — it has to mean what writing its
 * declarations in its place means: what comes after it wins, and its own conditions rank as
 * conditions do.
 *
 * These assert the value an element ends up with, in the state that decides it, against the
 * sheet the build emits, rather than the classes: what is pinned is the rendering.
 */
const config = {
  theme: {
    extend: {
      mixins: {
        cardA: { value: { color: 'red', letterSpacing: '0.1em' } },
        cardB: { value: { color: 'blue' } },
        hoverable: { value: { color: 'gray', _hover: { color: 'yellow' } } },
        layerCard: { value: { borderWidth: '1px', background: '#fafafa' } },
        textBody: { value: { fontSize: '16px' } },
      },
    },
  },
}

interface Compiled {
  classes: string
  css: string
}

/** Fold `body`, and return the classes `export const A` compiled to with the sheet behind them. */
const compile = (body: string): Compiled => {
  const fixture = createFoldFixture(config as never)
  const { code } = fixture.fold(`import { css, cva, cx, sva } from 'styled-system/css'\n${body}\n`)
  const classes = code.match(/export const A = "([^"]*)"/)?.[1]
  if (classes === undefined) throw new Error(`\`A\` did not compile:\n${code}`)

  const css = fixture.getStyleSetCss()
  for (const selector of selectorsFor(classes)) expect(css, `no rule behind ${selector}`).toContain(selector)
  return { classes, css }
}

interface State {
  hover?: boolean
  md?: boolean
}

const classesOf = (selector: string) => {
  const names: string[] = []
  selectorParser((root) => {
    root.walkClasses((node) => {
      names.push(bare(node.toString().trim().slice(1)))
    })
  }).processSync(selector)
  return names
}

/** A rule applies to an element carrying every class its selector names, in a state it requires. */
const applies = (entry: CascadeEntry, own: ReadonlySet<string>, state: State) => {
  const names = classesOf(entry.selector)
  return (
    names.length > 0 &&
    names.every((name) => own.has(name)) &&
    (state.hover || !/:hover|\[data-hover\]/.test(entry.selector)) &&
    (state.md || !entry.atRules.some((rule) => rule.startsWith('@media')))
  )
}

const keyOf = ({ atRules, selector, property }: Pick<CascadeEntry, 'atRules' | 'selector' | 'property'>) =>
  `${atRules.join(' ')}|${selector}|${property}`

/** Every declaration's value, keyed the way the oracle describes where it sits. */
const declarations = (css: string) => {
  const values = new Map<string, string>()
  postcss.parse(css).walkDecls((decl) => {
    const rule = decl.parent
    if (rule?.type !== 'rule') return
    const atRules: string[] = []
    let current = rule.parent
    while (current && current.type !== 'root') {
      if (current.type === 'atrule') {
        const name = (current as postcss.AtRule).name.toLowerCase()
        if (name !== 'layer') atRules.unshift(`@${name} ${(current as postcss.AtRule).params}`.trim())
      }
      current = current.parent
    }
    for (const selector of (rule as postcss.Rule).selectors) {
      values.set(keyOf({ atRules, selector, property: decl.prop }), decl.value)
    }
  })
  return values
}

/** The value of `property` on an element carrying the compiled classes, ranked as a browser ranks it. */
const valueOf = ({ classes, css }: Compiled, property: string, state: State = {}) => {
  const own = new Set(classes.split(' ').filter(Boolean))
  const { entries, layers } = cascadeEntries(css)
  const winner = entries
    .filter((entry) => entry.property === property && applies(entry, own, state))
    .sort((a, b) => compareCascade(a, b, layers))
    .at(-1)
  return winner && declarations(css).get(keyOf(winner))
}

describe('a mixin composed with anything else', () => {
  test("a variant's mixin overrides the base", () => {
    const compiled = compile(
      `const tone = cva({ base: { color: 'green' }, variants: { tone: { loud: { mixin: 'cardA' } } } })\n` +
        `export const A = tone({ tone: 'loud' })`,
    )

    expect(valueOf(compiled, 'color')).toBe('red')
    expect(valueOf(compiled, 'letter-spacing')).toBe('0.1em')
  })

  test('a mixin written after a property overrides it', () => {
    const compiled = compile(`const box = cva({ base: { color: 'green', mixin: 'cardA' } })\nexport const A = box()`)

    expect(valueOf(compiled, 'color')).toBe('red')
  })

  test('a property written after a mixin overrides it', () => {
    const compiled = compile(`const box = cva({ base: { mixin: 'cardA', color: 'blue' } })\nexport const A = box()`)

    expect(valueOf(compiled, 'color')).toBe('blue')
    expect(valueOf(compiled, 'letter-spacing')).toBe('0.1em')
  })

  test("a mixin's condition still applies over a property written after it", () => {
    const compiled = compile(`const box = cva({ base: { mixin: 'hoverable', color: 'blue' } })\nexport const A = box()`)

    expect(valueOf(compiled, 'color')).toBe('blue')
    expect(valueOf(compiled, 'color', { hover: true })).toBe('yellow')
  })

  test("a variant's mixin condition overrides the base's", () => {
    const compiled = compile(
      `const box = cva({ base: { _hover: { color: 'blue' } }, variants: { tone: { loud: { mixin: 'hoverable' } } } })\n` +
        `export const A = box({ tone: 'loud' })`,
    )

    expect(valueOf(compiled, 'color')).toBe('gray')
    expect(valueOf(compiled, 'color', { hover: true })).toBe('yellow')
  })

  test("a compound variant's mixin overrides a variant", () => {
    const compiled = compile(
      `const box = cva({\n` +
        `  variants: { tone: { loud: { color: 'green' } }, size: { lg: { fontSize: '20px' } } },\n` +
        `  compoundVariants: [{ tone: 'loud', size: 'lg', css: { mixin: 'cardA' } }],\n` +
        `})\n` +
        `export const A = box({ tone: 'loud', size: 'lg' })`,
    )

    expect(valueOf(compiled, 'color')).toBe('red')
    expect(valueOf(compiled, 'letter-spacing')).toBe('0.1em')
    expect(valueOf(compiled, 'font-size')).toBe('20px')
  })

  test('cx() keeps what an earlier mixin sets and a later one does not', () => {
    const compiled = compile(`export const A = cx(css({ mixin: 'cardA' }), css({ mixin: 'cardB' }))`)

    expect(valueOf(compiled, 'color')).toBe('blue')
    expect(valueOf(compiled, 'letter-spacing')).toBe('0.1em')
  })

  test("cx() keeps a recipe's mixin beside a css() mixin", () => {
    const compiled = compile(
      `const card = cva({ base: { mixin: 'layerCard', padding: '4' } })\n` +
        `export const A = cx(card(), css({ mixin: 'textBody' }))`,
    )

    expect(valueOf(compiled, 'border-width')).toBe('1px')
    expect(valueOf(compiled, 'background')).toBe('#fafafa')
    expect(valueOf(compiled, 'font-size')).toBe('16px')
  })

  test('in css(), a mixin written after a property overrides it', () => {
    const compiled = compile(`export const A = css({ color: 'green', mixin: 'cardA' })`)

    expect(valueOf(compiled, 'color')).toBe('red')
  })

  test('in css(), a property written after a mixin overrides it', () => {
    const compiled = compile(`export const A = css({ mixin: 'cardA', color: 'blue' })`)

    expect(valueOf(compiled, 'color')).toBe('blue')
    expect(valueOf(compiled, 'letter-spacing')).toBe('0.1em')
  })

  test('in css(a, b), a mixin in the later argument overrides the earlier one', () => {
    const compiled = compile(`export const A = css({ color: 'green' }, { mixin: 'cardA' })`)

    expect(valueOf(compiled, 'color')).toBe('red')
  })

  test("a slot recipe variant's mixin overrides the base", () => {
    const compiled = compile(
      `const card = sva({ slots: ['root'], base: { root: { color: 'green' } }, variants: { tone: { loud: { root: { mixin: 'cardA' } } } } })\n` +
        `export const A = card({ tone: 'loud' }).root`,
    )

    expect(valueOf(compiled, 'color')).toBe('red')
  })

  test('a mixin chosen per breakpoint applies each at its own', () => {
    const compiled = compile(`export const A = css({ mixin: { base: 'cardA', md: 'cardB' } })`)

    expect(valueOf(compiled, 'color')).toBe('red')
    expect(valueOf(compiled, 'color', { md: true })).toBe('blue')
    expect(valueOf(compiled, 'letter-spacing', { md: true })).toBe('0.1em')
  })
})

/** Nothing competes with a mixin that is the whole style set, so it keeps its one class. */
describe('a mixin that is the whole style set', () => {
  test('keeps its class', () => {
    const compiled = compile(`export const A = css({ mixin: 'cardA' })`)

    expect(compiled.classes).toBe('mixin_cardA')
    expect(valueOf(compiled, 'color')).toBe('red')
  })

  test('keeps its class under a condition', () => {
    const compiled = compile(`export const A = css({ _hover: { mixin: 'cardA' } })`)

    expect(compiled.classes).toBe('hover:mixin_cardA')
    expect(valueOf(compiled, 'color', { hover: true })).toBe('red')
    expect(valueOf(compiled, 'color')).toBeUndefined()
  })

  test('keeps its class as the only thing a recipe selection holds', () => {
    const compiled = compile(`const box = cva({ base: { mixin: 'cardA' } })\nexport const A = box()`)

    expect(compiled.classes).toBe('mixin_cardA')
  })
})
