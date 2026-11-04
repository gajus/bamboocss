import { isImportant, isObject } from '@bamboocss/shared'
import type { Dict } from '@bamboocss/types'

const MERGE_OMIT = new Set(['__proto__', 'constructor', 'prototype'])

const isImportantLeaf = (value: unknown) => typeof value === 'string' && isImportant(value)

/**
 * What of `value` an unimportant value written after it cannot replace: its important leaves,
 * or `undefined` when it has none.
 */
const importantPart = (value: unknown): unknown => {
  if (!isObject(value)) return isImportantLeaf(value) ? value : undefined
  let kept: Dict | undefined
  for (const key of Object.keys(value)) {
    const part = importantPart(value[key])
    if (part !== undefined) (kept ??= {})[key] = part
  }
  return kept
}

/** A property's value under conditions, `{ base: 'red' }`, as the value it is when only `base` is left. */
const unwrapBase = (value: unknown) => {
  if (!isObject(value)) return value
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === 'base' ? value.base : value
}

const mergeInto = (target: Dict, source: Dict) => {
  for (const key of Object.keys(source)) {
    if (MERGE_OMIT.has(key)) continue
    target[key] = mergeValue(target[key], source[key])
  }
  return target
}

const mergeValue = (prev: unknown, next: unknown): unknown => {
  if (prev === undefined) return next
  if (isObject(prev) && isObject(next)) return mergeInto(mergeInto({}, prev), next)

  // `next` replaces `prev`, as `mergeProps` has it, except where `prev` is important and `next`
  // is not.
  const kept = importantPart(prev)
  if (kept === undefined) return next
  if (!isObject(kept) && !isObject(next)) return isImportantLeaf(next) ? next : kept

  // A value against a value under conditions: the value is their `base`, so `color: 'red!'` and
  // then `color: { _hover: 'blue' }` keep red as the base and add the hover.
  return unwrapBase(mergeValue(isObject(kept) ? kept : { base: kept }, isObject(next) ? next : { base: next }))
}

/**
 * `mergeProps` read the way CSS reads the declarations of one rule: a later value for a property
 * replaces an earlier one, unless the earlier is important and the later is not. The later of two
 * important values still wins.
 *
 * For the keys of one style object, where a mixin applied in place or a utility writing what
 * another key wrote is a declaration written after it. `{ color: 'red !important', mixin: 'body' }`
 * keeps red, as `color: red !important; color: …` in one rule does; `mergeProps` gave the mixin's
 * color. Composing two style objects, `css(a, b)`, is not this: the later one's value wins there.
 */
export const mergeDeclarations = (...sources: Dict[]): Dict => {
  const target: Dict = {}
  for (const source of sources) if (source) mergeInto(target, source)
  return target
}

/** `deepSet`, merging with `mergeDeclarations`, so an object set at a path is a copy as it was there. */
export const setDeclarations = (target: Dict, path: string[], value: Dict | string): Dict => {
  const isValueObject = isObject(value)
  if (!path.length && isValueObject) return mergeDeclarations(target, value)

  let current = target
  for (let i = 0; i < path.length; i++) {
    const key = path[i]!
    current[key] ||= {}
    if (i === path.length - 1) {
      current[key] =
        isValueObject && isObject(current[key])
          ? mergeDeclarations(current[key], value)
          : mergeValue(current[key], value)
    } else {
      current = current[key]
    }
  }
  return target
}
