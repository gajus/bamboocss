import type { AtomicStyleResult, ConditionDetails, SelectorCondition } from '@bamboocss/types'
import { sortAtRules } from './sort-at-rules'
import { pushAll } from './push-all'
import { getPropertyPriority } from '@bamboocss/shared'

const hasAtRule = (conditions: ConditionDetails[]) =>
  conditions.some((details) => details.type === 'at-rule' || details.type === 'mixed' || details.type === 'multi-block')

/**
 * The states that order rules, weakest first. Of two rules equal in specificity, the one
 * requiring a later state comes later and wins while both match: `_active` over `_hover`.
 */
const STATE_RANKS = new Map([
  ['link', 1],
  ['visited', 2],
  ['focus-within', 3],
  ['focus', 4],
  ['focus-visible', 5],
  ['hover', 6],
  ['active', 7],
])

/**
 * Pseudo-classes whose argument is selectors the element itself matches, so their states are
 * its own: `&:is(:hover, [data-hover])` requires hover. The argument of `:has()` describes other
 * elements and that of `:nth-child(… of S)` filters what is counted, so neither is read.
 */
const STATES_OF_ARGUMENT = new Set([
  'is',
  'where',
  'not',
  'matches',
  'any',
  '-webkit-any',
  '-moz-any',
  'host',
  'host-context',
])

const BACKSLASH = 0x5c
const COLON = 0x3a
const COMMA = 0x2c
const OPEN_PAREN = 0x28
const CLOSE_PAREN = 0x29
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d
const QUOTE = 0x22
const APOSTROPHE = 0x27

type States = readonly number[]

const NO_STATES: States = Object.freeze([])

/**
 * Which of two sets of states orders later: the one whose strongest state is stronger, then
 * its next, and failing those the one requiring more. Each set is strongest first.
 */
const compareStates = (a: States, b: States) => {
  const shared = Math.min(a.length, b.length)
  for (let index = 0; index < shared; index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!
  }
  return a.length - b.length
}

const strongestFirst = (a: number, b: number) => b - a

/** Past the string opening at `at`: its closing quote, or `end` if it has none. */
const skipString = (text: string, at: number, end: number) => {
  const quote = text.charCodeAt(at)
  let index = at + 1
  while (index < end) {
    const code = text.charCodeAt(index)
    if (code === BACKSLASH) index += 2
    else if (code === quote) return index + 1
    else index++
  }
  return end
}

/** Where the bracket or parenthesis opening at `at` closes, or `end` if it does not. */
const closingOf = (text: string, at: number, end: number) => {
  const open = text.charCodeAt(at)
  const close = open === OPEN_PAREN ? CLOSE_PAREN : CLOSE_BRACKET
  let depth = 0
  let index = at
  while (index < end) {
    const code = text.charCodeAt(index)
    if (code === BACKSLASH) {
      index += 2
      continue
    }
    if (code === QUOTE || code === APOSTROPHE) {
      index = skipString(text, index, end)
      continue
    }
    if (code === open) depth++
    else if (code === close && --depth === 0) return index
    index++
  }
  return end
}

/** Past the name starting at `at`, escapes included: `hover`, `-webkit-any`. */
const nameEnd = (text: string, at: number, end: number) => {
  let index = at
  while (index < end) {
    const code = text.charCodeAt(index)
    if (code === BACKSLASH) index += 2
    else if (
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2d ||
      code === 0x5f ||
      code >= 0x80
    )
      index++
    else break
  }
  return Math.min(index, end)
}

/**
 * The states the selector list in `text` from `start` to `end` requires, strongest first: those
 * of its strongest member, as that is the one the rule has to be ordered for. `&:is(:focus,
 * :active)` ranks as active. Within one member every state counts, on the element and on its
 * ancestors alike, so `.group:hover &` ranks as hover.
 *
 * Read by name, not found as text: `:focus-visible` is not `:focus`, and neither `.a\:hover` nor
 * `[data-x=":hover"]` holds a state.
 */
