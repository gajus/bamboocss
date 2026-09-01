import { createContext } from '@bamboocss/fixture'
import { logger } from '@bamboocss/logger'
import { describe, expect, test, vi } from 'vitest'
import { cascadeOrder, specificity } from './cascade-oracle'

/**
 * The oracle itself, on stylesheets small enough to rank by hand.
 *
 * Each case is one rule of the cascade, isolated: a browser applying only that rule to the
 * sheet would agree with the ranking. The corpus at the end is what the oracle is *for*.
 */
describe('the cascade oracle', () => {
  test('ranks by source order last', () => {
    expect(cascadeOrder(`.a{color:red}.b{color:blue}`)).toEqual({ color: ['.a', '.b'] })
  })

  test('ranks a later layer over an earlier one, and unlayered rules over every layer', () => {
    const css = `@layer a, b; @layer b{.late{color:red}} @layer a{.early{color:red}} .loose{color:red}`
    expect(cascadeOrder(css)).toEqual({ color: ['.early', '.late', '.loose'] })
  })

  test('orders layers by first appearance when nothing declares them', () => {
    expect(cascadeOrder(`@layer b{.b{color:red}} @layer a{.a{color:red}}`)).toEqual({ color: ['.b', '.a'] })
  })

  test('ranks a layer’s own rules over its sublayers, in declared sublayer order', () => {
    const css = `@layer u; @layer u{@layer y, x; @layer x{.x{color:red}} @layer y{.y{color:red}} .own{color:red}}`
    expect(cascadeOrder(css)).toEqual({ color: ['.y', '.x', '.own'] })
  })

  test('reads a dotted layer name as a nested one', () => {
    const css = `@layer u.x, u.y; @layer u.y{.y{color:red}} @layer u.x{.x{color:red}} @layer u{.own{color:red}}`
    expect(cascadeOrder(css)).toEqual({ color: ['.x', '.y', '.own'] })
  })

  test('inverts layer order for important declarations, unlayered last', () => {
    const css = `@layer a, b; @layer a{.a{color:red !important}} @layer b{.b{color:red !important}} .loose{color:red !important}`
    expect(cascadeOrder(css)).toEqual({ color: ['.loose !important', '.b !important', '.a !important'] })
  })

  test('ranks any important declaration over any normal one', () => {
    const css = `@layer a, b; @layer a{.a{color:red !important}} @layer b{.b{color:red}} .loose{color:red}`
    expect(cascadeOrder(css)).toEqual({ color: ['.b', '.loose', '.a !important'] })
  })

  test('ranks by specificity before source order, within one layer', () => {
    const css = `@layer u{.group:hover .a{color:red} .b{color:red} .c:hover{color:red}}`
    expect(cascadeOrder(css)).toEqual({ color: ['.b', '.c:hover', '.group:hover .a'] })
  })

  test('lets a layer decide before specificity does', () => {
    const css = `@layer a, b; @layer a{.group:hover .strong{color:red}} @layer b{.weak{color:red}}`
    expect(cascadeOrder(css)).toEqual({ color: ['.group:hover .strong', '.weak'] })
  })

  test('keeps each conditional context in the description and ranks across them', () => {
    const css = `@layer u{.a{color:red} @media (min-width:40em){.md\\:a{color:red}} @container (min-width:20em){.cq{color:red}}}`
    expect(cascadeOrder(css)).toEqual({
      color: ['.a', '@media (min-width:40em) .md\\:a', '@container (min-width:20em) .cq'],
    })
  })

  test('ranks each selector of a list on its own', () => {
    const css = `.a, .group:hover .b{color:red} .c{color:red}`
    expect(cascadeOrder(css)).toEqual({ color: ['.a', '.c', '.group:hover .b'] })
  })

  test('leaves keyframe steps and descriptors out', () => {
    const css = `@keyframes spin{to{color:red}} @font-face{font-family:X} .a{color:red}`
    expect(cascadeOrder(css)).toEqual({ color: ['.a'] })
  })

  test('reports every property separately', () => {
    expect(cascadeOrder(`.a{color:red;padding:0}.b{padding:1px}`)).toEqual({
      color: ['.a'],
      padding: ['.a', '.b'],
    })
  })
})

describe('specificity', () => {
  test.each([
    ['.a', [0, 1, 0]],
    ['#id .a b', [1, 1, 1]],
    ['.a:hover', [0, 2, 0]],
    ['.a::before', [0, 1, 1]],
    ['.a:before', [0, 1, 1]],
    ['.group:hover .a', [0, 3, 0]],
    ['.peer:is(:checked, [data-checked]) ~ .a', [0, 3, 0]],
    [':where([dir=rtl], :dir(rtl)) .a', [0, 1, 0]],
    ['.a:is(:hover, [data-hover], .x .y)', [0, 3, 0]],
    ['.a:not(#b)', [1, 1, 0]],
    ['.a:has(> img)', [0, 1, 1]],
    ['.a > p', [0, 1, 1]],
    ['.a :is(p, li) a', [0, 1, 2]],
    ['*', [0, 0, 0]],
    ['.a:nth-child(even)', [0, 2, 0]],
  ] as const)('%s → %j', (selector, expected) => {
    expect(specificity(selector)).toEqual(expected)
  })
})

