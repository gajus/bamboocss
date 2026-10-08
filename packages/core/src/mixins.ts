import { flatten, isObject, mergeProps, normalizeStyleObject } from '@bamboocss/shared'
import type { Dict, Theme } from '@bamboocss/types'
import type { Utility } from './utility'

const MIXIN = 'mixin'

interface MixinsOptions {
  mixins: Theme['mixins']
  utility: Utility
}

/**
 * The theme's mixins, and what applying one means beside other declarations.
 *
 * Applied alone, a mixin is one class in the `compositions` layer, below every other utility.
 * That says the right thing while nothing else on the element sets what the mixin sets.
 * Composed with something that does, it has to mean what writing its declarations in its place
 * means: a later key wins over it, it wins over an earlier one, and its own conditions rank as
 * conditions do. A class in the lowest layer can mean none of that — every utility beat it, so a
 * recipe variant's mixin lost to the base and a mixin's `_hover` lost to any `color`.
 *
 * `expand` is the written-out form: the style object with each `mixin` replaced by the
 * declarations it names, merged in key order the way `css(a, b)` merges its arguments.
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

  /** `style` with every mixin written out where it stands, or `style` itself if it applies none. */
  expand = (style: Dict): Dict => (this.has(style) ? this.expandWith(style, new Set()) : style)

  private expandWith = (style: Dict, applying: ReadonlySet<string>): Dict => {
    const pieces: Dict[] = []
    let run: Dict = {}
    for (const key in style) {
      const value = style[key]
      if (key === MIXIN && value != null) {
        if (Object.keys(run).length) pieces.push(run)
        run = {}
        pieces.push(this.apply(value, applying))
        continue
      }
      run[key] = isObject(value) && this.has(value) ? this.expandWith(value, applying) : value
    }
    if (Object.keys(run).length) pieces.push(run)
    return this.merge(pieces)
  }

  /** One `mixin` value: a name, or names chosen per condition — `{ base: 'body', md: 'lead' }`. */
  private apply = (value: unknown, applying: ReadonlySet<string>): Dict => {
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
    return mergeProps(...pieces.map((piece) => normalizeStyleObject(piece, this.options)))
  }
}
