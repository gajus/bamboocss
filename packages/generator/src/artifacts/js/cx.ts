import type { Context } from '@bamboocss/core'
import outdent from 'outdent'

/**
 * `cx` joins class names and merges them: of the classes that set one property under the same
 * conditions, it keeps the last.
 *
 * It once merged by reading the property off a readable class name — atomic mode with
 * `hash.className` off. That made it a correctness tool in development and a plain join in a
 * hashed production build, from the same source, with no error either way: an override that
 * worked locally silently stopped working when it shipped, and the merge was removed. A hashed
 * name was an opaque digest with no property to compare.
 *
 * A utility class's name now carries what the merge reads in every build, hashed or not: `_`, six
 * characters coding the property and conditions, `:`, then the value. So development and
 * production merge alike. @see mergeableAtomName
 *
 * The compiler still merges every Bamboo style a `cx()` call holds before a class exists, later
 * arguments winning. What reaches the runtime `cx` is what it could not see — a class passed in,
 * or one assembled at runtime.
 */
const declaration = outdent`
   type Argument = string | boolean | null | undefined | Argument[]

   /**
    * Join classNames into a single string, keeping the last of the classes that set one property
    * under the same conditions.
    *
    * \`cx(css({ paddingX: '4' }), props.className)\` keeps the caller's \`paddingX\` wherever it
    * passes one, as \`css(a, b)\` keeps the later declaration — at any depth, since a wrapper's own
    * \`cx\` has already merged what it hands down. Any other class, a recipe's own or one written by
    * hand, is kept as written.
    */
   export declare function cx(...args: Argument[]): string

   /**
    * Select a complete build-precompiled recipe StyleSet from a reduced decision table.
    * Written by the source transform, not by hand.
    */
   export declare function cvaMap(
     values: unknown[],
     nodes: Array<[unknown, unknown, unknown[]]>,
     leaves: unknown[],
     root: number,
   ): unknown

   /**
    * Split a props object into the listed keys and everything else.
    *
    * Re-exported here so the build has one module to reach for when it lowers a recipe: this
    * is what \`recipe.splitVariantProps\` calls, so a lowered call is the same function reached
    * directly rather than through the recipe object — which is what lets the recipe's config
    * leave the bundle.
    */
   export declare function splitProps<T extends Record<string, unknown>, K extends Array<keyof T>>(
     props: T,
     ...keys: K
   ): [Record<string, unknown>, Record<string, unknown>]
  `

/**
 * The `cx` every build emits: the join, keeping the last class per property and conditions.
 * @see mergeableAtomName
 *
 * Every class a build hands out is a compiled literal, so the joins a page asks for are few and
 * repeat render after render; each is merged once and looked up after that, which is what keeps a
 * merging `cx` as cheap as the join it replaces. The bound is for classes assembled at runtime.
 */
