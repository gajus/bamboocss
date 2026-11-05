/**
 * Two things in an Astro template that `@astrojs/compiler` turns into TSX that does not parse, and
 * so into a file that is not extracted at all.
 *
 * - Astro reads an expression by matching its braces, quotes and backticks, and knows no regular
 *   expression. `{x.replace(/}/g, '')}` ended at the regex's `}`, and every expression after it was
 *   read out of place; a `{`, a backtick or a quote in a regex did the same. Each of those, in a
 *   regex in an expression, is written here as the escape that matches the same character, `\x7d`
 *   for `}`, which Astro reads past. A quantifier's braces, `{2}`, are balanced, and left as they
 *   are: as escapes they would match the braces instead.
 * - An expression may hold several nodes side by side, `{cond && ( <a /> <b /> )}`. Astro's TSX
 *   wraps each element in a fragment of its own, and two fragments side by side are no expression.
 *   They are put in one fragment here, `( <><a /> <b /> </>)`, which Astro reads as the same nodes.
 *
 * The frontmatter, which Astro reads as code, and the content of `<script>` and `<style>` are left
 * as they are, and so is any file that holds neither: nearly every one.
 */

type Edit = [start: number, end: number, text: string]

/** HTML elements that take no children, and so no closing tag. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/** Elements whose content is text, in which a `{` is no expression. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style'])

/** Words after which an expression starts, so that a `/` begins a regex rather than divides. */
const KEYWORDS_BEFORE_EXPRESSION = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
])

/** Words that carry an expression on past an element, `<a /> as any`, rather than begin text. */
const WORDS_AFTER_OPERAND = new Set(['as', 'in', 'instanceof', 'satisfies'])

/** What Astro reads in a regex as its own syntax, as an escape matching the same character. */
const ESCAPES: Record<string, string> = { '{': '\\x7b', '}': '\\x7d', '`': '\\x60', "'": '\\x27', '"': '\\x22' }

const QUANTIFIER = /\{\d+(?:,\d*)?\}/y
const TAG_NAME = /[^\s/>{]*/y
const ATTRIBUTE_NAME = /[^\s=/>{"'`]+/y
/** An unquoted attribute value, which ends at a space or the tag's end: `/>` included. */
const UNQUOTED_VALUE = /(?:[^\s/>]|\/(?!>))*/y
const WORD = /[\p{ID_Continue}$‌‍]+/uy
const SPACE = /\s/
/** A character that carries an expression on past an operand: an operator or a closing bracket. */
const CONTINUATION = /[)\]},;:?.&|=!+\-*/%^~>]/

const matchAt = (pattern: RegExp, source: string, at: number) => {
  pattern.lastIndex = at
  return pattern.exec(source)?.[0] ?? ''
}

/** A regex's body with what Astro reads as syntax escaped, or `undefined` if nothing in it is. */
const escapeRegexBody = (body: string): string | undefined => {
  if (!/[{}`'"]/.test(body)) return
  let escaped = ''
  let inClass = false
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char === '\\') {
      escaped += char + (body[i + 1] ?? '')
      i++
      continue
    }
    if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '{' && !inClass) {
      const quantifier = matchAt(QUANTIFIER, body, i)
      if (quantifier) {
        escaped += quantifier
        i += quantifier.length - 1
        continue
      }
    }
    escaped += ESCAPES[char] ?? char
  }
  return escaped === body ? undefined : escaped
}

/**
 * Where an Astro component's template starts: after its frontmatter, if it has one. The fence
 * that ends it is a line of its own, and a `---` in a string or a comment of the frontmatter is
 * the frontmatter's.
 */
const templateStart = (source: string) => {
  const open = /^\s*---/.exec(source)
  if (!open) return 0
  const length = source.length
  for (let i = open[0].length; i < length; i++) {
    const char = source[i]
    if (char === '\n' && source.startsWith('---', i + 1) && /^[ \t]*(?:\r?\n|$)/.test(source.slice(i + 4, i + 6))) {
      return i + 4
    }
    if (char === '"' || char === "'" || char === '`') {
      for (i++; i < length && source[i] !== char; i++) if (source[i] === '\\') i++
    } else if (char === '/' && source[i + 1] === '/') {
      while (i < length && source[i + 1] !== '\n') i++
    } else if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? length : end + 1
    }
  }
  return length
}

