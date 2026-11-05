import { createGeneratorContext, createRuleProcessor } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/**
 * The mask utilities ported from Panda 2: the `mask-*` properties, written `-webkit-` first, and the
 * fade helpers, which compose one layered `mask-image` through registered variables.
 *
 * These assert what each utility is responsible for, rather than snapshotting whole rules.
 */
type Styles = Parameters<ReturnType<typeof createRuleProcessor>['css']>[0]

const css = (styles: Record<string, unknown>) =>
  createRuleProcessor()
    .css(styles as Styles)
    .toCss()
    .replace(/\s+/g, ' ')

/** Every declaration of `property`, in the order written. */
const declarations = (styles: Record<string, unknown>, property: string) =>
  Array.from(css(styles).matchAll(new RegExp(`(?:^|[{;] )${property}:\\s*([^;}]+)`, 'g')), (match) => match[1]!.trim())

/** The `@property` registrations the finished stylesheet keeps for these styles. */
const registrations = (styles: Record<string, unknown>) => {
  const ctx = createGeneratorContext()
  ctx.encoder.processAtomic(styles as never)
  const sheet = ctx.createSheet()
  ctx.appendLayerParams(sheet)
  ctx.appendBaselineCss(sheet)
  ctx.appendParserCss(sheet)
  ctx.pruneTokens(sheet)
  return ctx.getCss(sheet)
}
const registered = (styles: Record<string, unknown>) =>
  Array.from(registrations(styles).matchAll(/@property (--mask[\w-]*)/g), (match) => match[1]).sort()

const LAYERED = 'var(--mask-linear), var(--mask-radial), var(--mask-conic)'

describe('the mask properties', () => {
  test.each([
    ['maskImage', 'url(/scribble.png)', 'mask-image'],
    ['maskSize', 'cover', 'mask-size'],
    ['maskPosition', 'center', 'mask-position'],
    ['maskRepeat', 'no-repeat', 'mask-repeat'],
    ['maskClip', 'content-box', 'mask-clip'],
    ['maskOrigin', 'border-box', 'mask-origin'],
  ])('%s is written -webkit- first', (utility, value, property) => {
    const written = css({ [utility]: value })
    expect(written).toContain(`-webkit-${property}: ${value}; ${property}: ${value}`)
  })

  // Through the variables every fade helper reads, so whichever class comes last, the value holds.
  test('maskComposite writes the webkit keyword beside the standard one', () => {
    const written = css({ maskComposite: 'add' })
    expect(written).toContain('--mask-composite: add;')
    expect(written).toContain('--mask-composite-webkit: source-over;')
    expect(written).toContain('mask-composite: var(--mask-composite)')
  })
})

describe('the fade helpers', () => {
  test('a bottom fade layers the edges and places the stop', () => {
    const styles = { maskBottomFrom: '20%' }
    expect(declarations(styles, 'mask-image')).toEqual([LAYERED])
    expect(declarations(styles, '-webkit-mask-image')).toEqual([LAYERED])
    expect(declarations(styles, '--mask-linear')).toEqual([
      'var(--mask-left), var(--mask-right), var(--mask-bottom), var(--mask-top)',
    ])
    expect(declarations(styles, '--mask-bottom')).toEqual([
      'linear-gradient(to bottom, var(--mask-bottom-from-color) var(--mask-bottom-from-position), var(--mask-bottom-to-color) var(--mask-bottom-to-position))',
    ])
    expect(declarations(styles, '--mask-bottom-from-position')).toEqual(['20%'])
  })

  test('an x fade writes the left and right edges, a y fade the top and bottom', () => {
    const x = css({ maskXFrom: '25%' })
    expect(x).toContain('--mask-left-from-position: 25%')
    expect(x).toContain('--mask-right-from-position: 25%')
    expect(x).not.toContain('--mask-top:')

    const y = css({ maskYTo: '75%' })
    expect(y).toContain('--mask-top-to-position: 75%')
    expect(y).toContain('--mask-bottom-to-position: 75%')
    expect(y).not.toContain('--mask-left:')
  })

  test('a position from the spacing scale reads its token', () => {
    expect(declarations({ maskBottomFrom: '4' }, '--mask-bottom-from-position')).toEqual(['var(--spacing-4)'])
  })

  test('linear, radial and conic stops stack as layers of their own', () => {
    const written = css({ maskLinearFrom: '10%', maskRadialFrom: '20%', maskConicFrom: '30%' })
    expect(written).toContain('--mask-linear: linear-gradient(var(--mask-linear-stops))')
    expect(written).toContain('--mask-radial: radial-gradient(var(--mask-radial-stops))')
    expect(written).toContain('--mask-conic: conic-gradient(var(--mask-conic-stops))')
  })

  test('maskLinear reads a bare number as degrees, and takes the direction shortcuts', () => {
    expect(declarations({ maskLinear: '45' }, '--mask-linear-position')).toEqual(['45deg'])
    expect(declarations({ maskLinear: 'to-br' }, '--mask-linear-position')).toEqual(['to bottom right'])
  })

  // An angle or a percentage of the turn, which no spacing scale holds: Panda typed these as
  // lengths, which a conic stop never takes.
  test('a conic stop takes an angle', () => {
    expect(declarations({ maskConicFrom: '45deg' }, '--mask-conic-from-position')).toEqual(['45deg'])
    expect(registrations({ maskConicFrom: '45deg' })).toMatch(
      /@property --mask-conic-from-position \{\s*syntax: '<angle> \| <percentage>';\s*inherits: false;\s*initial-value: 0%;?\s*\}/,
    )
  })

  test('a colour stop mixes an opacity modifier into each stop it sets', () => {
    const written = css({ maskXFromColor: 'red.300/50' })
    const mixed = 'color-mix(in srgb, var(--colors-red-300) 50%, transparent)'
    expect(written).toContain(`--mask-left-from-color: ${mixed}`)
    expect(written).toContain(`--mask-right-from-color: ${mixed}`)
    expect(written).not.toContain('--mix-')
  })
})

describe('the registrations', () => {
  test('a bottom fade keeps the ones it reads', () => {
    expect(registered({ maskBottomFrom: '50%' })).toEqual([
      '--mask-bottom',
      '--mask-bottom-from-color',
      '--mask-bottom-from-position',
      '--mask-bottom-to-color',
      '--mask-bottom-to-position',
      '--mask-composite',
      '--mask-composite-webkit',
      '--mask-conic',
      '--mask-left',
      '--mask-linear',
      '--mask-radial',
      '--mask-right',
      '--mask-top',
    ])
  })

  // So a fade on a parent does not reach a child.
  test('a stop does not inherit', () => {
    expect(registrations({ maskBottomFrom: '50%' })).toMatch(
      /@property --mask-bottom-from-position \{\s*syntax: '<length-percentage>';\s*inherits: false;\s*initial-value: 0%;?\s*\}/,
    )
  })

  test('nothing that masks, none of them', () => {
    expect(registered({ color: 'red.300' })).toEqual([])
  })
})
