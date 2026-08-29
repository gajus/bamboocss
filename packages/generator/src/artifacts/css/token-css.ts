import type { Conditions, Context } from '@bamboocss/core'
import { Stylesheet, expandNestedCss, extractParentSelectors, stringify } from '@bamboocss/core'
import { logger } from '@bamboocss/logger'
import type { ConditionQuery } from '@bamboocss/types'
import postcss, { Container, CssSyntaxError } from 'postcss'

const BASE = 'base'
const OS_DARK = '_osDark'
const OS_LIGHT = '_osLight'
const OS_DARK_QUERY = '@media (prefers-color-scheme: dark)'

/** Compare a condition against a known query without tripping over spacing. */
const normalize = (condition: ConditionQuery | undefined) =>
  typeof condition === 'string' ? condition.replace(/\s+/g, ' ').trim() : undefined

/**
 * Split a value on its top-level `separator`, ignoring one nested inside a function or a
 * string.
 *
 * Depth-aware, so `rgb(16, 19, 26)` is one part rather than three — its commas are the
 * function's own. Quote-aware, so a font stack's `"Foo, Bar"` is not mistaken for a
 * separator. Splitting on `' '` collapses runs of whitespace, which is what makes
 * `0  1px 2px red` and `0 1px 2px red` compare component for component.
 */
