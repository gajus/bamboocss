import { esc } from '@bamboocss/shared'

/**
 * Expand `token(path)` references in a string value to whatever `resolve` returns for the path.
 * One level of parentheses is let in, for a literal colour given an opacity: `token(rgb(0 0 0)/64)`.
 * A comma outside them is not, which leaves the retired fallback, `token(a, var(--b))`, as written.
 *
 * This was a 180-line character-state parser, and every line of it was there for the fallback
 * form — `token(a, b)`, which could nest arbitrarily as `token(a, token(b, var(--c, blue)))`.
 * With the fallback gone the grammar has no recursion left in it, so one regex covers it.
 *
 * A path that resolves to nothing is escaped rather than dropped, so it survives into the class
 * name as written instead of silently becoming empty.
 */
const REFERENCE = /token\(((?:[^(),]|\([^()]*\))+)\)/g

export const expandTokenReferences = (str: string, resolve: (path: string) => string | undefined) => {
  if (!str.includes('token(')) return str

  return str.replace(REFERENCE, (_match, path: string) => {
    const trimmed = path.trim()
    return resolve(trimmed) ?? esc(trimmed)
  })
}

const NONE: readonly string[] = []

/** The path of every `token(path)` reference in a string, trimmed — the ones `expandTokenReferences` expands. */
export const tokenReferencePaths = (str: string): readonly string[] => {
  // Asked of every value the build transforms, and almost none hold a reference.
  if (!str.includes('token(')) return NONE
  return Array.from(str.matchAll(REFERENCE), (match) => match[1].trim())
}
