import { closestMatch, isObject, walkObject } from '@bamboocss/shared'
import type { ConditionDetails, Dict } from '@bamboocss/types'
import merge from 'lodash.merge'
import type { StylesheetContext } from '.'
import { parseSelectors } from './stringify'

export interface SerializeContext extends Omit<StylesheetContext, 'layers' | 'helpers' | 'hash' | 'cssVarRoot'> {}

/**
 * Transform the style object (with conditions, shorthands, tokens) into a valid CSS (in JS) object
 */
export function transformStyles(context: SerializeContext, styleObj: Dict, key: string) {
  const encoder = context.encoder.clone()
  const decoder = context.decoder.clone()

  const hashSet = new Set<string>()
  encoder.hashStyleObject(hashSet, styleObj)

  // Decoded into a clone, so `decoder.atomic` never holds these, and an unresolved token in them
  // is only ever seen here. @see Utility.serializedUnresolvedTokens
  const group = context.utility.withinSerializedStyles(() => decoder.getGroup(hashSet, key))

  return group.result
}

type KeyContext = Pick<SerializeContext, 'conditions' | 'isValidProperty'>

/**
 * Whether an object written under a property's name is that property's value under conditions,
 * `p: { base: '2', md: '4' }`, rather than the styles of a selector spelled the same way,
 * `p: { color: 'red' }` for the paragraphs inside its parent. A conditional value has only
 * conditions for keys, all the way down to its values.
 */
const isConditionalValue = (context: KeyContext, value: Dict): boolean => {
  for (const key in value) {
    if (!context.conditions.isCondition(key)) return false
    const child = value[key]
    if (isObject(child) && !isConditionalValue(context, child)) return false
  }
  return true
}

/**
 * Whether a key holding an object, written without `&`, is a selector: one that is neither a
 * condition nor a property's conditional value.
 *
 * Being a property is not enough to rule it out. `p`, `filter`, `font` and `mask` name elements
 * as well as properties, and `'.prose': { p: { color: 'red' } }` was read as the padding shorthand
 * holding `color` as a condition it does not know, which wrote `.prose { color: red }`. What the
 * object holds is what tells the two apart.
 */
const isNestedSelector = (context: KeyContext, key: string, value: unknown): value is Dict =>
  isObject(value) &&
  !context.conditions.isCondition(key) &&
  !(context.isValidProperty(key) && isConditionalValue(context, value))

/** Whether every member of a selector puts its `&` last, after a space: `.dark &`. */
const prefixesSelector = (selector: string) =>
  parseSelectors(selector).every((member) => {
    const trimmed = member.trim()
    return trimmed.endsWith(' &') && trimmed.indexOf('&') === trimmed.length - 1
  })

/**
 * Whether a condition can open a rule at the top of `global.css`, around the selectors written
 * inside it, as what it stands for.
 *
 * An at-rule can: it wraps them, `md: { body: … }` as `@media (width >= 48rem) { body { … } }`.
 * So can a selector that only puts something in front of the one after it, `.group:hover &`, which
 * comes out as `.group:hover body`. One that adds to the element itself, `&:hover` or `&.dark`, has
 * no element there to add to: its `&` would be the page's root, and `_hover: { a: … }` would style
 * every link whenever the pointer is anywhere on the page.
 */
const opensRule = (condition: ConditionDetails) =>
  typeof condition.raw === 'string' && (condition.type === 'at-rule' || prefixesSelector(condition.raw))

/**
 * The selector a top-level key opens, as `stringify` reads it.
 *
 * Top-level keys are taken as selectors without being looked at, so a condition there was written
 * out under its own name: `md: { body: … }` as `md body`, which matches nothing. One that can open
 * a rule is written as what it stands for instead, as an at-rule spelled out at the top,
 * `'@media (width >= 48rem)'`, always was. The rest are reported; see `findGlobalCssMistakes`.
 */
const scopeOf = (context: SerializeContext, key: string) => {
  if (!context.conditions.has(key)) return key
  const condition = context.conditions.getRaw(key)
  if (!condition || !opensRule(condition)) return key
  return context.utility.tokens.resolveReference(condition.raw as string)
}

/**
 * Serialize the style object (with conditions, shorthands, tokens) into a valid CSS string
 */
export function serializeStyles(context: SerializeContext, groupedObject: Dict) {
  const result: Dict = {}

  for (const [key, styles] of Object.entries(groupedObject)) {
    const scope = scopeOf(context, key)
    result[scope] ||= {}

    const styleObject = walkObject(styles, (value) => value, {
      getKey: (prop, value) => {
        // Rewrite html selectors to include the parent selector so that it can be parsed later on
        // ex: 'body, :root' => '& body, & :root'
        if (isNestedSelector(context, prop, value)) {
          const selectors = parseSelectors(prop)
          return selectors.map((s) => '& ' + s).join(', ')
        }

        return prop
      },
    })

    merge(result[scope], transformStyles(context, styleObject, scope))
  }
  return result
}

