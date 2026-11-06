import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { describe, expect, test } from 'vitest'
import { cascadeEntries, compareCascade, type CascadeEntry } from '../../core/__tests__/cascade-oracle'
import { bare } from '../src/class-name'
import { createFoldFixture, selectorsFor } from './fixture'

/**
 * Mixins wherever they are applied: composed with anything else, alone, and with a selector or
 * condition under them or in them.
 *
 * A mixin is the base of the style object it is applied in: the object's own declarations override
 * it wherever its key is written, mixins listed apply in order, and whatever comes after the object
 * wins over it — a recipe's variant over its base, a compound over a variant, `cx()` over two calls.
 * Its conditions rank as conditions do, a selector's specificity ranks it over the selected
 * element's own utilities, and a longhand it sets outranks a shorthand. The compiler writes every
 * mixin out to mean that. Its own class sat in the `compositions` layer, below every other utility,
 * and meant none of it.
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
        textSmall: { value: { fontSize: '14px' } },
        field: { value: { '& input': { fontSize: '14px' } } },
        responsive: { value: { fontSize: { base: '14px', md: '18px' } } },
        pad: { value: { paddingTop: '16px' } },
        loudBlue: { value: { color: 'blue !important' } },
      },
    },
  },
}

interface Compiled {
  /** What `export const A` compiled to. */
  classes: string
  /** What each `export const` compiled to, by name. */
  exports: Record<string, string>
  css: string
}

/** Fold `body`, and return the classes each `export const` compiled to with the sheet behind them. */
const compile = (body: string): Compiled => {
  const fixture = createFoldFixture(config as never)
  const { code } = fixture.fold(`import { css, cva, cx, sva } from 'styled-system/css'\n${body}\n`)
  const exports = Object.fromEntries(
    [...code.matchAll(/export const (\w+) = "([^"]*)"/g)].map(([, name, classes]) => [name!, classes!]),
  )
  const classes = exports.A
  if (classes === undefined) throw new Error(`\`A\` did not compile:\n${code}`)

  const css = fixture.getStyleSetCss()
  for (const compiled of Object.values(exports)) {
    for (const selector of selectorsFor(compiled)) expect(css, `no rule behind ${selector}`).toContain(selector)
  }
  return { classes, exports, css }
}

interface State {
  hover?: boolean
  md?: boolean
}

/** An element in the document: its tag, the classes it carries, and the element it sits in. */
interface Element {
  tag?: string
  classes: string
  parent?: Element
}

interface Compound {
  /** The combinator between this compound and the one before it. */
  combinator?: string
  classes: string[]
  tags: string[]
}

/** The compounds of one selector, subject last. A pseudo-class's arguments are not visited. */
const compoundsOf = (selector: string) => {
  const compounds: Compound[] = [{ classes: [], tags: [] }]
  selectorParser((root) => {
    root.first.each((node) => {
      if (node.type === 'combinator') compounds.push({ combinator: node.value.trim() || ' ', classes: [], tags: [] })
      else if (node.type === 'class') compounds.at(-1)!.classes.push(bare(node.toString().trim().slice(1)))
      else if (node.type === 'tag') compounds.at(-1)!.tags.push(node.value)
    })
  }).processSync(selector)
  return compounds
}

const satisfies = ({ classes, tags }: Compound, element: Element) => {
  const own = element.classes.split(' ')
  return (
    classes.length + tags.length > 0 &&
    classes.every((name) => own.includes(name)) &&
    tags.every((tag) => tag === (element.tag ?? 'div'))
  )
}

/** Whether `compounds[0..=index]` select `element`, read right to left as a browser reads them. */
const selects = (compounds: Compound[], index: number, element: Element | undefined): boolean => {
  if (!element || !satisfies(compounds[index]!, element)) return false
  if (index === 0) return true
  const { combinator } = compounds[index]!
  if (combinator === '>') return selects(compounds, index - 1, element.parent)
  if (combinator !== ' ') throw new Error(`unmodelled combinator ${combinator}`)
  for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) {
    if (selects(compounds, index - 1, ancestor)) return true
  }
  return false
}

