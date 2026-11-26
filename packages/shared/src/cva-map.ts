/**
 * One decision of a table: the position in `values` it decides, then where each answer leads —
 * `null`, `undefined`, and `[key, child, key, child, ...]` for the rest, matched as strings. A child
 * is another node's index, or a leaf's as `~index`.
 */
type CvaNode = [position: number, miss: number, absent: number, entries: Array<string | number>]

/**
 * What a recipe call the Vite compiler lowered reads (`packages/vite/src/recipe-table.ts` writes
 * it): `[root, nodes, leaves]`, each leaf a class string or a whole slot object.
 *
 * A decision that changes nothing is left out, so a node's depth is not its position. Arrays avoid
 * object-literal `__proto__` semantics, while string coercion matches a recipe's property lookup.
 */
export type CvaTable = [root: number, nodes: CvaNode[], leaves: unknown[]]

/**
 * A table, or segments: runs of the recipe's declarations, each a constant or a table of the
 * variants that decide it alone, joined in the order the recipe writes them.
 */
export type CvaLookup = string | CvaTable | Array<string | CvaTable>

/**
 * Where the path through one table for `values` ends: a leaf as `~index`, and anything else, a
 * missing node or a path longer than its values, as a number from zero up, which selects nothing.
 */
const cvaPath = (values: unknown[], table: CvaTable): number => {
  const nodes = table[1]
  let current = table[0]
  // Each node on a path decides a later value than the one before it, so a path visits one node
  // per value at most; a longer one is a table no build wrote.
  for (let i = 0; i < values.length && current >= 0; i++) {
    const node = nodes[current]
    if (!node) return 0

    const value = values[node[0]]
    if (value === undefined) {
      current = node[2]
      continue
    }
    if (value === null) {
      current = node[1]
      continue
    }

    const key = String(value)
    const entries = node[3]
    let next = node[1]
    for (let j = 0; j < entries.length; j += 2) {
      if (entries[j] !== key) continue
      next = entries[j + 1] as number
      break
    }
    current = next
  }
  return current
}

/** The leaf one table selects for `values`. */
const cvaLeaf = (values: unknown[], table: CvaTable): unknown => {
  const at = cvaPath(values, table)
  return at < 0 ? (table[2][~at] ?? '') : ''
}

/**
 * Select the complete class string, or slot object, a lowered recipe call produces for `values`.
 *
 * Written by the source transform, never by hand, and reached through `virtual:bamboo/compiled`,
 * which the Vite plugin serves from its own release (`./compiled.ts`), so the call and the table it
 * reads were written by one compiler.
 */
export const cvaMap = (values: unknown[], table: Exclude<CvaLookup, string> | Record<string, CvaLookup>): unknown => {
  // A slot recipe's whole object: a lookup per slot, in an object the call has to itself.
  if (!Array.isArray(table)) {
    const slots: Record<string, unknown> = {}
    for (const slot in table) {
      const lookup = table[slot]
      slots[slot] = typeof lookup === 'string' ? lookup : cvaMap(values, lookup)
    }
    return slots
  }
  if (typeof table[0] === 'number') {
    const leaf = cvaLeaf(values, table as CvaTable)
    // A slot object is shared by every call reading the table, so each call gets a copy: one that
    // adds to its `root` must not change what the next call reads.
    return typeof leaf === 'string' ? leaf : { ...(leaf as Record<string, unknown>) }
  }
  // Segments: runs of the recipe's declarations, each a constant or a table of variants that
  // decide it alone, joined in the order the recipe writes them. A call the compiler wrote for them
  // is `cvaJoin`'s; these are a slot's, or a module's that binds `cvaJoin` itself.
  let classes = ''
  for (let i = 0; i < table.length; i++) {
    const segment = table[i] as string | CvaTable
    const part = typeof segment === 'string' ? segment : (cvaLeaf(values, segment) as string)
    if (part) classes = classes ? classes + ' ' + part : part
  }
  return classes
}

/**
 * Per segments, the class string each selection joins to.
 *
 * A segmented lookup built its string on every call, a new one each time, and `cx(button(props),
 * className)`, what a wrapper forwarding a class writes, could only find a string it had never seen
 * in its cache by hashing it whole: 472 ns a call on the docs site's button, against 87 ns for the
 * same string again. The selection is a number, each table's leaf a digit in a base of its
 * leaves; segments with more selections than a number holds exactly are joined on every call, as
 * they were. The entries are one per selection a page renders, cleared past 4096 as `cx` clears its
 * own.
 *
 * Keyed by the segments array, which compiled code declares once per module (`tableRef` in
 * `packages/vite/src/fold.ts`). A table built in the call would be a new key every time, and every
 * call would pay for an entry no other call reads.
 */
const segmentsJoined = new WeakMap<object, Map<number, string>>()

/**
 * The class string a segmented recipe call produces for `values`: what `cvaMap` joins for segments,
 * the same string again for a selection seen before.
 *
 * Its own export, called where the compiler wrote segments, rather than a branch of `cvaMap`. V8
 * keeps one record of what a function calls, so a `cvaMap` that ran segments inlined this wherever
 * it was itself inlined, and a table's lookup ran about 25% slower once segments had run.
 */
export const cvaJoin = (values: unknown[], segments: Array<string | CvaTable>): string => {
  let selection = 0
  let base = 1
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    if (typeof segment === 'string') continue
    const at = cvaPath(values, segment)
    selection += (at < 0 ? -at : 0) * base
    base *= segment[2].length + 1
  }
  // A selection a number cannot hold exactly is joined on every call, as it was.
  if (base > Number.MAX_SAFE_INTEGER) return cvaMap(values, segments) as string
  let joined = segmentsJoined.get(segments)
  if (joined === undefined) segmentsJoined.set(segments, (joined = new Map()))
  let classes = joined.get(selection)
  if (classes === undefined) {
    if (joined.size >= 4096) joined.clear()
    // Joined by `cvaMap`, once per selection: rarely enough that its branch for segments stays as
    // cold as a table's call sites need it.
    joined.set(selection, (classes = cvaMap(values, segments) as string))
  }
  return classes
}
