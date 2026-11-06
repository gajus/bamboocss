import type { Context } from '@bamboocss/core'
import outdent from 'outdent'

/**
 * `cx` joins class names. It does not resolve conflicts between them, in any build.
 *
 * It used to, when the class names happened to carry a property to compare — atomic mode
 * with `hash.className` off. That made it a correctness tool in development and a plain
 * join in a hashed production build, from the same source, with no error either way. An
 * override that worked locally silently stopped working when it shipped.
 *
 * The two could not be reconciled by teaching the matcher to read hashed names: under
 * `hash: true` a class is an opaque digest with no property to compare.
 *
 * So precedence is decided where it can be decided the same way everywhere: by the compiler,
 * which merges every Bamboo style a `cx()` call holds before a class exists, later arguments
 * winning. What reaches this join at runtime is only what the compiler could not see — a class
 * passed in, or one assembled at runtime — and no
 * {@link https://bamboocss.com/docs/concepts/cascade-layers cascade layer} ranks it above the
 * styles it is joined with: recipes compile to the same `utilities` atoms as `css()`, and the
 * named `recipes` layer is not emitted. An override a caller chooses belongs in a recipe variant.
 */
const declaration = outdent`
   type Argument = string | boolean | null | undefined | Argument[]

   /**
    * Join classNames into a single string.
    *
    * Bamboo styles passed here — a \`css()\` call, a recipe, or a binding holding either — are
    * merged by the compiler before any class exists, later arguments winning:
    * \`cx(css({ paddingX: '4' }), css({ paddingX: '2' }))\` compiles to the one class for
    * \`paddingX: '2'\`.
    *
    * Anything else is only joined, such as a \`className\` prop or a class assembled at runtime, and
    * the join does **not** resolve conflicts: recipes and \`css()\` share one cascade layer, so where
    * such a class sets a property these styles set too, the browser picks by stylesheet order rather
    * than by the order you passed them. For an override a caller chooses, expose a recipe variant.
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

export function generateCx(ctx: Context) {
  return {
    js: outdent`
  ${ctx.file.import('splitProps', '../helpers')}

  function cx(a, b) {
    const n = arguments.length

    // \`cx(<compiled class literal>, className)\` is what the transform emits at nearly every
    // call site it cannot fold, so it is the shape that actually runs per render — a wrapper
    // forwarding a className down. Answering it here skips the rest-array allocation and the
    // loop below. \`b\` covers the whole non-string tail \`cx\` ignores (null/undefined/booleans),
    // which is the \`cond && cls\` idiom when the condition is false.
    if (n === 2 && typeof a === 'string') {
      if (typeof b === 'string') return a ? (b ? a + ' ' + b : a) : b
      if (b == null || b === false || b === true) return a
    }

    let str = ''
    // \`arguments\` rather than a rest parameter: this is the variadic tail, and allocating an
    // array per call to iterate it once is the cost the fast path above exists to avoid.
    for (let i = 0; i < n; i++) {
      const arg = arguments[i]
      if (!arg) continue
      // Arrays are part of the declared type, so this branch has to handle them.
      // Returning '' for \`cx(['a', 'b'])\` would be a lie.
      const part = Array.isArray(arg) ? cx(...arg) : typeof arg === 'string' ? arg : ''
      if (!part) continue
      str && (str += ' ')
      str += part
    }
    return str
  }

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
