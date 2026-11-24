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

/** The leaf one table selects for `values`. */
const cvaLeaf = (values: unknown[], table: CvaTable): unknown => {
  const nodes = table[1]
  let current = table[0]
  // Each node on a path decides a later value than the one before it, so a path visits one node
  // per value at most; a longer one is a table no build wrote.
  for (let i = 0; i < values.length && current >= 0; i++) {
    const node = nodes[current]
    if (!node) return ''

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
  return current < 0 ? (table[2][~current] ?? '') : ''
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
  // decide it alone, joined in the order the recipe writes them.
  let classes = ''
  for (let i = 0; i < table.length; i++) {
    const segment = table[i] as string | CvaTable
    const part = typeof segment === 'string' ? segment : (cvaLeaf(values, segment) as string)
    if (part) classes = classes ? classes + ' ' + part : part
  }
  return classes
}