const readStates = (text: string, start: number, end: number): States => {
  let strongest = NO_STATES
  let member: number[] = []

  const closeMember = () => {
    member.sort(strongestFirst)
    if (compareStates(member, strongest) > 0) strongest = member
    member = []
  }

  let index = start
  while (index < end) {
    const code = text.charCodeAt(index)
    if (code === BACKSLASH) {
      index += 2
      continue
    }
    if (code === QUOTE || code === APOSTROPHE) {
      index = skipString(text, index, end)
      continue
    }
    if (code === OPEN_BRACKET || code === OPEN_PAREN) {
      index = closingOf(text, index, end) + 1
      continue
    }
    if (code === COMMA) {
      closeMember()
      index++
      continue
    }
    if (code !== COLON) {
      index++
      continue
    }

    const element = text.charCodeAt(index + 1) === COLON
    const from = index + (element ? 2 : 1)
    index = nameEnd(text, from, end)
    const name = text.slice(from, index).toLowerCase()

    if (text.charCodeAt(index) === OPEN_PAREN) {
      const close = closingOf(text, index, end)
      // `::slotted()` takes the slotted element's selector, whose states are that element's own.
      if (element ? name === 'slotted' : STATES_OF_ARGUMENT.has(name)) {
        for (const rank of readStates(text, index + 1, close)) member.push(rank)
      }
      index = close + 1
      continue
    }

    const rank = element ? undefined : STATE_RANKS.get(name)
    if (rank !== undefined) member.push(rank)
  }

  closeMember()
  return strongest
}

/**
 * The states a condition's selector requires, strongest first.
 *
 * Reading the selector is cheap once, but this sits inside a comparator, so it runs on the
 * order of N log N times over a set of selectors that is small and repeats. Pure in its
 * argument, so caching it leaves every comparison's result unchanged.
 */
const statesCache = new Map<string, States>()

const selectorStates = (selector: string): States => {
  let states = statesCache.get(selector)
  if (states === undefined) {
    states = readStates(selector, 0, selector.length)
    if (statesCache.size > 4096) statesCache.clear()
    statesCache.set(selector, states)
  }
  return states
}

/**
 * The states a stack of selector conditions requires together, strongest first. A rule under
 * `_hover: { _active }` requires hover and active, and orders by both: after one under
 * `_hover: { _focus }`, as `_active` alone orders after `_focus`.
 */
const stackStates = (selectors: readonly SelectorCondition[]): States => {
  if (selectors.length === 1) return selectorStates(selectors[0]!.value)
  const states: number[] = []
  for (const selector of selectors) {
    for (const rank of selectorStates(selector.value)) states.push(rank)
  }
  return states.sort(strongestFirst)
}

const compareSelectors = (a: WithConditions, b: WithConditions) => {
  const aConds = a.conditions! as SelectorCondition[]
  const bConds = b.conditions! as SelectorCondition[]

  if (aConds.length === bConds.length) return compareStates(stackStates(aConds), stackStates(bConds))

  return aConds.length - bConds.length
}

/**
 * Flatten mixed conditions to Array<AtRuleCondition | SelectorCondition>
 */
const flatten = (conds: ConditionDetails[]) =>
  conds.flatMap((cond) => {
    if (cond.type === 'mixed') return cond.value
    if (cond.type === 'multi-block') return cond.value.flatMap((block) => block.value)
    return cond
  })

/**
 * Compare 2 Array<AtRuleCondition | SelectorCondition> by all but their selectors' states
 * - sort by condition length (shorter first)
 * - sort at-rules by predefined order (sort-mq postcss plugin order)
 *
 * do this for item in the array against the same index in the other array
 * -> exit early if not equal
 * -> if every position agrees: 0 when none holds a selector, otherwise `undefined`, and the
 *    selectors are compared by the states they require together
 */
