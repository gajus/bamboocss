import selectorParser, { type Selector } from 'postcss-selector-parser'

/**
 * Selector specificity, as the browser computes it: ids, classes and elements.
 *
 * Bamboo's utility rules resolve conflicts by where they are written, and a layer's order
 * outranks specificity — so writing a rule into a cascade sublayer has to know what its
 * selector's specificity *would* have decided, and put rules of higher specificity into
 * later sublayers. That keeps every winner the single flat layer used to produce, and it is
 * what makes the sheet safe to split: two rules whose order no longer means anything are two
 * rules whose winner the layer already decided.
 */
export type Specificity = readonly [ids: number, classes: number, elements: number]

export const NO_SPECIFICITY: Specificity = [0, 0, 0]

/** Pseudo-classes whose specificity is that of their most specific argument. */
const FORGIVING = new Set([':is', ':matches', ':not', ':has', ':-webkit-any', ':-moz-any'])
/** Legacy single-colon spellings of pseudo-elements. */
const ELEMENT_PSEUDOS = new Set([':before', ':after', ':first-line', ':first-letter'])

export const compareSpecificity = (a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const add = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Specificity, factor: number): Specificity => [a[0] * factor, a[1] * factor, a[2] * factor]

interface Measured {
  /** What the selector's own compound parts count for. */
  own: Specificity
  /** How many times `&` appears: each stands for the rule the selector nests under. */
  nesting: number
}

const measure = (selector: Selector): Measured => {
  let own: Specificity = NO_SPECIFICITY
  let nesting = 0
  for (const node of selector.nodes) {
    switch (node.type) {
      case 'id':
        own = add(own, [1, 0, 0])
        break
      case 'class':
      case 'attribute':
        own = add(own, [0, 1, 0])
        break
      case 'tag':
        if (node.value !== '*') own = add(own, [0, 0, 1])
        break
      case 'nesting':
        nesting++
        break
      case 'pseudo': {
        const name = node.value.toLowerCase()
        if (name.startsWith('::') || ELEMENT_PSEUDOS.has(name)) {
          own = add(own, [0, 0, 1])
          break
        }
        if (name === ':where') break
        if (FORGIVING.has(name)) {
          let best: Measured = { own: NO_SPECIFICITY, nesting: 0 }
          for (const inner of node.nodes as Selector[]) {
            const candidate = measure(inner)
            if (compareSpecificity(candidate.own, best.own) > 0) best = candidate
          }
          own = add(own, best.own)
          nesting += best.nesting
          break
        }
        // `:nth-child(An+B of S)` would add S as well; nothing here emits that form.
        own = add(own, [0, 1, 0])
        break
      }
      default:
        // Combinators, the universal selector and comments count for nothing.
        break
    }
  }
  return { own, nesting }
}

const measured = new Map<string, Measured[]>()

/**
 * A lone class selector, escapes and all — `.c_red\\.500`, `.md\\:d_flex` — which is what the
 * base of every atom is. Answered without parsing: there is one per atom, they never repeat,
 * and a sheet of twenty thousand atoms would otherwise pay twenty thousand parses per build.
 */
const SINGLE_CLASS = /^\.(?:[^\s>+~:[\],\\]|\\.)+$/
const ONE_CLASS: Measured[] = [{ own: [0, 1, 0], nesting: 0 }]

/** Each member of a selector list, measured. Memoised, since conditions repeat across a sheet. */
const measureList = (selector: string): Measured[] => {
  if (SINGLE_CLASS.test(selector)) return ONE_CLASS
  let result = measured.get(selector)
  if (result) return result
  try {
    selectorParser((root) => {
      result = root.nodes.map(measure)
    }).processSync(selector)
  } catch {
    // A selector the parser cannot read is left as a single member of no specificity, which
    // ranks it lowest — the safe direction for a rule whose selector nothing here can judge.
    result = [{ own: NO_SPECIFICITY, nesting: 0 }]
  }
  if (measured.size > 4096) measured.clear()
  measured.set(selector, result!)
  return result!
}

/** The specificity of a selector, the most specific member of a list. */
export const selectorSpecificity = (selector: string): Specificity =>
  measureList(selector).reduce<Specificity>(
    (best, { own }) => (compareSpecificity(own, best) > 0 ? own : best),
    NO_SPECIFICITY,
  )

/**
 * The members of a selector list, each on its own.
 *
 * A rule with a list is one rule whose members do not share a specificity — `&::placeholder`
 * and `&[data-placeholder]` differ — so a sublayer keyed on specificity has to hold each
 * member separately. An unparseable selector is one member.
 */
const members = new Map<string, string[]>()

export const selectorMembers = (selector: string): string[] => {
  // No comma, no list. That is every atom's own class, and most conditions.
  if (!selector.includes(',')) return [selector]
  let result = members.get(selector)
  if (result) return result
  try {
    let parsed: string[] = []
    selectorParser((root) => {
      parsed = root.nodes.map((node) => node.toString().trim())
    }).processSync(selector)
    result = parsed.length ? parsed : [selector]
  } catch {
    result = [selector]
  }
  if (members.size > 4096) members.clear()
  members.set(selector, result)
  return result
}

/**
 * The specificity a rule has once `condition` is nested under a rule of `parent` specificity.
 *
 * Nesting resolves `&` to the parent selector, so the parent counts once per `&` — twice for
 * `& + &` — and the condition's own parts add to it. A condition without `&` is a descendant
 * of the parent and adds to it just the same.
 */
export const nestedSpecificity = (parent: Specificity, condition: string): Specificity => {
  const [member] = measureList(condition)
  const { own, nesting } = member!
  return add(scale(parent, Math.max(1, nesting)), own)
}
