import { createContext } from '@bamboocss/fixture'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'
import { findInvalidDeclarations } from '../src/validate-declarations'

/**
 * The walk over the finished sheet, asked with the same verdict the unresolved-token check
 * uses, so the two cannot disagree about one value.
 */
const { utility } = createContext()
const find = (css: string) => findInvalidDeclarations(postcss.parse(css), utility.matchesCssGrammar)

describe('findInvalidDeclarations', () => {
  test('reports a value the property grammar rejects, naming the rule and the layer', () => {
    expect(find(`@layer utilities { .bg-linear_65deg { background-image: 65deg } }`)).toEqual([
      { prop: 'background-image', value: '65deg', selector: '.bg-linear_65deg', layer: 'utilities', count: 1 },
    ])
  })

  test('accepts valid CSS, modern functions and units included', () => {
    expect(
      find(
        `.a { color: light-dark(#fff, #000); background: color-mix(in oklch, red, blue); height: 100dvh; ` +
          `line-height: 1lh; text-wrap: pretty; inset: 0; translate: 10px 20px; anchor-name: --x; position-area: top }`,
      ),
    ).toEqual([])
  })

  test('leaves a custom property alone', () => {
    expect(find(`.a { --x: 65deg }`)).toEqual([])
  })

  test('leaves a value that reads a variable alone, since the grammar cannot see what it holds', () => {
    expect(
      find(
        `.a { width: var(--w); padding-bottom: env(safe-area-inset-bottom); content: attr(title); color: VAR(--c) }`,
      ),
    ).toEqual([])
  })

  test('does not mistake a function ending in one of those names for a substitution', () => {
    // `serif` is not `if(`; a match on the bare suffix would skip a value it should judge.
    expect(find(`.a { font-family: serif(x) }`)).toHaveLength(1)
  })

  test('leaves descriptors alone', () => {
    expect(
      find(
        `@font-face { font-family: X; src: url(x.woff2); font-display: swap }` +
          `@property --p { syntax: '<length>'; inherits: false; initial-value: 0px }` +
          `@counter-style thumbs { system: cyclic; symbols: "👍"; suffix: " " }`,
      ),
    ).toEqual([])
  })

  test('asks keyframe steps', () => {
    expect(find(`@keyframes spin { to { rotate: 360deg; opacity: solid } }`)).toEqual([
      { prop: 'opacity', value: 'solid', selector: 'to', layer: undefined, count: 1 },
    ])
  })

  test('names the outermost rule for a nested one, which is the class the author wrote', () => {
    const found = find(`@layer utilities { .hover\\:d_flexx { &:hover { display: flexx } } }`)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ selector: '.hover\\:d_flexx', layer: 'utilities' })
  })

  test('reports the top-level layer for a declaration in a nested layer', () => {
    const found = find(`@layer utilities { @layer compositions { .t_x { font-size: solid } } }`)
    expect(found[0]?.layer).toBe('utilities')
  })

  test('reports one distinct declaration once, counting the rules that carry it', () => {
    expect(find(`.a { width: 10px 20px } .b { width: 10px 20px } .c { width: 10px 20px; height: 1px 2px }`)).toEqual([
      { prop: 'width', value: '10px 20px', selector: '.a', layer: undefined, count: 3 },
      { prop: 'height', value: '1px 2px', selector: '.c', layer: undefined, count: 1 },
    ])
  })

  test('a property the grammar has never heard of is not reported', () => {
    // A custom utility that emits its own name, and a vendor hack — neither is a verdict.
    expect(find(`.a { text-style: bogus; mixin: whatever; -webkit-nonsense: 1 }`)).toEqual([])
  })

  test('a deprecated system colour is allowed, as the token check allows it', () => {
    expect(find(`.a { color: ButtonHighlight; background: WindowText }`)).toEqual([])
  })

  test('the value is judged without its !important', () => {
    expect(find(`.a { color: red !important; width: 10px 20px !important }`)).toEqual([
      { prop: 'width', value: '10px 20px', selector: '.a', layer: undefined, count: 1 },
    ])
  })
})