/**
 * The corpus: every way an author can make two declarations compete, through the real
 * pipeline, ranked. This snapshot is the precedence contract of the emitted stylesheet.
 *
 * It exists for a change to *where* rules are written — cascade sublayers, per-chunk sheets, a
 * different sorter. Any of those may move every rule in the file and must leave this ranking
 * exactly as it is; a diff here names the pair whose winner would change in a browser. It is
 * not a CSS output snapshot: the bytes can change freely, the ranking cannot.
 */
describe('the precedence contract', () => {
  const source = `
    import { css, cva, sva, cx } from 'styled-system/css'
    import { buttonStyle, textStyle, checkbox } from 'styled-system/recipes'
    import { center, flex } from 'styled-system/patterns'

    export const shorthands = css({ padding: '4', paddingTop: '2', pt: '3', margin: '2', marginInline: '4', mx: '1', inset: '0', top: '2' })
    export const states = css({ color: 'red.500', _hover: { color: 'blue.500' }, _focus: { color: 'green.500' }, _active: { color: 'pink.500' }, _focusVisible: { color: 'purple.500' }, _disabled: { color: 'gray.500' } })
    export const relations = css({ opacity: '0.5', _groupHover: { opacity: '1' }, _peerChecked: { opacity: '0.8' }, _groupFocusVisible: { opacity: '0.9' } })
    export const responsive = css({ display: 'block', md: { display: 'flex' }, lg: { display: 'grid' }, mdDown: { display: 'none' }, mdOnly: { display: 'inline' }, mdToLg: { display: 'inline-block' } })
    export const nested = css({ fontSize: 'sm', _hover: { md: { fontSize: 'lg' } }, md: { _hover: { fontSize: 'xl' } }, _dark: { fontSize: 'md', _hover: { fontSize: '2xl' } } })
    export const scheme = css({ bg: 'white', _dark: { bg: 'black' }, _osDark: { bg: 'gray.900' }, _osLight: { bg: 'gray.50' } })
    export const marks = css({ color: 'orange.500!', padding: '2 !important', _hover: { color: 'teal.500!' }, md: { padding: '6!' } })
    export const pseudoElements = css({ _before: { content: '""', display: 'block', width: '4' }, _after: { content: '"x"', display: 'inline', width: '2' } })
    export const arbitrary = css({ '& > p': { color: 'gray.700', marginBottom: '2' }, '&:has(img)': { padding: '0' }, '.theme-x &': { color: 'gray.100' }, '&[data-open]': { display: 'flex' }, '& :is(p, li) a': { textDecorationLine: 'underline' } })
    export const container = css({ containerType: 'inline-size', fontSize: { base: 'sm', '@/sm': 'md', '@/lg': 'lg' } })
    export const motion = css({ transition: 'all 0.2s', _motionReduce: { transition: 'none' }, _starting: { opacity: '0' }, _print: { display: 'none' } })
    export const logical = css({ borderInlineStart: '1px solid', borderLeft: '2px solid', roundedStart: 'md', borderRadius: 'lg' })
    export const badge = cva({
      base: { display: 'inline-flex', px: '2', color: 'gray.700' },
      variants: {
        tone: { quiet: { color: 'gray.500', bg: 'gray.100' }, loud: { color: 'white', bg: 'red.600' } },
        size: { sm: { px: '1', fontSize: 'xs' }, lg: { px: '4', fontSize: 'lg' } },
      },
      compoundVariants: [{ tone: 'loud', size: 'lg', css: { fontWeight: 'bold', px: '6' } }],
      defaultVariants: { tone: 'quiet', size: 'sm' },
    })
    export const badges = [badge({ tone: 'loud', size: 'lg' }), badge({ tone: 'quiet' })]
    export const parts = sva({
      slots: ['root', 'label'],
      base: { root: { display: 'flex', gap: '2' }, label: { fontSize: 'sm' } },
      variants: { size: { lg: { label: { fontSize: 'lg' }, root: { gap: '4' } } } },
    })
    export const partClasses = parts({ size: 'lg' })
    export const configured = [buttonStyle({ size: 'sm', variant: 'solid' }), textStyle({ size: 'h1' }), checkbox({ size: 'md' })]
    export const patterns = [flex({ align: 'center', gap: '4', direction: 'column' }), center({ inline: true })]
    export const merged = cx(css({ color: 'red.500' }), css({ color: 'blue.500', _hover: { color: 'green.500' } }))
  `

  const emit = () => {
    const ctx = createContext() as any
    const file = ctx.runtime.path.abs(ctx.config.cwd, 'src/corpus.tsx')
    ctx.project.addSourceFile(file, source)
    ctx.getFiles = () => [file]
    ctx.parseFiles()
    const sheet = ctx.createSheet()
    ctx.appendBaselineCss(sheet)
    ctx.appendParserCss(sheet)
    return ctx.getCss(sheet) as string
  }

  test('is what the emitted stylesheet ranks to', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const css = emit()
    const order = cascadeOrder(css)

    // A sanity floor, so an empty corpus cannot pass as an unchanged one.
    expect(Object.keys(order).length).toBeGreaterThan(20)
    expect(order.color!.length).toBeGreaterThan(8)

    expect(order).toMatchSnapshot()
  })
})
