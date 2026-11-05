import type { ConditionDetails } from './conditions'

export interface StyleResultObject {
  [key: string]: any
}
export interface StyleProps extends StyleResultObject {
  css?: StyleResultObject
}

export interface StyleEntry {
  prop: string
  value: string | number | boolean
  cond: string
  recipe?: string
  slot?: string
  layer?: string
  variants?: boolean
}

export interface AtomicStyleResult {
  result: StyleResultObject
  entry: StyleEntry
  hash: string
  className: string
  conditions?: ConditionDetails[]
  layer?: string
  /**
   * The rule selects through a `@scope` prelude rather than on `className`.
   *
   * A non-root slot's variant styles are reached from the class the *root* carries, so this
   * result's own class names nothing. It still identifies the rule for bookkeeping, but
   * reporting it would put a class on the element that no rule ever matches.
   */
  scoped?: boolean
  /**
   * The conditions the utility's transform wrote in its styles: each path those styles were
   * written at, its keys joined by `\0`, and each condition by the text written for it. The sheet
   * ranks what is under one as written under that condition.
   */
  transformConditions?: {
    at: ReadonlySet<string>
    written: ReadonlyMap<string, ConditionDetails>
  }
}

export interface GroupedResult extends Pick<AtomicStyleResult, 'result' | 'className'> {
  hashSet: Set<string>
  details: GroupedStyleResultDetails[]
}

export interface RecipeBaseResult extends GroupedResult {
  recipe: string
  slot?: string
}

export interface GroupedStyleResultDetails extends Pick<AtomicStyleResult, 'hash' | 'entry' | 'conditions'> {
  result: StyleResultObject
}

export interface KeyframesResult {
  /** What the `keyframes()` call returns, and the name of the block. */
  name: string
  /** Stop -> authored style object, serialized whole at emit as a theme keyframe is. */
  stops: StyleResultObject
}

export interface ViewTransitionResult {
  className: string
  /**
   * Selector -> authored style object, the shape `globalCss` takes.
   *
   * Unlike every other result here this is *not* transformed yet: the bodies target
   * `::view-transition-*` pseudo-elements, so they are serialized whole at emit rather
   * than atomized into classes.
   */
  styles: StyleResultObject
}
