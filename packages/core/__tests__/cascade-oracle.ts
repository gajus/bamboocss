import postcss, { type AtRule, type ChildNode, type Container, type Declaration } from 'postcss'
import selectorParser, { type Selector } from 'postcss-selector-parser'

/**
 * A model of the browser's cascade, read off a finished stylesheet.
 *
 * Bamboo decides precedence between atoms by where it writes them: one utilities layer, ordered
 * by property priority, condition and pseudo rank, so that equal-specificity rules resolve the
 * way the sorter meant. Nothing checks that the *sheet* says what the sorter meant, and nothing
 * can: no test drives a browser any more. This is the deterministic stand-in. It reads the CSS
 * text alone — layers, importance, specificity, source order — and ranks every rule that sets a
 * property, weakest first, exactly as a browser would rank them for an element carrying all of
 * their selectors at once.
 *
 * Its use is as an oracle for a change to *where* rules are written. Move every utility into
 * cascade sublayers, split the sheet per chunk, reorder the sorter: if the ranking this returns
 * is unchanged, no element anywhere can resolve to a different declaration, whatever the
 * browser. If it changed, the diff names the pair.
 */
export type Specificity = [ids: number, classes: number, elements: number]

export interface CascadeEntry {
  property: string
  /** One selector of the rule's list; a list is one rule with several entries. */
  selector: string
  /** Every conditional at-rule the rule sits under, outermost first. `@layer` is not one. */
  atRules: string[]
  /** The cascade layer path, `[]` for an unlayered rule. */
  layer: string[]
  important: boolean
  specificity: Specificity
  /** Document order among every declaration in the sheet. */
  order: number
}

/** Pseudo-classes whose specificity is that of their most specific argument. */
const FORGIVING = new Set([':is', ':matches', ':not', ':has', ':-webkit-any', ':-moz-any'])
/** Legacy single-colon spellings of pseudo-elements. */
const ELEMENT_PSEUDOS = new Set([':before', ':after', ':first-line', ':first-letter'])
/** At-rules whose block is a set of descriptors or keyframe steps, not rules that cascade. */
const NOT_A_CASCADE = new Set(['keyframes', 'font-face', 'property', 'counter-style', 'page', 'position-try'])

