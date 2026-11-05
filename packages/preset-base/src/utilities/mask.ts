import type { CssPropertyDefinition, NestedCssProperties, PropertyConfig, UtilityConfig } from '@bamboocss/types'
import { createColorMixTransform } from '../color-mix-transform'

// Ported from Panda 2's preset. `mask-image` is three gradient layers, intersected:
//
//   --mask-linear , --mask-radial , --mask-conic
//         │
//         └─ the edge helpers swap it for four edge gradients:
//            --mask-left , --mask-right , --mask-bottom , --mask-top
//
// Each of those seven reads the same four stops — `{from,to}-{color,position}` — so an unset layer
// falls back to an opaque identity gradient and masks nothing.

const IDENTITY = 'linear-gradient(#fff, #fff)'
const maskVar = (name: string) => `var(--mask-${name})`

const LAYERS = ['linear', 'radial', 'conic'] as const
const EDGES = ['left', 'right', 'bottom', 'top'] as const

type MaskLayer = (typeof LAYERS)[number]
type MaskEdge = (typeof EDGES)[number]

const MASK_IMAGE = LAYERS.map(maskVar).join(', ')
const MASK_EDGES = EDGES.map(maskVar).join(', ')

// —— variable registrations ————————————————————————————————————————————————

const image: CssPropertyDefinition = { inherits: false, initialValue: IDENTITY, syntax: '*' }
const composedList: CssPropertyDefinition = { inherits: false, syntax: '*' }
const keyword = (initialValue: string): CssPropertyDefinition => ({ inherits: false, initialValue, syntax: '*' })
const color = (initialValue: string): CssPropertyDefinition => ({ inherits: false, initialValue, syntax: '<color>' })
const position = (initialValue: string, syntax = '<length-percentage>'): CssPropertyDefinition => ({
  inherits: false,
  initialValue,
  syntax,
})

/**
 * A conic gradient places its stops by angle, `90deg`, or by percentage of the turn. Panda types
 * them as lengths, which a conic stop never takes: a length emptied the mask, and an angle fell
 * back to the initial value without a word.
 */
const STOP_POSITION: Record<string, string> = { conic: '<angle> | <percentage>' }

function gradientVars(name: string): Record<string, CssPropertyDefinition> {
  return {
    [`--mask-${name}`]: image,
    [`--mask-${name}-from-color`]: color('black'),
    [`--mask-${name}-to-color`]: color('transparent'),
    [`--mask-${name}-from-position`]: position('0%', STOP_POSITION[name]),
    [`--mask-${name}-to-position`]: position('100%', STOP_POSITION[name]),
  }
}

// Every utility in the layer system carries the whole group: they all write the same layered
// `mask-image`, so ownership is not divisible. Each registration is kept only where a rule reads
// it. `inherits: false` is what stops a parent's fade reaching a child.
const maskVars: Record<string, CssPropertyDefinition> = Object.assign(
  {},
  ...[...LAYERS, ...EDGES].map(gradientVars),
  ...LAYERS.map((layer) => ({ [`--mask-${layer}-stops`]: composedList })),
  {
    // `to bottom` is as valid here as `45deg`.
    '--mask-linear-position': keyword('0deg'),
    '--mask-conic-position': keyword('0deg'),
    '--mask-radial-position': keyword('center'),
    '--mask-radial-shape': keyword('ellipse'),
    '--mask-radial-size': keyword('farthest-corner'),
    '--mask-composite': keyword('intersect'),
    '--mask-composite-webkit': keyword('source-in'),
  },
)

// —— layer wiring ——————————————————————————————————————————————————————————

type Declarations = Record<string, string>

const cssProps = (styles: Declarations) => styles as unknown as NestedCssProperties

/** The declarations every fade helper repeats, so any one of them is self-sufficient. */
function maskLayers(layers: Declarations): Declarations {
  return {
    WebkitMaskImage: MASK_IMAGE,
    maskImage: MASK_IMAGE,
    WebkitMaskComposite: maskVar('composite-webkit'),
    maskComposite: maskVar('composite'),
    ...layers,
  }
}

function stopList(name: string) {
  return `${maskVar(`${name}-from-color`)} ${maskVar(`${name}-from-position`)}, ${maskVar(`${name}-to-color`)} ${maskVar(`${name}-to-position`)}`
}

