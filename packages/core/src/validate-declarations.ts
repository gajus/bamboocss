import type { AtRule, Container, Declaration, Document, Root, Rule } from 'postcss'

/**
 * A declaration in the emitted stylesheet whose value the property's grammar rejects.
 *
 * The browser parses the sheet without complaint and drops exactly this declaration at
 * compute time, so the style is simply absent from the element — the same silent failure an
 * unresolved token produces, reached from every other direction: a utility transform that
 * handed a value through unchanged, a mixin, a raw value under the `[…]` escape hatch, a
 * config recipe, the preset's own reset.
 */
export interface InvalidDeclaration {
  /** The property as it appears in the sheet — hyphenated, prefix and all. */
  prop: string
  /** The value as it appears in the sheet, without its `!important`. */
  value: string
  /**
   * The selector of the outermost rule carrying it, which for an atom is the class that names
   * the value the author wrote. For a keyframe step it is the step.
   */
  selector: string
  /** The top-level `@layer` it is emitted under, when it is under one. */
  layer?: string
  /** How many rules carry this exact declaration. It is reported once between them. */
  count: number
}

/**
 * At-rules whose block holds *descriptors* rather than declarations.
 *
 * `font-display` inside `@font-face` and `syntax` inside `@property` are not properties, and
 * a property name that does appear inside one — `src`, `inherits` — reads a descriptor
 * grammar the property lexer does not carry. Nothing under these is a style declaration, so
 * nothing under them is asked.
 */
const DESCRIPTOR_AT_RULES = new Set([
  'font-face',
  'property',
  'counter-style',
  'page',
  'font-palette-values',
  'font-feature-values',
  'position-try',
  'view-transition',
  'color-profile',
])

/**
 * A value the grammar cannot judge, because part of it is substituted at compute time.
 *
 * The lexer declines `var()` outright, and `env()`, `attr()` and `if()` are the same shape:
 * what the declaration will hold is not in the text. Tested before the memoised match rather
 * than left to it, because a token-backed sheet is mostly `var()` — three quarters of the
 * declarations across this repository's sandboxes — and that is the case to make free.
 */
const SUBSTITUTION = /(?:^|[^\w-])(?:var|env|attr|if)\(/i

/**
 * Every declaration in `root` that its property's grammar rejects, one entry per distinct
 * `property: value`.
 *
 * `matches` is the verdict — `Utility.matchesCssGrammar`, so that this and the unresolved
 * token check cannot disagree about one value; it is also where the per-pair memo and the
 * deprecated-system-colour allowance live. Anything the lexer has no opinion on — a property
 * it has never heard of, a custom property — counts as a match there, so a fresh property is
 * never reported for being fresh. Only a value the grammar *knows* and rejects is.
 */
export function findInvalidDeclarations(
  root: Root | Document,
  matches: (property: string, value: string) => boolean,
): InvalidDeclaration[] {
  const found = new Map<string, InvalidDeclaration>()

  root.walkDecls((decl) => {
    const { prop, value } = decl
    if (prop.startsWith('--')) return
    if (SUBSTITUTION.test(value)) return

    const context = contextOf(decl)
    if (!context) return

    if (matches(prop, value)) return

    const id = `${prop}:${value}`
    const existing = found.get(id)
    if (existing) {
      existing.count++
      return
    }

    found.set(id, { prop, value, selector: context.selector, layer: context.layer, count: 1 })
  })

  return [...found.values()]
}

/**
 * Where a declaration sits: the outermost rule's selector and the top-level layer — or
 * nothing, when it is a descriptor.
 *
 * Outermost rather than nearest, because the sheet is still nested when this runs —
 * `&:hover` inside `.hover\:c_red` — and the class is what names the value an author wrote.
 * The nested selector is not lost so much as beside the point.
 */
function contextOf(decl: Declaration): { selector: string; layer?: string } | undefined {
  let selector: string | undefined
  let layer: string | undefined
  let node: Container | Document | undefined = decl.parent

  while (node && node.type !== 'root' && node.type !== 'document') {
    if (node.type === 'rule') {
      selector = (node as Rule).selector
    } else if (node.type === 'atrule') {
      const name = (node as AtRule).name.toLowerCase()
      if (DESCRIPTOR_AT_RULES.has(name)) return undefined
      if (name === 'layer') layer = (node as AtRule).params
    }
    node = node.parent
  }

  // A declaration directly inside a conditional at-rule is not valid CSS either, but it is
  // not this check's finding: name the at-rule so the report still says where it was.
  if (selector === undefined && decl.parent?.type === 'atrule') selector = `@${(decl.parent as AtRule).name}`

  return { selector: selector ?? '', layer }
}