function splitTopLevel(value: string, separator: ',' | ' '): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let quote: string | undefined

  const isSeparator = (char: string) =>
    separator === ',' ? char === ',' : char === ' ' || char === '\t' || char === '\n' || char === '\r'

  for (let index = 0; index < value.length; index++) {
    const char = value[index]

    if (quote) {
      current += char
      // Take the escaped character verbatim rather than inspecting it, so `"a\",b"` stays
      // one string.
      if (char === '\\') {
        current += value[index + 1] ?? ''
        index++
      } else if (char === quote) {
        quote = undefined
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }

    if (char === '(') depth++
    else if (char === ')') depth--
    else if (depth === 0 && isSeparator(char)) {
      // A comma's arity is load-bearing -- a mismatch between the two arms is what makes a
      // token unfoldable -- so empty parts are kept. Whitespace runs produce empties by
      // construction and are not arity at all.
      if (separator === ',' || current.trim()) parts.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  if (separator === ',' || current.trim()) parts.push(current.trim())
  return parts
}

/** Functions whose result is a `<color>`. */
const COLOR_FUNCTIONS = new Set([
  'color',
  'color-mix',
  'device-cmyk',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'light-dark',
  'oklab',
  'oklch',
  'rgb',
  'rgba',
])

/** Keywords that are a `<color>`: the named set, the system set, and the two specials. */
const COLOR_KEYWORDS = new Set(
  `transparent currentcolor
   aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
   blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk
   crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
   darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
   darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
   dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
   gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
   lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
   lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
   lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
   magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
   mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
   mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
   palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
   powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
   seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
   steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
   yellowgreen
   accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext
   field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem
   selecteditemtext visitedtext`
    .trim()
    .split(/\s+/),
)

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** One value, rather than a list or a space-separated shorthand. */
const isSingleComponent = (value: string) =>
  splitTopLevel(value, ',').length === 1 && splitTopLevel(value, ' ').length === 1

/**
 * Is this single component provably a `<color>`?
 *
 * Provably, not plausibly. A false negative costs a fold; a false positive emits CSS the
 * browser drops on the floor without a word, which is the failure this whole file is written
 * around. So anything unrecognised is not a color.
 *
 * A `var()` is only a color when it names a token bamboo emitted from the `colors` category —
 * the reference itself says nothing about its type, and guessing wrong is exactly the
 * silent-drop case.
 */
function isColorValue(value: string, colorVars: ReadonlySet<string>): boolean {
  if (value.startsWith('#')) return HEX_COLOR.test(value)

  const open = value.indexOf('(')
  if (open === -1) return COLOR_KEYWORDS.has(value.toLowerCase())
  if (!value.endsWith(')')) return false

  const fn = value.slice(0, open).toLowerCase()
  if (fn !== 'var') return COLOR_FUNCTIONS.has(fn)

  // `var(--x)` and `var(--x, fallback)` alike: a registered color token is always defined, so
  // the fallback cannot be what resolves.
  const [name] = splitTopLevel(value.slice(open + 1, -1), ',')
  return name !== undefined && colorVars.has(name)
}

/**
 * Merge a token's light and dark values into one, folding only the parts that differ.
 *
 * `light-dark()` is a `<color>` function — `light-dark() = light-dark(<color>, <color>)` in
 * CSS Color 5 — and that is the whole constraint here. It cannot carry a shadow, a border
 * shorthand or a length, and a browser handed one drops the declaration outright: verified in
 * Chrome, `--t: light-dark(0 1px 2px red, 0 1px 2px black)` computes `box-shadow: none`,
 * `light-dark(4px, 8px)` computes `padding-top: 0px`. Nothing warns. The token is still in the
 * sheet and the class naming it still looks correct.
 *
 * So a value is folded component by component rather than whole. `0 1px 2px red` against
 * `0 1px 2px black` differs in one place, that place is a color, and the result keeps the
 * geometry outside the function where it parses:
 *
 *     0 1px 2px light-dark(red, black)
 *
 * That is also what makes a list foldable, which folding whole never could: `light-dark()`
 * takes exactly two arguments and CSS offers no way to group a comma-separated value into one
 * of them, so a two-shadow token splatted into `light-dark(a, b, c)` and was dropped. Per-item
 * folding sidesteps the arity problem entirely, because the commas stay in the value where
 * they belong. A list of whole `light-dark()` calls does *not* work and was measured not to —
 * the arms have to be colors either way.
 *
 * Bails to `undefined` — keep the `@media` block, which expresses anything — whenever the two
 * arms do not line up part for part, or a differing part is not provably a color.
 */
function foldValue(light: string, dark: string, colorVars: ReadonlySet<string>): string | undefined {
  const lightItems = splitTopLevel(light, ',')
  const darkItems = splitTopLevel(dark, ',')
  if (lightItems.length !== darkItems.length) return

  const items: string[] = []

  for (let index = 0; index < lightItems.length; index++) {
    const lightParts = splitTopLevel(lightItems[index], ' ')
    const darkParts = splitTopLevel(darkItems[index], ' ')
    // A shadow that names a color in one mode and inherits `currentColor` in the other is not
    // a component-wise edit of the same value, and nothing here can express the difference.
    if (lightParts.length !== darkParts.length) return

    const merged: string[] = []
    for (let part = 0; part < lightParts.length; part++) {
      const lightPart = lightParts[part]
      const darkPart = darkParts[part]
      if (lightPart === darkPart) {
        merged.push(lightPart)
        continue
      }
      if (!isColorValue(lightPart, colorVars) || !isColorValue(darkPart, colorVars)) return
      merged.push(`light-dark(${lightPart}, ${darkPart})`)
    }

    items.push(merged.join(' '))
  }

  return items.join(', ')
}

/**
 * Collapse a token's `base`/`_osDark` pair into a single declaration.
 *
 * Two declarations and a whole `@media (prefers-color-scheme: dark)` block become one line,
 * which for a design system carrying a few hundred `_osDark` semantic tokens is the largest
 * reduction available in this layer.
 *
 * It also makes an explicit theme toggle tractable. `_osDark` is a media query and a
 * `[data-theme=dark]` selector is not, so the two are independent mechanisms that resolve
 * against each other by source order. `light-dark()` reads `color-scheme`, which is an
 * ordinary inherited property — so a toggle is `color-scheme: dark` on a subtree rather than
 * a second copy of every token. That argument is why the fold has to reach past colors: a
 * sheet that folds its colors and leaves its shadows on the media query gives a subtree
 * toggle half a theme, with the shadows still following the OS.
 *
 * A var carrying `_osLight` as well is left alone. Folding it would put the light arm of
 * `light-dark()` and an `@media (prefers-color-scheme: light)` block in play for the same
 * var, where the block wins on order and the arm is simply dead. Three-way tokens keep the
 * mechanism they already had.
 *
 * `view.vars` is shared with the JS theme artifacts, so this copies rather than mutates.
 */
function foldLightDark(vars: Map<string, Map<string, string>>, conditions: Conditions, colorVars: ReadonlySet<string>) {
  const base = vars.get(BASE)
  const osDark = vars.get(OS_DARK)
  if (!base || !osDark) return { vars, folded: false }

  // `_osDark` is a configurable condition, not a keyword. Someone can point it at a selector
  // -- `[data-os=dark] &` -- and `light-dark()` cannot express that, so it is only safe to
  // fold once the condition is confirmed to be the media query it is named after. Under
  // `eject` it resolves to nothing at all.
  if (normalize(conditions.get(OS_DARK)) !== OS_DARK_QUERY) return { vars, folded: false }

  const osLight = vars.get(OS_LIGHT)
  const nextBase = new Map(base)
  const nextDark = new Map(osDark)

  for (const [name, darkValue] of osDark) {
    const lightValue = base.get(name)
    if (lightValue === undefined || osLight?.has(name)) continue

    // A `colors` token is a color however it is spelled, including a raw `var()` a user
    // pointed at a property bamboo never emitted. Its whole value folds without having to be
    // recognised, which keeps this path exactly as capable as it was before the component
    // walk below existed. Still only when the value really is one component: a color is a
    // keyword, a hex or a single function call, never a list or a space-separated shorthand,
    // and folding one of those whole is the arity bug all over again.
    const whole = colorVars.has(name) && isSingleComponent(lightValue) && isSingleComponent(darkValue)

    const folded = whole ? `light-dark(${lightValue}, ${darkValue})` : foldValue(lightValue, darkValue, colorVars)
    if (folded === undefined) continue

    nextBase.set(name, folded)
    nextDark.delete(name)
  }

  if (nextDark.size === osDark.size) return { vars, folded: false }

  const next = new Map(vars)
  next.set(BASE, nextBase)
  if (nextDark.size) next.set(OS_DARK, nextDark)
  else next.delete(OS_DARK)

  return { vars: next, folded: true }
}

/** The custom properties bamboo emitted for `colors` tokens, by var name. */
function getColorVars(tokens: Context['tokens']): ReadonlySet<string> {
  const names = new Set<string>()
  for (const token of tokens.view.categoryMap.get('colors')?.values() ?? []) {
    names.add(token.extensions.var)
  }
  return names
}

export function generateTokenCss(ctx: Context, sheet: Stylesheet) {
  const { config, conditions, tokens } = ctx
  const { cssVarRoot, staticCss } = config

  const root = cssVarRoot!

  const results: string[] = []

  const { vars: tokenVars, folded } = foldLightDark(tokens.view.vars, conditions, getColorVars(tokens))

  /**
   * `light-dark()` returns the light value unless `color-scheme` names both, and a stylesheet
   * that never sets it looks exactly like one where dark mode is broken. This rides with the
   * tokens rather than the reset because it is a prerequisite of the declarations above it,
   * and the reset can be turned off with `preflight: false`. `:where()` keeps it at zero
   * specificity, so `color-scheme: dark` on any subtree still wins.
   */
  if (folded) {
    results.push(stringify({ [root]: { colorScheme: 'light dark' } }))
  }

  const allowed = staticCss?.themes
  let themeVariants: string[] = []

  // Skip theme tokens if they're not explicitly listed in the `staticCss.themes` array
  if (allowed) {
    const keys = Object.keys(config.theme?.variants ?? {})
    themeVariants = allowed.includes('*') ? keys : keys.filter((key) => allowed.includes(key))
  }

  const themeConds = themeVariants.map((key) => conditions.getThemeName(key))
  const themePrefix = ctx.conditions.getThemeName('')

  for (const [key, values] of tokenVars.entries()) {
    const isThemeSkipped =
      key.startsWith(themePrefix) && !themeConds.some((condName) => key === condName || key.startsWith(condName + ':'))
    if (isThemeSkipped) {
      continue
    }

    const css = stringifyVars({ values, conditionKey: key, root: root, conditions })
    if (css) {
      results.push(css)
    }
  }

  let css = results.join('\n\n')
  css = '\n\n' + cleanupSelectors(css, root)

  if (ctx.hooks['cssgen:done']) {
    css = ctx.hooks['cssgen:done']({ artifact: 'tokens', content: css }) ?? css
  }

  sheet.layers.tokens.append(css)
}

export function stringifyVars(options: {
  conditionKey: string
  values: Map<string, string>
  root: string
  conditions: Conditions
}) {
  const { conditionKey, values, root, conditions } = options

  const varsObj = Object.fromEntries(values)
  if (Object.keys(varsObj).length === 0) return

  if (conditionKey === 'base') {
    return stringify({ [root]: varsObj })
  }

  // nested conditionals in semantic tokens are joined by ":", so let's split it
  const keys = conditionKey.split(':')

  // if any part of the condition is missing, skip
  if (keys.some((key) => !conditions.get(key))) return

  const css = stringify(varsObj)

  // Each chained condition contributes one or more selector paths.
  // String/array conditions yield a single path; multi-block (object)
  // conditions yield one path per `@slot` leaf. The final rules are the
  // cartesian product of paths across the chain.
  const altsPerKey = keys.map((key) => getSelectorPaths(conditions.get(key)))
  if (altsPerKey.some((alts) => alts.length === 0)) return

  let combos: string[][] = [[]]
  for (const alts of altsPerKey) {
    const next: string[][] = []
    for (const partial of combos) {
      for (const alt of alts) {
        next.push([...partial, ...alt])
      }
    }
    combos = next
  }

  const rules = combos
    .map((segments) => {
      const transformed = segments.map(transformSegment).filter(Boolean) as string[]
      const rule = getDeepestRule(root, transformed)
      if (!rule) return
      getDeepestNode(rule)?.append(css)
      return expandNestedCss(rule.toString())
    })
    .filter(Boolean) as string[]

  return rules.length ? rules.join('\n\n') : undefined
}

/**
 * Convert a condition value into one or more selector paths.
 * - string: one path with one segment
 * - array (mixed): one path with the last segment (preserves prior behavior)
 * - object (multi-block): one path per `@slot` leaf, with the full segment chain
 */
function getSelectorPaths(condition: ConditionQuery | undefined): string[][] {
  if (condition == null) return []
  if (typeof condition === 'string') return [[condition]]
  if (Array.isArray(condition)) {
    const last = condition.at(-1)
    return last ? [[last]] : []
  }
  const paths: string[][] = []
  const walk = (node: Record<string, any>, path: string[]) => {
    for (const [key, value] of Object.entries(node)) {
      if (value === '@slot') {
        paths.push([...path, key])
      } else if (typeof value === 'object' && value !== null) {
        walk(value, [...path, key])
      }
    }
  }
  walk(condition as Record<string, any>, [])
  return paths
}

/**
 * Apply the existing parent-selector transform to selector segments.
 * At-rules pass through untouched so `getDeepestRule` can wrap them.
 * ASSUMPTION: the nature of parent selectors with tokens is that they're merged
 * (e.g. `[data-color-mode=dark][data-theme=pastel]`). Removing the `&` keeps
 * sibling selectors flat instead of nested.
 */
function transformSegment(seg: string): string {
  if (seg.startsWith('@')) return seg
  const parent = extractParentSelectors(seg)
  return parent ? `&${parent}` : seg
}

/**
 * Build the nesting chain for one condition path.
 *
 * The outermost node is a `Root`, so the first segment has no enclosing rule and
 * its `&` refers to nothing — it is resolved away here rather than by
 * postcss-nested. Deeper segments keep their `&` and nest against the real
 * parent selector as before.
 *
 * This used to be seeded with an empty-selector rule and leaned on
 * postcss-nested to erase `&` against it. postcss 8.5.25 ("Fixed 8.5.17 visitor
 * regression") changed that edge case to collapse the whole selector, so every
 * conditional token was emitted as a selectorless — and therefore discarded —
 * rule, leaving only the `base` value in the tokens layer.
 */
function getDeepestRule(root: string, selectors: string[]) {
  const container = postcss.root()

  for (const selector of selectors) {
    const node = getDeepestNode(container)
    const isTopLevel = node === container
    if (selector.startsWith('@')) {
      // ASSUMPTION: the nature of parent selectors with tokens is that they're merged
      // [data-color-mode=dark][data-theme=pastel]
      // If we really want it nested, we remove the `&`
      const inner = isTopLevel ? root : `${root}&`
      const atRule = postcss.rule({ selector, nodes: [postcss.rule({ selector: inner })] })
      node.append(atRule)
    } else {
      node.append(postcss.rule({ selector: isTopLevel ? withoutParentSelector(selector) : selector }))
    }
  }

  return container
}

function withoutParentSelector(selector: string) {
  return selector.replaceAll('&', '').trim()
}

function getDeepestNode<T extends Container>(node: T): Container {
  if (node.nodes && node.nodes.length) {
    return getDeepestNode(node.nodes[node.nodes.length - 1] as Container)
  }
  return node
}

const parse = (str: string) => {
  try {
    return postcss.parse(str)
  } catch (error) {
    if (error instanceof CssSyntaxError) {
      logger.error('tokens:process', error.showSourceCode(true))
    } else {
      logger.caughtError('tokens:process', 'Failed to parse token CSS', error)
    }
  }
}

export function cleanupSelectors(css: string, varSelector: string) {
  // Ignore if invalid CSS
  const root = parse(css) ?? postcss.root()

  root.walkRules((rule) => {
    // [':root', ' :host,', '  ::backdrop ']
    const selectors = [] as string[]
    rule.selectors.forEach((selector) => {
      selectors.push(selector.trim())
    })

    // ':root, :host, ::backdrop'
    const ruleSelector = selectors.join(', ')
    if (ruleSelector === varSelector) {
      return
    }

    // ':root,:host,::backdrop'
    const trimmedSelector = selectors.join(',')
    if (trimmedSelector === varSelector) {
      return
    }

    const selectorsWithoutVarRoot = selectors
      .map((selector) => {
        const res = selector.split(varSelector).filter(Boolean)
        return res.join('')
      })
      .filter(Boolean)
    if (selectorsWithoutVarRoot.length === 0) return
    rule.selector = selectorsWithoutVarRoot.join(', ')
  })

  return root.toString()
}