/** Replaces the linear layer with one gradient per edge, each fading toward that edge. */
function edgeLayers(edges: readonly MaskEdge[]): Declarations {
  const layers: Declarations = { '--mask-linear': MASK_EDGES }
  for (const edge of edges) layers[`--mask-${edge}`] = `linear-gradient(to ${edge}, ${stopList(edge)})`
  return maskLayers(layers)
}

/** The gradient's leading argument: an angle, or a shape and an origin. */
const GEOMETRY = {
  linear: { fn: 'linear-gradient', head: maskVar('linear-position') },
  radial: {
    fn: 'radial-gradient',
    head: `${maskVar('radial-shape')} ${maskVar('radial-size')} at ${maskVar('radial-position')}`,
  },
  conic: { fn: 'conic-gradient', head: `from ${maskVar('conic-position')}` },
} as const satisfies Record<MaskLayer, { fn: string; head: string }>

function gradientLayer(layer: MaskLayer): Declarations {
  const { fn, head } = GEOMETRY[layer]
  return maskLayers({
    [`--mask-${layer}-stops`]: `${head}, ${stopList(layer)}`,
    [`--mask-${layer}`]: `${fn}(${maskVar(`${layer}-stops`)})`,
  })
}

// —— stop utilities ————————————————————————————————————————————————————————

type Wiring = () => Declarations

function positionStop(
  className: string,
  vars: readonly string[],
  wiring: Wiring,
  values: PropertyConfig['values'],
): PropertyConfig {
  return {
    className,
    values,
    group: 'Mask',
    customProperties: maskVars,
    transform(value) {
      const stops = Object.fromEntries(vars.map((name) => [`--mask-${name}`, value]))
      return cssProps({ ...wiring(), ...stops })
    },
  }
}

/** A colour stop, with an opacity modifier mixed. */
function colorStop(className: string, vars: readonly string[], wiring: Wiring): PropertyConfig {
  return {
    className,
    values: 'colors',
    group: 'Mask',
    customProperties: maskVars,
    transform(value, args) {
      const stops: Declarations = {}
      for (const name of vars) Object.assign(stops, createColorMixTransform(`--mask-${name}`)(value, args))
      return cssProps({ ...wiring(), ...stops })
    },
  }
}

/**
 * The four utilities every fade exposes: `From`, `To`, `FromColor`, `ToColor`. A position is a
 * length or a percentage from the spacing scale, but for a conic gradient's, an angle or a
 * percentage, which no scale holds.
 */
function stopProps(prop: string, className: string, targets: readonly string[], wiring: Wiring, conic = false) {
  const vars = (suffix: string) => targets.map((target) => `${target}-${suffix}`)
  const values = conic ? undefined : 'spacing'
  return {
    [`${prop}From`]: positionStop(`${className}-from`, vars('from-position'), wiring, values),
    [`${prop}To`]: positionStop(`${className}-to`, vars('to-position'), wiring, values),
    [`${prop}FromColor`]: colorStop(`${className}-from-c`, vars('from-color'), wiring),
    [`${prop}ToColor`]: colorStop(`${className}-to-c`, vars('to-color'), wiring),
  } satisfies UtilityConfig
}

const EDGE_GROUPS = [
  ['Top', 't', ['top']],
  ['Right', 'r', ['right']],
  ['Bottom', 'b', ['bottom']],
  ['Left', 'l', ['left']],
  ['X', 'x', ['left', 'right']],
  ['Y', 'y', ['top', 'bottom']],
] as const satisfies ReadonlyArray<readonly [string, string, readonly MaskEdge[]]>

const edgeProps: UtilityConfig = Object.assign(
  {},
  ...EDGE_GROUPS.map(([name, short, edges]) =>
    stopProps(`mask${name}`, `msk-${short}`, edges, () => edgeLayers(edges)),
  ),
)

const layerProps = (layer: MaskLayer) =>
  stopProps(
    `mask${layer[0]!.toUpperCase()}${layer.slice(1)}`,
    `msk-${layer}`,
    [layer],
    () => gradientLayer(layer),
    layer === 'conic',
  )

// —— the css mask properties ————————————————————————————————————————————————

