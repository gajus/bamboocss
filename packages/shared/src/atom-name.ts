import { hash32, hash32b } from './hash'

/**
 * Names for utility atoms that a runtime join can merge.
 *
 * `cx(styles, props.className)` joins a component's own classes with the ones it is handed, and
 * where two set one property under the same conditions, which applied was the stylesheet's order:
 * decided by the first file to use each value, so a file nothing imports could change it. Named
 * this way, an atom says what it sets, and `cx` keeps the last class per property and conditions,
 * as `css(a, b)` keeps the last declaration.
 *
 * `_`, then six characters coding the conditions and property — the merge key — and `:`, then
 * either five characters coding the declaration (hashed) or the readable name (readable):
 *
 *     _AQSe3b:h5u26        width: 480px under md, hashed
 *     _AQSe3b:md:w_480px   the same, readable
 *
 * The colon is how the runtime `cx` tells an atom from a class written by hand: read by its length
 * instead, a hashed name looked like any ten-character class starting with `_`, and two such
 * classes sharing their first six characters lost one of them.
 *
 * Both codes are hashes of what the atom sets, nothing else, so they come out the same in every
 * build and every environment, and a library's classes merge with an app's built under the same
 * `prefix`: `cx` reads a name past its own build's prefix, and keeps any other class as written.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'

/**
 * Characters coding the conditions and property. 36 bits, so two of a project's 2,000 keys share
 * a code about once in 34,000 projects — and a build that has two fails rather than lets `cx`
 * drop one for the other. There is no other naming to fall back to, so the odds have to be that
 * low: 30 bits made it a project in 500.
 */
export const ATOM_KEY_LENGTH = 6

/**
 * Where the merge key's sixth character comes from, a second hash independent of the first: FNV-1a
 * from its own offset basis, under which no two properties share a code under no condition or
 * under one condition the presets define — every key a project writes without nesting conditions
 * or defining its own. `mergeable-class-names.test.ts` enumerates them, so a change that let two
 * of them collide fails there.
 */
const KEY_SEED = 0x811c9dc5

/**
 * Characters coding the declaration within its key. 30 bits, which only have to tell apart the
 * values written for one property under one set of conditions: two of n values share a name about
 * once in 2³¹/n² builds, one in 34,000 at 250 values and one in 2,100 at a thousand. A build that
 * has two fails naming both (`claimHashedClassName`), in production only, where names are hashed.
 * Four characters failed more builds than the single 32-bit hash this replaced, which compared
 * every atom with every other: a `staticCss` palette of 250 colours for 100 property-and-condition
 * pairs failed one build in 6 against one in 14. Five fail it one in 350.
 */
export const ATOM_VALUE_LENGTH = 5

const encode = (hash: number, length: number) => {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += ALPHABET[hash & 63]
    hash >>>= 6
  }
  return code
}

/** What an atom sets, which is what two atoms have to share for one to override the other. */
export const atomKey = (conditions: readonly string[], property: string) => `${conditions.join(':')}|${property}`

/** The merge key as it is written into a mergeable atom's name. */
export const atomKeyCode = (key: string) => encode(hash32(key), ATOM_KEY_LENGTH - 1) + encode(hash32b(key, KEY_SEED), 1)

/**
 * A mergeable atom's name, before the `prefix` and an important declaration's `!`.
 *
 * `identity` is what the hashed name has always been made from, its conditions and class; `readable`
 * is the name readable mode has always written (`md:w_480px`), absent when names are hashed.
 */
export const mergeableAtomName = (keyCode: string, identity: string, readable?: string) =>
  `_${keyCode}:${readable ?? encode(hash32(identity), ATOM_VALUE_LENGTH)}`
