import { createRuleProcessor } from '@bamboocss/fixture'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

/**
 * Utilities are written into cascade sublayers keyed by specificity, condition and property
 * priority, so that their precedence no longer depends on the order rules appear in — the
 * property a sheet split per chunk cannot promise. The oracle in `cascade-oracle.test.ts` is
 * the proof that the winners are unchanged; these pin the shape that proof relies on.
 */
const sheetFor = (...styles: Parameters<ReturnType<typeof createRuleProcessor>['css']>[0][]) => {
  const processor = createRuleProcessor()
  for (const style of styles) processor.css(style)
  return processor.toCss()
}

/** The sublayer statement inside `utilities`, and which sublayer each selector was written into. */
const inspect = (css: string) => {
  const root = postcss.parse(css)
  let declared: string[] = []
  const sublayerOf = new Map<string, string>()
  root.walkAtRules('layer', (layer) => {
    const parent = layer.parent
    if (!parent || parent.type !== 'atrule' || (parent as postcss.AtRule).params !== 'utilities') return
    if (!layer.nodes) {
      declared = layer.params.split(',').map((name) => name.trim())
      return
    }
    layer.walkRules((rule) => {
      for (const selector of rule.selectors) sublayerOf.set(selector, layer.params)
    })
  })
  return { declared, sublayerOf }
}

describe('utility sublayers', () => {
  test('declares every sublayer in order, before any rule, and writes each rule into one', () => {
    const css = sheetFor({ color: 'red.500', _hover: { color: 'blue.500' } })
    const { declared, sublayerOf } = inspect(css)

    expect(declared).toEqual(['s010-c0-p3000', 's020-c1-p3000'])
    expect(sublayerOf.get('.c_red\\.500')).toBe('s010-c0-p3000')
    expect(sublayerOf.get('.hover\\:c_blue\\.500:is(:hover, [data-hover])')).toBe('s020-c1-p3000')
    // The statement comes first inside the layer, so a rule can never establish an order.
    expect(css.indexOf('@layer s010-c0-p3000, s020-c1-p3000;')).toBeLessThan(css.indexOf('.c_red'))
  })

  test('orders by specificity first, whatever the sorter would have done', () => {
    // A breakpoint sorts after a hover, and used to be written after it; it has lower
    // specificity, so it now sits in an earlier sublayer and the hover still wins on overlap.
    const css = sheetFor({ _hover: { color: 'blue.500' }, md: { color: 'green.500' } })
    const { declared } = inspect(css)

    // Conditions are numbered among those present, in sorter order: the hover first, then the
    // breakpoint. The breakpoint's sublayer still comes first, on specificity.
    expect(declared).toEqual(['s010-c1-p3000', 's020-c0-p3000'])
  })

  test('then by the sorter’s condition order, then property priority', () => {
    const css = sheetFor({ padding: '4', paddingTop: '2', md: { padding: '6', paddingTop: '3' } })
    const { declared } = inspect(css)

    // Bare before conditional; within each, shorthand (1000) before longhand (4000).
    expect(declared).toEqual(['s010-c0-p1000', 's010-c0-p4000', 's010-c1-p1000', 's010-c1-p4000'])
  })

  test('numbers a condition the same wherever it appears', () => {
    const css = sheetFor({ md: { color: 'red.500', _hover: { color: 'blue.500' } }, _hover: { color: 'green.500' } })
    const { declared } = inspect(css)

    // `_hover` is c0, `md` is c1 and `md` under `_hover` is c2, at every specificity they appear at.
    expect(declared).toEqual(['s010-c1-p3000', 's020-c0-p3000', 's020-c2-p3000'])
  })

  test('puts every important declaration in one final sublayer', () => {
    const css = sheetFor({ color: 'red.500!', md: { padding: '6!' }, _hover: { color: 'blue.500' } })
    const { declared, sublayerOf } = inspect(css)

    expect(declared.at(-1)).toBe('important')
    expect(sublayerOf.get('.c_red\\.500\\!')).toBe('important')
    expect(sublayerOf.get('.md\\:p_6\\!')).toBe('important')
    expect(sublayerOf.get('.hover\\:c_blue\\.500:is(:hover, [data-hover])')).not.toBe('important')
  })

  test('splits a selector list by member when the members differ in specificity', () => {
    const css = sheetFor({ _placeholder: { color: 'gray.400' } })
    const { sublayerOf } = inspect(css)

    expect(sublayerOf.get('.placeholder\\:c_gray\\.400::placeholder')).toBe('s011-c0-p3000')
    expect(sublayerOf.get('.placeholder\\:c_gray\\.400[data-placeholder]')).toBe('s020-c0-p3000')
  })

  test('counts a descendant condition’s own selector towards specificity', () => {
    const css = sheetFor({ _groupHover: { opacity: '1' }, '& > p': { opacity: '0.5' } })
    const { sublayerOf } = inspect(css)

    expect(sublayerOf.get('.group:is(:hover, [data-hover]) .groupHover\\:op_1')).toBe('s030-c1-p3000')
    expect(sublayerOf.get('.\\[\\&_\\>_p\\]\\:op_0\\.5 > p')).toBe('s011-c0-p3000')
  })

  test('asks for the layer root more than once without repeating the statement', () => {
    const processor = createRuleProcessor()
    processor.css({ color: 'red.500' })
    const sheet = processor.sheet
    sheet.processDecoder(processor.decoder)
    const once = sheet.getLayerCss('utilities')
    const twice = sheet.getLayerCss('utilities')

    expect(twice).toBe(once)
    expect(once.match(/@layer s010-c0-p3000;/g)).toHaveLength(1)
  })
})
