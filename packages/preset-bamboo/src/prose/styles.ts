import type { SystemStyleObject } from '@bamboocss/types'
import type { ProseSize } from './types'

export interface ProseStyleParts {
  root: SystemStyleObject
  elements: Record<string, SystemStyleObject>
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function createProseBase(prefix: string, notProseClass?: string): SystemStyleObject {
  return assembleStyles(mergeParts(createBaseStyles(prefix), createScaleStyles(prefix)), notProseClass)
}

export function createProseSize(size: ProseSize, notProseClass?: string): SystemStyleObject {
  return assembleStyles(createSizeStyles(size), notProseClass)
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

// A size is one font size on the root; everything else is a ratio of it.
const rootFontSizes: Record<ProseSize, string> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
  '2xl': '2xl',
}

export function createSizeStyles(size: ProseSize): ProseStyleParts {
  return {
    root: { fontSize: rootFontSizes[size] },
    elements: {},
  }
}

// ---------------------------------------------------------------------------
// Rhythm and scale
// ---------------------------------------------------------------------------

const BLOCK_FALLBACK = '> *'

// Leading is line height; flow is the gap between blocks, in body-ems. Elements measure in `em`.
export function createScaleStyles(prefix: string): ProseStyleParts {
  const leading = cssVar(prefix, 'leading')
  const flow = cssVar(prefix, 'flow')
  // `em` in the flow var resolves per element, so divide by the element's ratio to stay in body-ems.
  const flowTimes = (bodyEms: number, ratio = 1) => raw(`calc(${flow.ref} * ${round(bodyEms / ratio)})`)

  // Assigned: computed `--*` keys in a literal widen to a string index.
  const root: SystemStyleObject = { lineHeight: raw(leading.ref) }
  root[leading.name] = raw('1.625')
  root[flow.name] = raw('1.25em')

  return {
    root,
    elements: {
      [BLOCK_FALLBACK]: { marginBlockStart: raw(flow.ref) },
      p: { marginBlockStart: raw(flow.ref) },
      '.lead': {
        color: color(prefix, 'lead'),
        fontWeight: 'normal',
        fontSize: raw('1.125em'),
        marginBlockStart: flowTimes(1, 1.125),
      },
      blockquote: {
        marginBlockStart: flowTimes(1.2),
        paddingInlineStart: raw('1.25em'),
      },
      h1: {
        fontSize: raw('2.25em'),
        lineHeight: raw('1.25'),
        marginBlockStart: '0',
      },
      h2: {
        fontSize: raw('1.5em'),
        lineHeight: raw('1.375'),
        marginBlockStart: flowTimes(2.4, 1.5),
      },
      h3: {
        fontSize: raw('1.25em'),
        lineHeight: raw('1.375'),
        marginBlockStart: flowTimes(1.6, 1.25),
      },
      h4: {
        fontSize: raw('1.125em'),
        lineHeight: raw('1.375'),
        marginBlockStart: flowTimes(1.2, 1.125),
      },
      'ol, ul': {
        marginBlockStart: raw(flow.ref),
        paddingInlineStart: raw('1.5em'),
      },
      li: { marginBlockStart: flowTimes(0.4) },
      'ol ol, ul ul, ol ul, ul ol': { marginBlockStart: flowTimes(0.4) },
      hr: { marginBlockStart: flowTimes(2) },
      pre: {
        marginBlockStart: flowTimes(1.2, 0.875),
        padding: raw('1.1428571em 1.4285714em'),
        fontSize: raw('0.875em'),
        lineHeight: raw(leading.ref),
      },
      kbd: {
        fontSize: raw('0.875em'),
        paddingInline: raw('0.2857143em'),
        paddingBlock: raw('0.2285714em'),
      },
      table: {
        marginBlockStart: flowTimes(1.2, 0.875),
        fontSize: raw('0.875em'),
        lineHeight: raw('1.5'),
      },
      'thead th, tbody td, tfoot td': {
        paddingInline: raw('0.5714286em'),
        paddingBlock: raw('0.5714286em'),
      },
      'figure, img, video': { marginBlockStart: flowTimes(1.2) },
      figcaption: {
        marginBlockStart: flowTimes(0.6, 0.875),
        fontSize: raw('0.875em'),
        lineHeight: raw('1.5'),
      },
      '> :first-child': { marginBlockStart: '0' },
    },
  }
}

// ---------------------------------------------------------------------------
// Colors and structure
// ---------------------------------------------------------------------------

export function createBaseStyles(prefix: string): ProseStyleParts {
  return {
    root: {
      color: color(prefix, 'body'),
      maxWidth: 'prose',
    },
    elements: {
      a: {
        color: color(prefix, 'link'),
        textDecoration: 'underline',
        textDecorationColor: color(prefix, 'linkDecoration'),
        textDecorationThickness: raw('1px'),
        fontWeight: 'medium',
        textUnderlineOffset: raw('0.2em'),
      },
      'strong, b': {
        color: color(prefix, 'bold'),
        fontWeight: 'semibold',
      },
      'ol, ul': {
        paddingInlineStart: '6',
      },
      ol: {
        listStyleType: 'decimal',
      },
      ul: {
        listStyleType: 'disc',
      },
      'ol > li::marker': {
        color: color(prefix, 'counter'),
        fontWeight: 'normal',
      },
      'ul > li::marker': {
        color: color(prefix, 'bullet'),
      },
      hr: {
        borderColor: color(prefix, 'hrBorder'),
        borderTopWidth: raw('1px'),
      },
      blockquote: {
        fontWeight: 'medium',
        fontStyle: 'normal',
        color: color(prefix, 'quote'),
        borderInlineStartWidth: raw('2px'),
        borderInlineStartColor: color(prefix, 'quoteBorder'),
      },
      'h1, h2, h3, h4': {
        color: color(prefix, 'heading'),
        fontWeight: 'semibold',
        letterSpacing: 'tight',
      },
      'h1 strong, h2 strong, h3 strong, h4 strong': {
        fontWeight: 'bold',
        color: 'inherit',
      },
      code: {
        color: color(prefix, 'code'),
        backgroundColor: color(prefix, 'codeBg'),
        fontWeight: 'medium',
        fontFamily: 'mono',
        fontSize: raw('0.875em'),
        paddingInline: raw('0.3em'),
        paddingBlock: raw('0.15em'),
        borderRadius: 'sm',
      },
      'a code': {
        color: 'inherit',
      },
      'h1 code, h2 code, h3 code, h4 code': {
        color: 'inherit',
      },
      pre: {
        color: color(prefix, 'preCode'),
        backgroundColor: color(prefix, 'preBg'),
        overflowX: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: raw(`token(colors.${prefix}.hrBorder) transparent`),
        fontWeight: 'normal',
        fontFamily: 'mono',
        borderRadius: 'md',
      },
      'pre code': {
        backgroundColor: 'transparent',
        borderWidth: raw('0'),
        borderRadius: raw('0'),
        padding: '0',
        fontWeight: 'inherit',
        color: 'inherit',
        fontSize: 'inherit',
        fontFamily: 'inherit',
        lineHeight: 'inherit',
      },
      kbd: {
        color: color(prefix, 'kbd'),
        fontFamily: 'mono',
        fontWeight: 'medium',
        borderWidth: raw('1px'),
        borderColor: color(prefix, 'hrBorder'),
        borderRadius: 'sm',
      },
      table: {
        width: raw('100%'),
        tableLayout: 'auto',
        textAlign: 'start',
      },
      thead: {
        borderBottomWidth: raw('1px'),
        borderBottomColor: color(prefix, 'thBorder'),
      },
      'thead th': {
        color: color(prefix, 'heading'),
        fontWeight: 'semibold',
        verticalAlign: 'bottom',
      },
      'tbody tr + tr': {
        borderTopWidth: raw('1px'),
        borderTopColor: color(prefix, 'tdBorder'),
      },
      'tbody td': {
        verticalAlign: 'baseline',
      },
      tfoot: {
        borderTopWidth: raw('1px'),
        borderTopColor: color(prefix, 'thBorder'),
      },
      img: {
        maxWidth: raw('100%'),
        height: 'auto',
      },
      figcaption: {
        color: color(prefix, 'caption'),
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A value meant as css rather than a token: what `[value]` says, so a project with `strictValues`
 * on reads the preset as it reads its own source. Written plainly, its 41 values each failed or
 * warned there.
 */
function raw(value: string) {
  return `[${value}]`
}

function color(prefix: string, role: string) {
  return `${prefix}.${role}`
}

function cssVar(prefix: string, name: string) {
  const property = `--${prefix}-${name}` as `--${string}`
  return { name: property, ref: `var(${property})` }
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}

function mergeParts(first: ProseStyleParts, second: ProseStyleParts): ProseStyleParts {
  const elements: Record<string, SystemStyleObject> = { ...first.elements }
  for (const [selector, styles] of Object.entries(second.elements)) {
    elements[selector] = { ...elements[selector], ...styles } as SystemStyleObject
  }
  return { root: { ...first.root, ...second.root } as SystemStyleObject, elements }
}

function nestSelector(part: string, notProseClass?: string): string {
  const notProse = notProseClass ? `:not(:where([class~="${notProseClass}"],[class~="${notProseClass}"] *))` : ''
  // Keep even the recipe's own class at zero specificity so the child's own margin wins.
  if (part === BLOCK_FALLBACK) return `:where(& > *)${notProse}`
  if (!notProse) return `& ${part}`

  // A part that opens with a combinator, `> :first-child`, stays outside `:where()`, which takes no
  // combinator first: inside it, as Panda writes it, the rule matched nothing.
  return /^[>+~]/.test(part) ? `& ${part}${notProse}` : `& :where(${part})${notProse}`
}

/**
 * The element styles nested under the root, each element under a key of its own.
 *
 * Panda writes elements styled alike under one key, `& h1, & h2, & h3, & h4`. An override of one of
 * them, `cx(prose(), css({ '& h2': { color } }))`, is then no key the recipe has: rather than
 * replacing the recipe's color for `h2`, it was ranked against it by the order the two were first
 * compiled in. Under keys of their own, `cx` merges the override over the recipe's, as it does any
 * key both write. An element in several groups takes each group's styles, in the order written.
 */
export function assembleStyles(parts: ProseStyleParts, notProseClass?: string): SystemStyleObject {
  const nested: Record<string, SystemStyleObject> = {}

  for (const [selector, value] of Object.entries(parts.elements)) {
    for (const part of selector.split(',')) {
      const key = nestSelector(part.trim(), notProseClass)
      nested[key] = { ...nested[key], ...value } as SystemStyleObject
    }
  }

  return { ...parts.root, ...nested } as SystemStyleObject
}