/** A rule applies to an element its selector selects, in a state it requires. */
const applies = (entry: CascadeEntry, element: Element, state: State) => {
  const compounds = compoundsOf(entry.selector)
  return (
    selects(compounds, compounds.length - 1, element) &&
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

/** The declaration of one of `properties` that wins on `element`, ranked as a browser ranks it. */
const winnerAt = (css: string, element: Element, properties: readonly string[], state: State) => {
  const { entries, layers } = cascadeEntries(css)
  return entries
    .filter((entry) => properties.includes(entry.property) && applies(entry, element, state))
    .sort((a, b) => compareCascade(a, b, layers))
    .at(-1)
}

/** The value of `property` on `element`, ranked as a browser ranks it. */
const valueAt = (css: string, element: Element, property: string, state: State = {}) => {
  const winner = winnerAt(css, element, [property], state)
  return winner && declarations(css).get(keyOf(winner))
}

/**
 * Which of a longhand and the shorthands setting it decides the longhand on `element`, with its
 * value. The oracle ranks one property at a time, and a shorthand sets the longhand all the same.
 */
const decidedAt = (css: string, element: Element, properties: readonly string[], state: State = {}) => {
  const winner = winnerAt(css, element, properties, state)
  return winner && `${winner.property}: ${declarations(css).get(keyOf(winner))}`
}

/** The value of `property` on an element carrying the compiled classes, ranked as a browser ranks it. */
const valueOf = ({ classes, css }: Compiled, property: string, state: State = {}) =>
  valueAt(css, { classes }, property, state)

describe('a mixin composed with anything else', () => {
  test("a variant's mixin overrides the base", () => {
    const compiled = compile(
      `const tone = cva({ base: { color: 'green' }, variants: { tone: { loud: { mixin: 'cardA' } } } })\n` +
        `export const A = tone({ tone: 'loud' })`,
    )

    expect(valueOf(compiled, 'color')).toBe('red')
    expect(valueOf(compiled, 'letter-spacing')).toBe('0.1em')
  })

  test('a property written before a mixin overrides it all the same', () => {
    const compiled = compile(`const box = cva({ base: { color: 'green', mixin: 'cardA' } })\nexport const A = box()`)

    expect(valueOf(compiled, 'color')).toBe('green')
    expect(valueOf(compiled, 'letter-spacing')).toBe('0.1em')
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

  test('in css(), a property written before a mixin overrides it all the same', () => {
    // Keys sorted by name, as a linter sorts them, which puts `mixin` among the properties
    // adjusting it.
    const compiled = compile(
      `export const A = css({ color: 'green', fontSize: '12px', mixin: 'hoverable', padding: '4px' })`,
    )

    expect(valueOf(compiled, 'color')).toBe('green')
    expect(valueOf(compiled, 'color', { hover: true })).toBe('yellow')
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

  test('mixins listed apply in order, and a property beside them overrides both', () => {
    const compiled = compile(
      `export const A = css({ mixin: ['cardA', 'cardB'] })\n` +
        `export const B = css({ color: 'green', mixin: ['cardA', 'cardB'] })\n` +
        `export const C = css({ mixin: ['cardB', 'cardA'] })`,
    )
    const { A, B, C } = compiled.exports

    expect(valueAt(compiled.css, { classes: A! }, 'color')).toBe('blue')
    expect(valueAt(compiled.css, { classes: A! }, 'letter-spacing')).toBe('0.1em')
    expect(valueAt(compiled.css, { classes: B! }, 'color')).toBe('green')
    expect(valueAt(compiled.css, { classes: C! }, 'color')).toBe('red')
  })

  test('a list chosen per breakpoint, and one in a recipe variant', () => {
    const compiled = compile(
      `const box = cva({ base: { color: 'green' }, variants: { tone: { loud: { mixin: ['cardB', 'hoverable'] } } } })\n` +
        `export const A = css({ mixin: { base: 'cardB', md: ['cardA', 'hoverable'] } })\n` +
        `export const B = box({ tone: 'loud' })`,
    )
    const { A, B } = compiled.exports

    expect(valueAt(compiled.css, { classes: A! }, 'color')).toBe('blue')
    expect(valueAt(compiled.css, { classes: A! }, 'color', { md: true })).toBe('gray')
    expect(valueAt(compiled.css, { classes: A! }, 'letter-spacing', { md: true })).toBe('0.1em')
    expect(valueAt(compiled.css, { classes: A! }, 'color', { md: true, hover: true })).toBe('yellow')
    expect(valueAt(compiled.css, { classes: B! }, 'color')).toBe('gray')
    expect(valueAt(compiled.css, { classes: B! }, 'color', { hover: true })).toBe('yellow')
  })
})

describe('a mixin beside an important declaration', () => {
  // A mixin's declarations come first in the object it is applied in, the object's own after
  // them, and CSS does not let a declaration written later replace an important one in the same
  // rule.
  test('does not replace an important value written before it', () => {
    expect(valueOf(compile(`export const A = css({ color: 'red !important', mixin: 'cardB' })`), 'color')).toBe('red')
  })

  test('nor with a condition of its own', () => {
    const compiled = compile(`export const A = css({ color: 'red!', mixin: 'hoverable' })`)

    expect(valueOf(compiled, 'color')).toBe('red')
    expect(valueOf(compiled, 'color', { hover: true })).toBe('red')
  })

  test('nor in a recipe', () => {
    const compiled = compile(
      `const box = cva({ base: { color: 'blue !important', mixin: 'cardA' } })\nexport const A = box()`,
    )

    expect(valueOf(compiled, 'color')).toBe('blue')
    expect(valueOf(compiled, 'letter-spacing')).toBe('0.1em')
  })

  test('keeps its own important value against a property beside it, wherever its key is written', () => {
    expect(valueOf(compile(`export const A = css({ mixin: 'loudBlue', color: 'red' })`), 'color')).toBe('blue')
    expect(valueOf(compile(`export const A = css({ color: 'red', mixin: 'loudBlue' })`), 'color')).toBe('blue')
  })

  test("gives its important value way to the object's own, wherever its key is written", () => {
    expect(valueOf(compile(`export const A = css({ color: 'red!', mixin: 'loudBlue' })`), 'color')).toBe('red')
    expect(valueOf(compile(`export const A = css({ mixin: 'loudBlue', color: 'red!' })`), 'color')).toBe('red')
  })

  test('composing two style objects, the later one still wins', () => {
    expect(valueOf(compile(`export const A = css({ color: 'red!' }, { mixin: 'cardB' })`), 'color')).toBe('blue')
  })
})

/**
 * A mixin that is the whole style set. Nothing in the style set competes with it, but the other
 * classes on the element can, and its class ranked below each of them wherever its declarations,
 * written out, rank above.
 */
describe('a mixin that is the whole style set', () => {
  test('compiles to the atoms of its declarations, as writing them out does', () => {
    const compiled = compile(
      `export const A = css({ mixin: 'cardA' })\n` +
        `export const B = css({ mixin: { base: 'cardA' } })\n` +
        `const box = cva({ base: { mixin: 'cardA' } })\n` +
        `export const C = box()\n` +
        `export const D = css({ color: 'red', letterSpacing: '0.1em' })`,
    )
    const { A, B, C, D } = compiled.exports

    expect(A).toBe(D)
    expect(B).toBe(D)
    expect(C).toBe(D)
    expect(valueOf(compiled, 'color')).toBe('red')
  })

  test('a longhand in it wins over a shorthand another class sets, as any longhand does', () => {
    const compiled = compile(`export const A = css({ mixin: 'pad' })\nexport const B = css({ padding: '8px' })`)
    const element = { classes: `${compiled.exports.A} ${compiled.exports.B}` }

    expect(decidedAt(compiled.css, element, ['padding-top', 'padding'])).toBe('padding-top: 16px')
  })

  test('an important value in it ranks as one written out does', () => {
    const compiled = compile(
      `export const A = css({ mixin: 'loudBlue' })\nexport const B = css({ color: 'blue !important' })`,
    )

    expect(compiled.exports.A).toBe(compiled.exports.B)
  })
})

/**
 * A mixin that is the whole style set, applied under a selector or a condition.
 *
 * Nothing in the style set competes with it, but what it is written to override is not in the
 * style set: the selected element's own utilities, or the element's base state, set by whatever
 * other class it carries. Written out, its declarations rank by the selector's specificity and as
 * the condition ranks, above those; a class in `compositions` ranked below every one of them.
 */
describe('a mixin under a selector or condition', () => {
  test('overrides the utilities of the element the selector selects, a mixin among them, as writing it out does', () => {
    const compiled = compile(
      `export const A = css({ '& input': { mixin: 'textSmall' } })\n` +
        `export const B = css({ flex: '1', mixin: 'textBody' })\n` +
        `export const C = css({ fontSize: '16px' })\n` +
        `export const D = css({ mixin: 'textBody' })\n` +
        `export const E = css({ '& input': { fontSize: '14px' } })`,
    )
    const { A, B, C, D, E } = compiled.exports

    for (const own of [B!, C!, D!]) {
      expect(valueAt(compiled.css, { tag: 'input', classes: own, parent: { classes: A! } }, 'font-size')).toBe('14px')
    }
    expect(valueAt(compiled.css, { tag: 'input', classes: B! }, 'font-size')).toBe('16px')
    expect(A).toBe(E)
  })

  test("applies over the element's own utilities while the condition holds", () => {
    const compiled = compile(
      `export const A = css({ _hover: { mixin: 'cardA' } })\n` +
        `export const B = css({ color: 'green' })\n` +
        `export const C = css({ _hover: { color: 'red', letterSpacing: '0.1em' } })`,
    )
    const { A, B, C } = compiled.exports
    const element = { classes: `${A} ${B}` }

    expect(valueAt(compiled.css, element, 'color')).toBe('green')
    expect(valueAt(compiled.css, element, 'color', { hover: true })).toBe('red')
    expect(A).toBe(C)
  })

  test('applies over them at its breakpoint, whether the mixin is under it or chosen for it', () => {
    for (const style of [`{ md: { mixin: 'cardB' } }`, `{ mixin: { md: 'cardB' } }`]) {
      const compiled = compile(`export const A = css(${style})\nexport const B = css({ color: 'green' })`)
      const element = { classes: `${compiled.exports.A} ${compiled.exports.B}` }

      expect(valueAt(compiled.css, element, 'color')).toBe('green')
      expect(valueAt(compiled.css, element, 'color', { md: true })).toBe('blue')
    }
  })

  test('keeps its own conditions within the one it is applied under', () => {
    const compiled = compile(
      `export const A = css({ md: { mixin: 'hoverable' } })\nexport const B = css({ color: 'green' })`,
    )
    const element = { classes: `${compiled.exports.A} ${compiled.exports.B}` }

    expect(valueAt(compiled.css, element, 'color', { hover: true })).toBe('green')
    expect(valueAt(compiled.css, element, 'color', { md: true })).toBe('gray')
    expect(valueAt(compiled.css, element, 'color', { md: true, hover: true })).toBe('yellow')
  })

  test('gives way to a property beside it under the same selector, wherever its key is written', () => {
    const compiled = compile(
      `export const A = css({ '& input': { fontSize: '16px', mixin: 'textSmall' } })\n` +
        `export const B = css({ '& input': { mixin: 'textSmall', fontSize: '16px' } })`,
    )

    for (const parent of [compiled.exports.A!, compiled.exports.B!]) {
      expect(valueAt(compiled.css, { tag: 'input', classes: '', parent: { classes: parent } }, 'font-size')).toBe(
        '16px',
      )
    }
  })

  test('as the only thing a recipe selection holds', () => {
    const compiled = compile(
      `const field = cva({ base: { '& input': { mixin: 'textSmall' } } })\n` +
        `export const A = field()\n` +
        `export const B = css({ fontSize: '16px' })`,
    )
    const { A, B } = compiled.exports

    expect(valueAt(compiled.css, { tag: 'input', classes: B!, parent: { classes: A! } }, 'font-size')).toBe('14px')
  })
})

/**
 * A mixin that is the whole style set, setting something under a selector or condition itself.
 *
 * The same as one applied under them: the element the mixin's selector selects, and the base state
 * its condition overrides, are set by classes outside the style set. Written out, its declarations
 * rank above those; its class in `compositions` ranked below them.
 */
describe('a mixin setting anything under a selector or condition', () => {
  test('overrides the utilities of the element its selector selects, as writing it out does', () => {
    const compiled = compile(
      `export const A = css({ mixin: 'field' })\n` +
        `export const B = css({ fontSize: '16px' })\n` +
        `export const C = css({ '& input': { fontSize: '14px' } })`,
    )
    const { A, B, C } = compiled.exports

    expect(valueAt(compiled.css, { tag: 'input', classes: B!, parent: { classes: A! } }, 'font-size')).toBe('14px')
    expect(A).toBe(C)
  })

  test("applies its condition over the element's own utilities, as writing it out does", () => {
    const compiled = compile(
      `export const A = css({ mixin: 'hoverable' })\n` +
        `export const B = css({ color: 'green' })\n` +
        `export const C = css({ color: 'gray', _hover: { color: 'yellow' } })`,
    )
    const { A, B, C } = compiled.exports

    expect(valueAt(compiled.css, { classes: `${A} ${B}` }, 'color', { hover: true })).toBe('yellow')
    expect(A).toBe(C)
  })

  test('applies a value it chooses per breakpoint at that breakpoint', () => {
    const compiled = compile(
      `export const A = css({ mixin: 'responsive' })\nexport const B = css({ fontSize: '12px' })`,
    )
    const element = { classes: `${compiled.exports.A} ${compiled.exports.B}` }

    expect(valueAt(compiled.css, element, 'font-size', { md: true })).toBe('18px')
  })

  test('as the only thing a recipe selection holds', () => {
    const compiled = compile(
      `const box = cva({ base: { mixin: 'hoverable' } })\n` +
        `export const A = box()\n` +
        `export const B = css({ color: 'green' })`,
    )
    const { A, B } = compiled.exports

    expect(valueAt(compiled.css, { classes: `${A} ${B}` }, 'color', { hover: true })).toBe('yellow')
  })
})
