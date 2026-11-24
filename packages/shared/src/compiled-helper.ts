import { version } from '../package.json'

/** The release as a name ends in it: `1.65.0-next.1` as `$bamboo_1_65_0_next_1`. */
const RELEASE = `$bamboo_${version.replace(/[^\w$]/g, '_')}`

/**
 * The name the generated runtime exports a helper by for compiled code, and compiled code imports it by: the
 * helper's own, then the release, as in `cvaMap$bamboo_1_64_11`.
 *
 * The two are written apart — the code by the transform as a module is built, the helpers by codegen as
 * `styled-system` is generated — and agree on formats nothing else records. A recipe lookup's table, which
 * `cvaMap` reads, changed three times in two days, and a `cvaMap` from before read a table written after as
 * selecting nothing: the element lost its recipe's classes, and nothing said so. The Vite plugin writes the
 * project's own `styled-system` before anything imports it, so that one always matches; one it did not write
 * need not, such as a workspace package's own, or one a `bamboo` of another release wrote over it.
 *
 * Named for the release, the helper is found only in a runtime of the same release, so code compiled by one fails
 * where it meets another's: a build refuses the import, the browser and Node refuse to link the module, and Vite's
 * SSR runner finds no function to call.
 */
export const compiledHelperName = (helper: 'cvaMap' | 'splitProps'): string => `${helper}${RELEASE}`