const cxFunction = (prefix: string) => outdent`
  // Where a class's name starts past the \`prefix\`, which every class this build names carries.
  const cxPrefix = ${JSON.stringify(prefix ? `${prefix}-` : '')}

  // The merge key a utility atom's name carries — the six characters between its \`_\` and its
  // \`:\`, hashed or readable — or \`undefined\` for a class that is not one, which is kept as
  // written. The colon is what tells an atom from a class written by hand that starts with \`_\`.
  function cxKey(token) {
    let start = 0
    if (cxPrefix) {
      if (!token.startsWith(cxPrefix)) return undefined
      start = cxPrefix.length
    }
    if (token.charCodeAt(start) !== 95 || token.charCodeAt(start + 7) !== 58) return undefined
    return token.slice(start + 1, start + 7)
  }

  // Adds each class of \`str\` to \`tokens\`, the last of each key in the place its first stood, so an
  // override lands where the class it replaces sat. One that is not an atom is kept as written,
  // duplicates and all. A few classes per element, so the keys are searched in order, not hashed.
  function cxParse(str, tokens, keys) {
    let start = 0
    for (let i = 0; i <= str.length; i++) {
      const code = i < str.length ? str.charCodeAt(i) : 32
      // The class attribute splits on all ASCII whitespace, and a template literal spans lines.
      if (code !== 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) continue
      if (i > start) {
        const token = str.slice(start, i)
        const key = cxKey(token)
        let slot = -1
        if (key !== undefined) {
          for (let j = 0; j < keys.length; j++) {
            if (keys[j] === key) {
              slot = j
              break
            }
          }
        }
        if (slot === -1) {
          tokens.push(token)
          keys.push(key)
        } else {
          tokens[slot] = token
        }
      }
      start = i + 1
    }
  }

  // Per class string a component joins onto: its classes parsed once, and every join merged with
  // it, so a miss parses only what was passed in.
  const cxSeen = new Map()
  let cxEntries = 0

  function cxCached(a, b) {
    let seen = cxSeen.get(a)
    let merged = seen === undefined ? undefined : seen.joined.get(b)
    if (merged !== undefined) return merged
    if (cxEntries >= 4096) {
      cxSeen.clear()
      cxEntries = 0
      seen = undefined
    }
    if (seen === undefined) {
      seen = { tokens: [], keys: [], joined: new Map() }
      cxParse(a, seen.tokens, seen.keys)
      cxSeen.set(a, seen)
    }
    const tokens = seen.tokens.slice()
    cxParse(b, tokens, seen.keys.slice())
    merged = tokens.join(' ')
    seen.joined.set(b, merged)
    cxEntries++
    return merged
  }

  function cx(a, b) {
    const n = arguments.length

    // \`cx(<compiled class literal>, className)\` is what the transform emits at nearly every
    // call site it cannot fold, so it is the shape that actually runs per render — a wrapper
    // forwarding a className down. \`b\` covers the whole non-string tail \`cx\` ignores
    // (null/undefined/booleans), which is the \`cond && cls\` idiom when the condition is false.
    if (n === 2 && typeof a === 'string') {
      if (typeof b === 'string') return a ? (b ? cxCached(a, b) : a) : b
      if (b == null || b === false || b === true) return a
    }

    let str = ''
    let parts = 0
    // \`arguments\` rather than a rest parameter, as in the join: one pass, no array.
    for (let i = 0; i < n; i++) {
      const arg = arguments[i]
      if (!arg) continue
      const part = Array.isArray(arg) ? cx(...arg) : typeof arg === 'string' ? arg : ''
      if (!part) continue
      str && (str += ' ')
      str += part
      parts++
    }
    // A single part is returned as it came: a compiled class string holds one class per key, and
    // another \`cx\`'s result is merged already. One joined by hand, a template literal or a
    // \`join\`, is not, and \`no-unlayered-override\` reports the join. Two or more meet here.
    return parts > 1 ? cxCached(str, '') : str
  }
`
export function generateCx(ctx: Context) {
  return {
    js: outdent`
  ${ctx.file.import('splitProps', '../helpers')}

  ${cxFunction(ctx.utility.prefix)}

  // Each node is [miss, undefined, [key, child, key, child, ...]]. Children are either
  // another non-negative node index or a negative leaf reference. Arrays avoid object-literal
  // \`__proto__\` semantics, while string coercion matches a recipe's property lookup.
  const cvaMap = (values, nodes, leaves, root) => {
    let current = root
    for (let i = 0; i < values.length && current >= 0; i++) {
      const node = nodes[current]
      if (!node) return ''

      const value = values[i]
      if (value === undefined) {
        current = node[1]
        continue
      }
      if (value === null) {
        current = node[0]
        continue
      }

      const key = String(value)
      const entries = node[2]
      let next = node[0]
      for (let j = 0; j < entries.length; j += 2) {
        if (entries[j] !== key) continue
        next = entries[j + 1]
        break
      }
      current = next
    }
    return current < 0 ? (leaves[~current] ?? '') : ''
  }

  export { cx, cvaMap, splitProps }
`,
    dts: declaration,
  }
}
