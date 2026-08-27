import type {
  AtRuleCondition,
  ConditionDetails,
  ConditionObjectQuery,
  ConditionQuery,
  MixedCondition,
  MultiBlockCondition,
  SelectorCondition,
} from '@bamboocss/types'
import { AtRule } from 'postcss'
import { safeParse } from './safe-parse'

function parseAtRule(value: string): AtRuleCondition | undefined {
  // TODO this creates a new postcss.root for each media query !
  const result = safeParse(value)
  const rule = result.nodes[0]

  // `safeParse` answers a malformed rule with an empty root rather than throwing, and postcss
  // rejects more `@`-strings than it looks like it would -- `@`, `@;`, `@ media` and `@media {`
  // are all parse errors. Reading `.name` off the missing node turned a typo'd condition into
  // `Cannot read properties of undefined`, raised from whichever call site was unguarded.
  if (rule?.type !== 'atrule') return undefined

  const atRule = rule as AtRule
  return {
    type: 'at-rule',
    name: atRule.name,
    value: atRule.params,
    raw: value,
    params: atRule.params,
  }
}

/**
 * Parses an object condition with `@slot` markers into condition blocks.
 * Each path from root to `@slot` becomes an independent condition block.
 *
 * @example
 * ```ts
 * parseObjectCondition({
 *   "@media (hover: hover)": { "&:is(:hover, [data-hover])": "@slot" },
 *   "@media (hover: none)": { "&:is(:active, [data-active])": "@slot" },
 * })
 * ```
 */
function parseObjectCondition(obj: ConditionObjectQuery): MultiBlockCondition | MixedCondition | undefined {
  const blocks: MixedCondition[] = []

  function traverse(node: ConditionObjectQuery, path: string[]) {
    for (const [key, value] of Object.entries(node)) {
      if (value === '@slot') {
        const parts = [...path, key]
        const parsed = parseCondition(parts)
        // parseCondition wraps array input in a MixedCondition (even single-element).
        // Skip blocks where every part failed to parse (no usable conditions).
        if (parsed && parsed.type === 'mixed' && parsed.value.length > 0) {
          blocks.push(parsed)
        }
      } else if (typeof value === 'object' && value !== null) {
        traverse(value, [...path, key])
      }
      // Non-`@slot` string leaves are reported by validateConditions; ignore here.
    }
  }

  traverse(obj, [])

  if (blocks.length === 0) return undefined
  if (blocks.length === 1) return blocks[0]

  return {
    type: 'multi-block',
    value: blocks,
    raw: obj,
  } as MultiBlockCondition
}

export function parseCondition(condition: ConditionQuery): ConditionDetails | undefined {
  if (Array.isArray(condition)) {
    const value = condition.map(parseCondition).filter(Boolean) as ConditionDetails[]
    return {
      type: 'mixed',
      raw: condition,
      value,
    } as MixedCondition
  }

  // Handle object syntax with @slot markers
  if (typeof condition === 'object' && condition !== null) {
    return parseObjectCondition(condition as ConditionObjectQuery)
  }

  if (condition.startsWith('@')) {
    return parseAtRule(condition)
  }

  let type: ConditionDetails['type'] | undefined

  if (condition.startsWith('&')) {
    type = 'self-nesting'
  } else if (condition.endsWith(' &')) {
    type = 'parent-nesting'
  } else if (condition.includes('&')) {
    type = 'combinator-nesting'
  }

  if (type) {
    return { type, value: condition, raw: condition } as SelectorCondition
  }
}