/** An Astro component, with its template written as `@astrojs/compiler` turns into valid TSX. */
export const prepareAstroTemplate = (source: string): string => {
  const length = source.length
  const edits: Edit[] = []
  let lowered: string | undefined

  const skipPast = (token: string, from: number) => {
    const at = source.indexOf(token, from)
    return at === -1 ? length : at + token.length
  }
  const skipSpace = (from: number) => {
    let i = from
    while (i < length && SPACE.test(source[i]!)) i++
    return i
  }
  const startsElement = (at: number) => source[at] === '<' && /[A-Za-z>]/.test(source[at + 1] ?? '')

  /** A JavaScript string, from its opening quote: it ends at the line, if its quote does not. */
  const string = (at: number) => {
    const quote = source[at]
    for (let i = at + 1; i < length; i++) {
      const char = source[i]
      if (char === '\\') i++
      else if (char === quote) return i + 1
      else if (char === '\n') return i
    }
    return length
  }

  /** A template literal, from after its backtick, with the expressions it holds. */
  const template = (at: number) => {
    let i = at
    while (i < length) {
      const char = source[i]
      if (char === '\\') i += 2
      else if (char === '`') return i + 1
      else if (char === '$' && source[i + 1] === '{') i = expression(i + 2)
      else i++
    }
    return length
  }

  /** A regex literal, from its `/`, or `-1` if there is none: a regex ends on its line. */
  const regex = (at: number) => {
    let inClass = false
    let i = at + 1
    for (; i < length; i++) {
      const char = source[i]
      if (char === '\n' || char === '\r') return -1
      if (char === '\\') i++
      else if (char === '[') inClass = true
      else if (char === ']') inClass = false
      else if (char === '/' && !inClass) break
    }
    if (i >= length) return -1
    const escaped = escapeRegexBody(source.slice(at + 1, i))
    if (escaped !== undefined) edits.push([at + 1, i, escaped])
    i++
    while (i < length && /[a-z]/i.test(source[i]!)) i++
    return i
  }

  /** Whether what is at `at`, after an element, carries an expression on rather than adds a node. */
  const continuesExpression = (at: number) => {
    const char = source[at]!
    if (char === '<') return !startsElement(at) && !source.startsWith('<!--', at)
    if (CONTINUATION.test(char)) return true
    return WORDS_AFTER_OPERAND.has(matchAt(WORD, source, at))
  }

  /**
   * Nodes an expression starts with, from the `<` of the first, to where the expression goes on:
   * after that element, or at the `closer` that ends the nodes side by side with it, which are put
   * in one fragment.
   */
  const nodes = (start: number, closer: ')' | '}') => {
    const first = element(start, true)
    const next = skipSpace(first)
    if (next >= length || continuesExpression(next)) return first
    let i = next
    let depth = 0
    while (i < length) {
      const char = source[i]
      if (char === '{') i = expression(i + 1)
      else if (char === closer && depth === 0) {
        edits.push([start, start, '<>'], [i, i, '</>'])
        return i
      } else if (char === '}') return i
      else if (char === '(') {
        depth++
        i++
      } else if (char === ')') {
        depth = Math.max(0, depth - 1)
        i++
      } else if (char === '<' && source.startsWith('<!--', i)) i = skipPast('-->', i + 4)
      else if (char === '<' && source[i + 1] === '/') return i
      else if (startsElement(i)) i = element(i, true)
      else i++
    }
    return length
  }

  /** An expression, from after its `{`, to after the `}` that ends it. */
  const expression = (at: number): number => {
    const first = skipSpace(at)
    let i = startsElement(first) ? nodes(first, '}') : first
    let depth = 0
    // After an operand a `/` divides and a `<` compares; anywhere else they begin a regex and
    // an element.
    let operand = i !== first
    // After a `.`, a word is a property, `x.in`, however it is spelled.
    let property = false
    while (i < length) {
      const char = source[i]!
      if (SPACE.test(char)) {
        i++
        continue
      }
      if (char === '/') {
        const next = source[i + 1]
        if (next === '/') i = skipPast('\n', i + 2)
        else if (next === '*') i = skipPast('*/', i + 2)
        else {
          const end = operand ? -1 : regex(i)
          operand = end !== -1
          i = end === -1 ? i + 1 : end
        }
        continue
      }
      if (char === '"' || char === "'") {
        i = string(i)
        operand = true
      } else if (char === '`') {
        i = template(i + 1)
        operand = true
      } else if (char === '(') {
        depth++
        const inner = skipSpace(i + 1)
        operand = startsElement(inner)
        i = operand ? nodes(inner, ')') : i + 1
      } else if (char === '{' || char === '[') {
        depth++
        i++
        operand = false
      } else if (char === '}') {
        if (depth === 0) return i + 1
        depth--
        i++
        operand = true
      } else if (char === ')' || char === ']') {
        depth = Math.max(0, depth - 1)
        i++
        operand = true
      } else if (char === '<' && source[i + 1] === '/') {
        // A closing tag no element here opened, or one an element left for its parent: passed
        // over whole, so its `/` is not read as a regex.
        i = skipPast('>', i + 2)
        operand = true
      } else if (char === '<' && source.startsWith('<!--', i)) {
        // A comment node, whose text is not code.
        i = skipPast('-->', i + 4)
        operand = true
      } else if (char === '<' && !operand && startsElement(i)) {
        i = element(i, true)
        operand = true
      } else {
        const word = matchAt(WORD, source, i)
        if (word) {
          i += word.length
          operand = property || !KEYWORDS_BEFORE_EXPRESSION.has(word)
        } else if (operand && (char === '!' || ((char === '+' || char === '-') && source[i + 1] === char))) {
          // Postfix — `total!`, TypeScript's assertion, and `a++` — which leaves an operand.
          i += char === '!' ? 1 : 2
        } else {
          i++
          operand = false
        }
        property = !word && char === '.'
        continue
      }
      property = false
    }
    return length
  }

  /**
   * An element's children, to after its closing tag. The closing tag of an element above it ends
   * it too, as HTML closes what is left open, and so does the `}` of the expression it is in.
   */
  const children = (at: number, name: string | undefined, inExpression: boolean): number => {
    let i = at
    while (i < length) {
      const char = source[i]
      if (char === '{') i = expression(i + 1)
      else if (char === '}' && inExpression) return i
      else if (char === '<' && source.startsWith('<!--', i)) i = skipPast('-->', i + 4)
      else if (char === '<' && source[i + 1] === '/') {
        const closing = matchAt(TAG_NAME, source, i + 2)
        if (name !== undefined && closing.toLowerCase() !== name.toLowerCase()) return i
        i = skipPast('>', i + 2)
        if (name !== undefined) return i
      } else if (startsElement(i)) i = element(i, inExpression)
      else i++
    }
    return length
  }

  /** An element, from its `<`: its attributes' expressions, and its children unless they are text. */
  const element = (at: number, inExpression: boolean): number => {
    const name = matchAt(TAG_NAME, source, at + 1)
    let raw = RAW_TEXT_ELEMENTS.has(name.toLowerCase())
    let i = at + 1 + name.length
    for (;;) {
      i = skipSpace(i)
      if (i >= length) return length
      const char = source[i]
      if (char === '>') {
        i++
        break
      }
      if (char === '/' && source[i + 1] === '>') return i + 2
      if (char === '{') {
        i = expression(i + 1)
        continue
      }
      const attribute = matchAt(ATTRIBUTE_NAME, source, i)
      if (!attribute) {
        i++
        continue
      }
      if (attribute === 'is:raw') raw = true
      i = skipSpace(i + attribute.length)
      if (source[i] !== '=') continue
      i = skipSpace(i + 1)
      const quote = source[i]
      if (quote === '"' || quote === "'") i = skipPast(quote, i + 1)
      else if (quote === '`') i = template(i + 1)
      else if (quote === '{') i = expression(i + 1)
      else i += matchAt(UNQUOTED_VALUE, source, i).length
    }
    if (raw) {
      lowered ??= source.toLowerCase()
      const close = lowered.indexOf(`</${name.toLowerCase()}`, i)
      return close === -1 ? length : skipPast('>', close)
    }
    if (VOID_ELEMENTS.has(name.toLowerCase())) return i
    return children(i, name, inExpression)
  }

  children(templateStart(source), undefined, false)
  if (!edits.length) return source

  // An element's regexes are found before the fragment around the nodes it starts.
  edits.sort((a, b) => a[0] - b[0])
  let prepared = ''
  let from = 0
  for (const [start, end, text] of edits) {
    prepared += source.slice(from, start) + text
    from = end
  }
  return prepared + source.slice(from)
}