const compareStructure = (aConds: Array<ConditionDetails>, bConds: Array<ConditionDetails>): number | undefined => {
  let aCond, bCond
  let selectors = false
  const max = Math.max(aConds.length, bConds.length)

  for (let i = 0; i < max; i++) {
    aCond = aConds[i]
    bCond = bConds[i]

    // More nesting should be ranked higher
    // a: [':hover', ':focus'] / b: [':hover'] => a is ranked higher
    if (!aCond) return -1
    if (!bCond) return 1

    // a is at-rule and b is not, a is ranked higher
    // a: ['@media (min-width: 768px)'] b: [':hover', ':focus'] => a is ranked higher
    if (aCond.type === 'at-rule' && bCond.type.includes('nesting')) {
      return 1
    }

    // a is not at-rule and b is, a is ranked lower
    // a: [':hover', ':focus'] b: ['@media (min-width: 768px)'] => a is ranked lower
    if (aCond.type.includes('nesting') && bCond.type === 'at-rule') {
      return -1
    }

    // a & b are at-rules
    // sort by predefined order, return difference if not equal
    // otherwise, keep comparing
    // a: ['@media (min-width: 1024px)'] b: ['@media (min-width: 768px)'] => a is ranked higher
    if (aCond.type === 'at-rule' && bCond.type === 'at-rule') {
      const atRule1 = aCond.params ?? aCond.raw
      const atRule2 = bCond.params ?? bCond.raw

      // A parameterless at-rule — `@starting-style` — sorts before one with params, and two of
      // them are equal. Returning -1 for both orders made the comparator disagree with itself,
      // so which rule came first depended on which was encountered first.
      if (!atRule1 && !atRule2) continue
      if (!atRule1) return -1
      if (!atRule2) return 1

      const score = sortAtRules(atRule1, atRule2)

      if (score !== 0) {
        return score
      }

      continue
    }

    // a & b are selectors: compared once every position agrees, as a whole. Compared one
    // position at a time, the order they were nested in decided:
    // ['@media …', '.dark &', '&:hover'] lost to ['@media …', '&:focus', '.dark &'].
    selectors = true
  }

  return selectors ? undefined : 0
}

const compareFlattened = (aConds: Array<ConditionDetails>, bConds: Array<ConditionDetails>) =>
  compareStructure(aConds, bConds) ?? compareStates(flattenedStates(aConds), flattenedStates(bConds))

/** The states the selectors among flattened conditions require together, strongest first. */
const flattenedStates = (conds: Array<ConditionDetails>): States => {
  let only: SelectorCondition | undefined
  let selectors: SelectorCondition[] | undefined
  for (const cond of conds) {
    if (!cond.type.includes('nesting')) continue
    if (!only) only = cond as SelectorCondition
    else (selectors ??= [only]).push(cond as SelectorCondition)
  }
  if (selectors) return stackStates(selectors)
  return only ? selectorStates(only.value) : NO_STATES
}

/**
 * Flattens both operands, then compares.
 *
 * `sortStyleRules` does not go through here — it flattens each rule once up front and compares
 * the results directly, because a comparator runs on the order of N log N times and flattening
 * inside it allocated two arrays per comparison. This spelling stays for callers that hold one
 * pair and have nothing to hoist the work out of.
 */
export const compareAtRuleOrMixed = (a: WithConditions, b: WithConditions) =>
  compareFlattened(flatten(a.conditions!) as Array<ConditionDetails>, flatten(b.conditions!) as Array<ConditionDetails>)

export interface WithConditions extends Pick<AtomicStyleResult, 'conditions' | 'entry'> {}

/** Which of the three blocks below a rule's conditions put it in: none, selectors only, at-rules. */
const conditionGroup = (conditions: ConditionDetails[] | undefined) =>
  !conditions?.length ? 0 : hasAtRule(conditions) ? 2 : 1