/** CSS functions a selector is written in, which read as an element when `&:` is left off. */
const SELECTOR_FUNCTIONS = new Set(['has', 'is', 'not', 'where'])

/** `global.css['.card'].has`: where a key sits, spelled the way the config writes it. */
const pathOf = (keys: string[]) =>
  'global.css' +
  keys.map((key) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `['${key.replaceAll("'", "\\'")}']`)).join('')

/** A key as it is written in source: bare when it is an identifier, quoted when it is not. */
const asKey = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key.replaceAll("'", "\\'")}'`)

/**
 * At-rules that hold rules and not declarations: written directly inside one at the top of a
 * stylesheet, a declaration has no rule to belong to, and CSS drops it. `@font-face`, `@page` and
 * the like hold declarations of their own, and `@scope` applies them to its root.
 */
const RULES_ONLY = new Set(['media', 'supports', 'container', 'layer', 'starting-style', 'document'])

/** Whether a condition opens a rule a declaration can sit in: a selector, or an at-rule that takes them. */
const holdsDeclarations = (condition: ConditionDetails) => {
  if (condition.type !== 'at-rule') return true
  const name = /^@([\w-]+)/.exec(condition.raw)?.[1]
  return !name || !RULES_ONLY.has(name)
}

/**
 * What in `global.css` cannot mean what it says, one sentence each.
 *
 * Every key there is a selector unless it is a condition or a property, and a selector needs no
 * `&`, so nothing a mistake turns into is ever refused: it is written as a selector or a
 * declaration that applies nowhere, and the style is absent with nothing said. These are the
 * shapes that can only be that:
 *
 * - a key read as an element no document has: `_hovr`, a condition misspelled, or `has`, a
 *   selector function written without `&:`;
 * - a condition at the top that adds to an element, `_dark` or `_hover`, where there is no
 *   element for it to add to, so it is written as a selector of its own name;
 * - a declaration with no rule to sit in: at the top, where it is dropped, or directly inside an
 *   `@media` there, where CSS drops it.
 *
 * Under a mistake nothing more is looked at: the one sentence is what there is to fix.
 */
export const findGlobalCssMistakes = (context: KeyContext, css: Dict): string[] => {
  const { conditions } = context
  const mistakes: string[] = []

  /** The first key under `styles` that is a selector, for an example that reads like the config. */
  const selectorIn = (styles: Dict) => Object.keys(styles).find((key) => isNestedSelector(context, key, styles[key]))

  /** `inRule` is whether a declaration written in `styles` has a rule to sit in. */
  const visit = (styles: Dict, keys: string[], inRule: boolean) => {
    const top = keys.length === 0

    for (const [key, value] of Object.entries(styles)) {
      if (value == null) continue
      const path = [...keys, key]

      if (isObject(value) && conditions.isCondition(key)) {
        const condition = conditions.getRaw(key)
        if (!condition) continue
        // A condition written out, `'&:hover'`, is the user's own selector, and at the top it reads
        // as CSS nesting reads it there. One named is the build's to place.
        if (top && conditions.has(key) && !opensRule(condition)) {
          const example = selectorIn(value) ?? 'html'
          mistakes.push(
            `\`${pathOf(path)}\` is a condition, and at the top there is no element for it to apply to, so it is ` +
              `written as a selector named \`${key}\`, which matches nothing. Write it inside the selector it ` +
              `applies to: \`${asKey(example)}: { ${asKey(key)}: { … } }\`.`,
          )
          continue
        }
        visit(value, path, inRule || holdsDeclarations(condition))
        continue
      }

      // A declaration: a value, or a property's value under conditions. At the top every key is a
      // selector, whatever it holds.
      if (!isObject(value) || (!top && !isNestedSelector(context, key, value))) {
        if (!inRule) {
          mistakes.push(
            `\`${pathOf(path)}\` is a declaration with no selector above it, so it applies to nothing. ` +
              `Write it inside the selector it applies to.`,
          )
        }
        continue
      }

      if (key.startsWith('_')) {
        const nearest = closestMatch(key, conditions.keys())
        mistakes.push(
          `\`${pathOf(path)}\` is not a condition, so it is read as an element named \`${key}\`, which matches nothing.` +
            (nearest ? ` Did you mean \`${asKey(nearest)}\`?` : ''),
        )
        continue
      }

      if (SELECTOR_FUNCTIONS.has(key)) {
        const argument = selectorIn(value) ?? '…'
        mistakes.push(
          `\`${pathOf(path)}\` is read as an element named \`${key}\`, which matches nothing. ` +
            `Did you mean \`${asKey(`&:${key}(${argument})`)}\`?`,
        )
        continue
      }

      visit(value, path, true)
    }
  }

  visit(css, [], false)
  return mistakes
}