/** A `mask-*` property, written `-webkit-` first. */
function prefixed(prop: string, className: string): PropertyConfig {
  const webkit = `Webkit${prop[0]!.toUpperCase()}${prop.slice(1)}`
  return {
    className,
    group: 'Mask',
    transform(value) {
      return cssProps({ [webkit]: value, [prop]: value })
    },
  }
}

const webkitMaskComposite: Record<string, string> = {
  add: 'source-over',
  subtract: 'source-out',
  intersect: 'source-in',
  exclude: 'xor',
}

const linearDirectionMap = new Map([
  ['to-t', 'to top'],
  ['to-tr', 'to top right'],
  ['to-r', 'to right'],
  ['to-br', 'to bottom right'],
  ['to-b', 'to bottom'],
  ['to-bl', 'to bottom left'],
  ['to-l', 'to left'],
  ['to-tl', 'to top left'],
])

/** A bare number is degrees: `maskLinear: '45'` means `45deg`. */
const asAngle = (raw: string, value: string) => (/^-?\d+(\.\d+)?$/.test(raw) ? `${raw}deg` : value)

const varOnly = (name: string, className: string, values: Record<string, string>): PropertyConfig => ({
  className,
  group: 'Mask',
  customProperties: maskVars,
  values,
  transform: (value) => ({ [`--mask-${name}`]: value }),
})

export const mask: UtilityConfig = {
  mask: prefixed('mask', 'msk'),
  maskImage: prefixed('maskImage', 'msk-i'),
  maskSize: prefixed('maskSize', 'msk-s'),
  maskPosition: prefixed('maskPosition', 'msk-p'),
  maskRepeat: prefixed('maskRepeat', 'msk-r'),
  maskClip: prefixed('maskClip', 'msk-cp'),
  maskOrigin: prefixed('maskOrigin', 'msk-o'),
  maskComposite: {
    className: 'msk-cmp',
    group: 'Mask',
    customProperties: maskVars,
    // Through the variables every fade helper reads, so which class comes last cannot decide.
    transform(value) {
      return cssProps({
        '--mask-composite': value,
        '--mask-composite-webkit': webkitMaskComposite[value] ?? value,
        WebkitMaskComposite: maskVar('composite-webkit'),
        maskComposite: maskVar('composite'),
      })
    },
  },
  maskMode: { className: 'msk-md', group: 'Mask' },
  maskType: { className: 'msk-t', group: 'Mask' },

  ...edgeProps,

  maskLinear: {
    className: 'msk-linear',
    group: 'Mask',
    customProperties: maskVars,
    values: () => Object.fromEntries(linearDirectionMap.entries()),
    transform(value, { raw }) {
      const angle = linearDirectionMap.get(String(raw)) ?? asAngle(String(raw), value)
      return cssProps({ ...gradientLayer('linear'), '--mask-linear-position': angle })
    },
  },
  ...layerProps('linear'),

  maskRadial: {
    className: 'msk-radial',
    group: 'Mask',
    customProperties: maskVars,
    transform(value) {
      return cssProps({ ...gradientLayer('radial'), '--mask-radial-size': value })
    },
  },
  ...layerProps('radial'),
  maskRadialAt: varOnly('radial-position', 'msk-radial-at', {
    center: 'center',
    top: 'top',
    bottom: 'bottom',
    left: 'left',
    right: 'right',
    'top left': 'top left',
    'top right': 'top right',
    'bottom left': 'bottom left',
    'bottom right': 'bottom right',
  }),
  maskRadialSize: varOnly('radial-size', 'msk-radial-sz', {
    'closest-side': 'closest-side',
    'closest-corner': 'closest-corner',
    'farthest-side': 'farthest-side',
    'farthest-corner': 'farthest-corner',
  }),
  maskRadialShape: varOnly('radial-shape', 'msk-radial-shape', { circle: 'circle', ellipse: 'ellipse' }),

  maskConic: {
    className: 'msk-conic',
    group: 'Mask',
    customProperties: maskVars,
    transform(value, { raw }) {
      return cssProps({ ...gradientLayer('conic'), '--mask-conic-position': asAngle(String(raw), value) })
    },
  },
  ...layerProps('conic'),
}
