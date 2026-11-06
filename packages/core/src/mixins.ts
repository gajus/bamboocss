import { flatten, isObject, mergeDeclarations, normalizeStyleObject } from '@bamboocss/shared'
import type { Dict, Theme } from '@bamboocss/types'
import type { Utility } from './utility'

const MIXIN = 'mixin'

interface MixinsOptions {
  mixins: Theme['mixins']
  utility: Utility
}

/** Whether a `mixin` value lists mixins anywhere: `['body', 'muted']`, or a list chosen per condition. */
const lists = (value: unknown): boolean => {
  if (Array.isArray(value)) return true
  if (!isObject(value)) return false
  for (const key in value) if (lists(value[key])) return true
  return false
}

/**
 * The theme's mixins, and what applying one beside other declarations means.
 *
 * A mixin is the base of the style object it is applied in: its declarations come first and the
 * object's own after them, wherever the `mixin` key is written. A property beside a mixin is there
 * to adjust it, and that has to hold where keys are sorted, which puts `mixin` among them by its
 * name: while its place decided, every property sorted before it that the mixin set too did
 * nothing. Several apply in the order listed, `mixin: ['body', 'muted']`, a later one over an
 * earlier one. Its conditions, its own and those it is applied under, rank as conditions do over
 * the element's base state, a selector's specificity ranks it over the selected element's own
 * utilities, and a longhand it sets outranks a shorthand as any longhand does.
 *
 * Its own class, `mixin_*`, sits in the `compositions` layer, below every other utility, and can
 * mean none of that — every utility beat it, so a recipe variant's mixin lost to the base, a mixin's
 * `_hover` lost to any `color`, and its `'& input'` to the input's own `fontSize`. So whatever turns
 * a style into declarations writes its mixins out: the compiler wherever one is applied, alone too,
 * and `global.css` and a recipe's own classes in their rules. The class is what `staticCss` and the
 * rule processor name.
 *
 * `expand` is the written-out form: the style object with each `mixin` replaced by the
 * declarations it names, followed by the object's own, merged the way `css(a, b)` merges its
 * arguments — except that, being declarations of one object, an important one is not replaced by a
 * later one that is not: a mixin writing `color: 'gray !important'` keeps gray against the object's
 * `color: 'red'`. @see mergeDeclarations
 */
export class Mixins {
  private definitions: Record<string, Dict>

  constructor(private options: MixinsOptions) {
    this.definitions = flatten((options.mixins ?? {}) as Record<string, Dict>)
  }

  /** Whether `style` applies a mixin anywhere, under conditions and selectors included. */
  has = (style: unknown): boolean => {
    if (!isObject(style)) return false
    for (const key in style) {
      const value = style[key]
      if (value == null) continue
      if (key === MIXIN || this.has(value)) return true
    }
    return false
  }

  /** `style` with every mixin written out, or `style` itself if it applies none. */
  expand = (style: Dict): Dict => (this.has(style) ? this.expandWith(style, new Set()) : style)

  /**
   * `style` as written, less each `mixin` that lists mixins, or `style` itself if none does.
   *
   * A list has no class to stand for it, `mixin_*` naming one mixin, so it is only ever written
   * out; this is what is left to name as written.
   */
  asWritten = (style: Dict): Dict => (this.listsIn(style) ? this.withoutLists(style) : style)

  private listsIn = (style: Dict): boolean => {
    for (const key in style) {
      const value = style[key]
      if (key === MIXIN ? lists(value) : isObject(value) && this.listsIn(value)) return true
    }
    return false
  }

  private withoutLists = (style: Dict): Dict => {
    const result: Dict = {}
    for (const key in style) {
      const value = style[key]
      if (key === MIXIN && lists(value)) continue
      result[key] = isObject(value) && this.listsIn(value) ? this.withoutLists(value) : value
    }
    return result
  }

  private expandWith = (style: Dict, applying: ReadonlySet<string>): Dict => {
    let applied: Dict | undefined
    const own: Dict = {}
    for (const key in style) {
      const value = style[key]
      if (key === MIXIN) {
        if (value != null) applied = this.apply(value, applying)
        continue
      }
      own[key] = isObject(value) && this.has(value) ? this.expandWith(value, applying) : value
    }
    if (!applied) return own
    return Object.keys(own).length ? this.merge([applied, own]) : applied
  }

  /**
   * One `mixin` value: a name, names applied in order — `['body', 'muted']` — or either chosen per
   * condition, `{ base: 'body', md: ['lead', 'muted'] }`.
   */
  private apply = (value: unknown, applying: ReadonlySet<string>): Dict => {
    if (Array.isArray(value)) {
      const pieces: Dict[] = []
      for (const name of value) if (name != null) pieces.push(this.apply(name, applying))
      return this.merge(pieces)
    }
    if (isObject(value)) {
      const pieces: Dict[] = []
      for (const condition in value) {
        const inner = value[condition]
        if (inner == null) continue
        const applied = this.apply(inner, applying)
        pieces.push(condition === 'base' ? applied : { [condition]: applied })
      }
      return this.merge(pieces)
    }
    const name = String(value)
    const definition = this.definitions[name]
    // Unknown, or applying itself: left as written, for the encoder to report as it always has.
    if (!definition || applying.has(name)) return { [MIXIN]: value }
    return this.expandWith(definition, new Set(applying).add(name))
  }

  private merge = (pieces: Dict[]): Dict => {
    if (pieces.length === 1) return pieces[0]!
    return mergeDeclarations(...pieces.map((piece) => normalizeStyleObject(piece, this.options)))
  }
}