/**
 * The order `sortStyleRules` puts two rules in by their conditions alone — the three blocks,
 * then the comparison each block sorts by — with property priority left out.
 *
 * Exported for the cascade sublayers, which have to reproduce this order between sublayers so
 * that two rules of equal specificity keep the winner the flat layer's source order gave them.
 */
export const compareConditionOrder = (a: ConditionDetails[] | undefined, b: ConditionDetails[] | undefined): number => {
  const group = conditionGroup(a) - conditionGroup(b)
  if (group !== 0) return group
  switch (conditionGroup(a)) {
    case 0:
      return 0
    case 1:
      return compareSelectors({ conditions: a } as WithConditions, { conditions: b } as WithConditions)
    default:
      return compareFlattened(flatten(a!) as Array<ConditionDetails>, flatten(b!) as Array<ConditionDetails>)
  }
}

const sortByPropertyPriority = (a: WithConditions, b: WithConditions) => {
  if (a.entry.prop === b.entry.prop) return 0
  return getPropertyPriority(a.entry.prop) - getPropertyPriority(b.entry.prop)
}

/**
 * Sort style rules by conditions
 * - with no conditions first
 * - with selectors only next
 * - with at-rules last
 *
 * for each of them:
 * - sort by condition length (shorter first, the more you nest the more specific it is)
 * - sort selectors by the states they require (`STATE_RANKS`)
 * - sort at-rules by predefined order (sort-mq postcss plugin order)
 * - sort by property priority (longhands first)
 */

export const sortStyleRules = <T extends WithConditions>(styleRules: Array<T>): T[] => {
  const declarations: T[] = []
  const withSelectorsOnly: T[] = []
  const withAtRules: T[] = []

  for (const styleRule of styleRules) {
    if (!styleRule.conditions?.length) {
      declarations.push(styleRule)
    } else if (!hasAtRule(styleRule.conditions)) {
      withSelectorsOnly.push(styleRule)
    } else {
      withAtRules.push(styleRule)
    }
  }

  // Each rule's states are read once, not twice per comparison: a stack's are gathered and
  // sorted, which allocates, and a comparison sort asks on the order of N log N times. The
  // comparator is `compareSelectors` over what it would have read for itself.
  const selectorRules = withSelectorsOnly.map((rule) => ({
    rule,
    depth: rule.conditions!.length,
    states: stackStates(rule.conditions as SelectorCondition[]),
  }))

  selectorRules.sort((a, b) => {
    const selectorDiff = a.depth - b.depth || compareStates(a.states, b.states)
    if (selectorDiff !== 0) return selectorDiff

    return sortByPropertyPriority(a.rule, b.rule)
  })

  for (let i = 0; i < selectorRules.length; i++) withSelectorsOnly[i] = selectorRules[i]!.rule

  // Flattened once per rule instead of twice per comparison, and its states read at most once,
  // for the same reason. `flatten` allocates — around thirteen flattens per rule at the sizes a
  // staticCss build reaches, against one here. Most of these rules hold no selector, so their
  // states are only read once a comparison reaches them. The comparator is `compareFlattened`.
  const decorated = withAtRules.map((rule) => ({
    rule,
    conds: flatten(rule.conditions!) as Array<ConditionDetails>,
    states: undefined as States | undefined,
  }))

  decorated.sort((a, b) => {
    const conditionDiff =
      compareStructure(a.conds, b.conds) ??
      compareStates((a.states ??= flattenedStates(a.conds)), (b.states ??= flattenedStates(b.conds)))
    if (conditionDiff !== 0) return conditionDiff

    return sortByPropertyPriority(a.rule, b.rule)
  })

  for (let i = 0; i < decorated.length; i++) withAtRules[i] = decorated[i].rule

  const sorted = declarations.sort(sortByPropertyPriority)

  // Appended rather than spread: this runs on every build, over every rule in the stylesheet,
  // and gets several times more elements than any other site that does this.
  pushAll(sorted, withSelectorsOnly)
  pushAll(sorted, withAtRules)

  return sorted
}
