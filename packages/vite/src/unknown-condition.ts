import type { Context } from '@bamboocss/core'
import { closestMatch } from '@bamboocss/shared'
import { UnwritableStyleError } from './unwritable-style'

/**
 * A key nested in a style object that is neither a property nor a condition.
 *
 * Each leaf of a style object is one declaration: one key on its path names the property, and
 * every other key a condition it applies under. A second key that is not a condition — `_hovr`, a
 * selector written without `&` — leaves the declaration with no rule anywhere. The class named for
 * it keeps the key, `_hovr:c_red.300`, while the stylesheet drops the key and writes the
 * declaration with no condition at all, so the two never meet: the element is unstyled, and
 * nothing says so.
 *
 * Thrown while a class is named, by the build's copy of the runtime; the fold reports it by the
 * call the style is written in. The message is the whole report.
 */
export class UnknownConditionError extends UnwritableStyleError {
  readonly reason = 'unknown-condition'

  constructor(
    readonly key: string,
    readonly suggestion: string | undefined,
  ) {
    super(
      suggestion
        ? `\`${key}\` is not a condition; did you mean \`${suggestion}\`?`
        : `\`${key}\` is neither a condition nor a selector written with \`&\``,
    )
    this.name = 'UnknownConditionError'
  }
}

/** CSS functions a selector is written in, which read as a key when `&:` is left off. */
const SELECTOR_FUNCTIONS = new Set(['has', 'is', 'not', 'where'])

/** What `& ${key}` makes a selector of: an element, a class, an id, an attribute or a combinator. */
const SELECTOR = /^(?:[a-z][a-z0-9-]*|[.#[>+~*].*)$/

/** A key as it is written in source: bare when it is an identifier, quoted when it is not. */
const asKey = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key.replaceAll("'", "\\'")}'`)

/**
 * What `key` was probably meant to be, written as it would be in source.
 *
 * `next` is the key nested under it, which is what a selector function such as `has` was meant to
 * take: `has: { svg: … }` is `'&:has(svg)'`.
 */
const suggest = (ctx: Context, key: string, next: string | undefined) => {
  const { conditions } = ctx
  if (!key.startsWith('_') && conditions.has(`_${key}`)) return `_${key}`
  if (key.startsWith(':')) return asKey(`&${key}`)
  if (SELECTOR_FUNCTIONS.has(key)) {
    const argument = next !== undefined && !conditions.isCondition(next) && !ctx.isValidProperty(next) ? next : '…'
    return asKey(`&:${key}(${argument})`)
  }
  // A tie goes to the condition declared first.
  const nearest = closestMatch(key, conditions.keys())
  if (nearest) return asKey(nearest)
  if (SELECTOR.test(key) && !ctx.isValidProperty(key)) return asKey(`& ${key}`)
  return undefined
}

/**
 * Refuse a declaration path with a key that is neither its property nor a condition.
 *
 * Given the path the runtime's `shift` is about to order, before it is ordered. `shift` moves every
 * key that is not a condition to the front and takes the first as the property, so with two of
 * them, which one becomes the property is down to the sort, and the other is kept as a condition
 * the stylesheet does not know.
 */
export const createConditionCheck = (ctx: Context) => {
  const { isCondition } = ctx.conditions

  return (paths: string[]) => {
    // A path of one key is a property alone, which is most of them.
    if (paths.length < 2) return

    let outside: string[] | undefined
    for (const path of paths) {
      const key = path.trim()
      if (!isCondition(key)) (outside ??= []).push(key)
    }
    if (!outside || outside.length < 2) return

    // Of the keys that are not conditions, the property is the innermost one the utility knows,
    // or failing that the innermost. The outermost of the others is the one to name: everything
    // under it is lost.
    let property = outside.length - 1
    for (let index = outside.length - 1; index >= 0; index--) {
      if (ctx.isValidProperty(outside[index]!)) {
        property = index
        break
      }
    }
    const key = outside[property === 0 ? 1 : 0]!
    const keys = paths.map((path) => path.trim())
    throw new UnknownConditionError(key, suggest(ctx, key, keys[keys.indexOf(key) + 1]))
  }
}