export const compareSpecificity = (a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const specificityOfSelector = (selector: Selector): Specificity => {
  const total: Specificity = [0, 0, 0]
  for (const node of selector.nodes) {
    switch (node.type) {
      case 'id':
        total[0]++
        break
      case 'class':
      case 'attribute':
        total[1]++
        break
      case 'tag':
        if (node.value !== '*') total[2]++
        break
      case 'pseudo': {
        const name = node.value.toLowerCase()
        if (name.startsWith('::') || ELEMENT_PSEUDOS.has(name)) {
          total[2]++
          break
        }
        if (name === ':where') break
        if (FORGIVING.has(name)) {
          let best: Specificity = [0, 0, 0]
          for (const inner of node.nodes as Selector[]) {
            const candidate = specificityOfSelector(inner)
            if (compareSpecificity(candidate, best) > 0) best = candidate
          }
          total[0] += best[0]
          total[1] += best[1]
          total[2] += best[2]
          break
        }
        // `:nth-child(An+B of S)` adds S as well; nothing here emits that form.
        total[1]++
        break
      }
      default:
        // Combinators, the universal selector, nesting and comments count for nothing.
        break
    }
  }
  return total
}

/** The specificity of one complete selector, as the browser computes it. */
export const specificity = (selector: string): Specificity => {
  let result: Specificity = [0, 0, 0]
  selectorParser((root) => {
    // A selector list is never handed in — `rule.selectors` splits it — but a lone list takes
    // its most specific member, which is what `:is()` does with one too.
    for (const candidate of root.nodes) {
      const value = specificityOfSelector(candidate)
      if (compareSpecificity(value, result) > 0) result = value
    }
  }).processSync(selector)
  return result
}

/**
 * The order of cascade layers, by first appearance.
 *
 * A statement declares its names in list order; a block declares its name where it stands; a
 * dotted name declares each segment under the one before. Appearing inside a layer block
 * declares under that layer. The first sighting fixes a layer's position, as in the browser.
 */
class LayerOrder {
  private readonly children = new Map<string, string[]>()

  declare(path: readonly string[]) {
    for (let depth = 0; depth < path.length; depth++) {
      const parent = path.slice(0, depth).join('.')
      const siblings = this.children.get(parent) ?? []
      if (!siblings.includes(path[depth]!)) siblings.push(path[depth]!)
      this.children.set(parent, siblings)
    }
  }

  indices(path: readonly string[]) {
    this.declare(path)
    return path.map((name, depth) => this.children.get(path.slice(0, depth).join('.'))!.indexOf(name))
  }

  /**
   * Positive when `a` comes later, which is what wins for a normal declaration.
   *
   * A layer's own rules sit in an implicit final sublayer, after every declared sublayer, and
   * unlayered rules sit in an implicit final layer after every declared layer — so a path that
   * ends is read as "later than anything declared beneath the point it ended".
   */
  compare(a: readonly string[], b: readonly string[]) {
    const x = this.indices(a)
    const y = this.indices(b)
    for (let depth = 0; depth < Math.max(x.length, y.length); depth++) {
      const left = x[depth] ?? Number.POSITIVE_INFINITY
      const right = y[depth] ?? Number.POSITIVE_INFINITY
      if (left !== right) return left < right ? -1 : 1
    }
    return 0
  }
}

const layerPathOf = (params: string) => params.trim().split('.')

/** Every declaration the sheet holds, with everything the cascade will read about it. */
export const cascadeEntries = (css: string): { entries: CascadeEntry[]; layers: LayerOrder } => {
  const root = postcss.parse(css)
  const layers = new LayerOrder()
  const entries: CascadeEntry[] = []
  let order = 0

  const layerOf = (node: Container | ChildNode | undefined): string[] => {
    const path: string[] = []
    let current: Container | ChildNode | undefined = node
    while (current && current.type !== 'root' && current.type !== 'document') {
      if (current.type === 'atrule' && (current as AtRule).name.toLowerCase() === 'layer') {
        path.unshift(...layerPathOf((current as AtRule).params))
      }
      current = current.parent as Container | undefined
    }
    return path
  }

  // Layers are declared in document order, statements and blocks alike, before any rule is
  // ranked: a block seen late still names a layer a statement placed early.
  root.walkAtRules('layer', (atRule) => {
    const parent = layerOf(atRule.parent as Container | undefined)
    const declared = atRule.nodes ? [atRule.params] : atRule.params.split(',')
    for (const name of declared) layers.declare([...parent, ...layerPathOf(name)])
  })

  root.walkDecls((decl: Declaration) => {
    const rule = decl.parent
    if (!rule || rule.type !== 'rule') return
    const atRules: string[] = []
    let current: Container | undefined = rule.parent as Container | undefined
    while (current && current.type !== 'root' && current.type !== 'document') {
      if (current.type === 'atrule') {
        const name = (current as AtRule).name.toLowerCase()
        if (NOT_A_CASCADE.has(name)) return
        if (name !== 'layer') atRules.unshift(`@${name} ${(current as AtRule).params}`.trim())
      }
      current = current.parent as Container | undefined
    }
    const layer = layerOf(rule)
    const index = order++
    for (const selector of (rule as postcss.Rule).selectors) {
      entries.push({
        property: decl.prop,
        selector,
        atRules,
        layer,
        important: decl.important,
        specificity: specificity(selector),
        order: index,
      })
    }
  })

  return { entries, layers }
}

/** Positive when `a` wins over `b` on an element carrying both. */
export const compareCascade = (a: CascadeEntry, b: CascadeEntry, layers: LayerOrder) => {
  if (a.important !== b.important) return a.important ? 1 : -1
  const layer = layers.compare(a.layer, b.layer)
  // Important declarations invert layer order: the earliest layer wins, and the implicit
  // final layer the unlayered rules sit in loses to every declared one.
  if (layer !== 0) return a.important ? -layer : layer
  const strength = compareSpecificity(a.specificity, b.specificity)
  if (strength !== 0) return strength
  return a.order - b.order
}

/** One line naming a declaration's place in the sheet, with nothing about which layer holds it. */
export const describeEntry = ({ atRules, selector, important }: CascadeEntry) =>
  `${atRules.length ? `${atRules.join(' ')} ` : ''}${selector}${important ? ' !important' : ''}`

/**
 * For each property, every declaration setting it, ranked weakest first.
 *
 * The layer is read, and left out of the description: it decides the order, and the order is
 * the claim. Two sheets that rank identically under this cannot disagree in a browser about
 * which declaration an element ends up with, whichever layers each wrote its rules into.
 */
export const cascadeOrder = (css: string): Record<string, string[]> => {
  const { entries, layers } = cascadeEntries(css)
  const byProperty = new Map<string, CascadeEntry[]>()
  for (const entry of entries) {
    const list = byProperty.get(entry.property) ?? []
    list.push(entry)
    byProperty.set(entry.property, list)
  }

  const result: Record<string, string[]> = {}
  for (const property of [...byProperty.keys()].sort()) {
    const ranked = byProperty.get(property)!.sort((a, b) => compareCascade(a, b, layers))
    result[property] = ranked.map(describeEntry)
  }
  return result
}
