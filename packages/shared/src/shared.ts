/**
 * Runtime helpers embedded in each generated `styled-system`.
 *
 * Exactly what the generated modules import from `../helpers`, and nothing else: this file is
 * bundled into every project's `helpers.mjs`, so an export here that no artifact imports is
 * shipped for nothing. `helpers-import-parity.test.ts` checks the other direction — that every
 * name an artifact imports is exported.
 *
 * The recipe engine's helpers (`compact`, `memo`, `toHash`, `uniq`, `mergeProps`,
 * `getRecipeIdentity`, `getSlotRecipes`, `getSlotCompoundVariant`) were dropped with the
 * runtime `cva`/`sva`/config-recipe engine, which a compiled build could never reach.
 */
export { createMergeCss } from './classname'
export { cloneStyles } from './clone-styles'
export { createPatternFns, getPatternStyles } from './pattern-fns'
export { splitProps } from './split-props'
