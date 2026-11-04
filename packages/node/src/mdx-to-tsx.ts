import { logger } from '@bamboocss/logger'
import type { BambooPlugin } from '@bamboocss/types'

const MDX_FILE = /\.mdx$/i

/** Every character but a line ending: a blanked span keeps where its lines break. */
const NOT_LINE_ENDING = /[^\r\n]/g
const blank = (text: string) => text.replace(NOT_LINE_ENDING, ' ')

/** Frontmatter, YAML or TOML, opening the file. */
const FRONTMATTER =
  /^(?:---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---|\+\+\+[ \t]*\r?\n(?:[\s\S]*?\r?\n)?\+\+\+)[ \t]*(?:\r?\n|$)/

/** An import or export as MDX reads one: the keyword at the start of a line, then a space. */
const ESM = /^(?:import|export) /

/** The blockquote and list markers a line opens with: the containers what follows is in. */
const CONTAINERS = /^(?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+))*/
/** A code fence: the run, and its info. */
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/
/** A list item's marker, and the space after it: where its content starts. */
const LIST_ITEM = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+|$)/
/** A list item that can interrupt a paragraph: not empty, and if ordered, numbered 1. */
const LIST_INTERRUPT = /^[ \t]{0,3}(?:[-+*]|1[.)])[ \t]+\S/
/** A line opening with a tag or an expression, which MDX lets interrupt a paragraph. */
const JSX_OR_EXPRESSION = /^[ \t]*(?:<(?:[/>]|[\p{ID_Start}$_])|\{)/u

/** Display math, which `remark-math` reads as text, opening a line. */
const MATH_FENCE = /^[ \t]*\$\$/
/** What tells math from a dollar amount: a LaTeX command, `\frac` — whose `{a}{b}` holds no expression. */
const LATEX = /\\[a-z]/i

/**
 * A link reference definition, `[label]: destination 'title'`, the whole line: a URL, braces and
 * all. Not a footnote, `[^1]:`, whose text is Markdown. Its title, where it has one on the line.
 */
const DEFINITION =
  /^[ \t]{0,3}\[(?!\^)(?:[^\]\\\n]|\\.)+\]:[ \t]*(?:<[^<>\n]*>|[^\s<>]\S*)(?:[ \t]+("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\((?:[^()\\\n]|\\.)*\)))?[ \t]*$/
/** A definition's title, on the line after it. */
const DEFINITION_TITLE = /^[ \t]*(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\((?:[^()\\\n]|\\.)*\))[ \t]*$/
/** What follows a link's text: `(destination 'title')`. */
const LINK_RESOURCE =
  /^\(\s*(?:<[^<>\n]*>|(?:[^\s()<>\\]|\\.|\((?:[^\s()<>\\]|\\.)*\))*)(?:\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?\s*\)/
/** How far a link's destination is looked for: past it, a `](` is prose. */
const DESTINATION_LIMIT = 2048

const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/
/** The line under a paragraph that makes it a heading. */
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/

const NAME_START = /[\p{ID_Start}$_]/u
const IDENTIFIER = /[\p{ID_Start}$_][\p{ID_Continue}$]*/uy
const NUMBER = /[\d.][\w.]*/y
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/

/** `<https://…>`, `<mailto:…>`, `<a@b.c>`: links, not JSX — and an error to MDX besides. */
const AUTOLINK =
  /<(?:[a-z][a-z\d+.-]{1,31}:[^\s<>]*|[\w.!#$%&'*+/=?^`{|}~-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*)>/iy

/** After these, what follows starts an expression: a `/` opens a regular expression, a `<` JSX. */
const OPERATOR_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'extends',
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

/**
 * Where the `depth`th blockquote marker a line starts with ends — past the space after it — or
 * `-1` for a line in fewer blockquotes than that.
 */
const pastQuotes = (line: string, depth: number) => {
  let i = 0
  for (let quote = 0; quote < depth; quote++) {
    while (line[i] === ' ' || line[i] === '\t') i++
    if (line[i] !== '>') return -1
    i++
    if (line[i] === ' ' || line[i] === '\t') i++
  }
  return i
}

/** How many blockquotes a line is in. */
const quoteDepth = (line: string) => {
  let depth = 0
  while (pastQuotes(line, depth + 1) !== -1) depth++
  return depth
}

/** A fence opening `text`, or `null`: a backtick fence's info has no backtick, or it is inline code. */
const fenceOf = (text: string) => {
  const fence = FENCE.exec(text)
  return fence && !(fence[1]!.startsWith('`') && fence[2]!.includes('`')) ? fence[1]! : null
}

/**
 * How far a list item's content is from its marker: past the spaces after it. CommonMark starts it
 * one past the marker where five or more follow, which would be an indented code block — and MDX,
 * having none, does not.
 */
const contentOffset = (spaces: string) => spaces.length || 1

/** A line inside the blockquotes it is in: what their markers leave of it. */
const unquote = (line: string) => line.slice(pastQuotes(line, quoteDepth(line)))

/** Where a line's text starts. */
const indentation = (line: string) => line.search(/\S|$/)

/**
 * An `.mdx` file as TSX the extractor can parse.
 *
 * It reached the parser as it was, and Markdown is not TSX: the first apostrophe in a paragraph
 * failed the file, and every style in it left the stylesheet. One that parsed anyway — JSX and
 * nothing else — had the `css()` in a code example read as a call, when to MDX it is a string.
 *
 * So what MDX runs stays where it stands, and what it shows goes. Its imports and exports are
 * kept as they are, and each JSX tag and `{expression}` as it is written, in a fragment; prose,
 * code, comments and frontmatter between them become spaces, with every line ending kept, so a
 * line is where it was. A JSX element's children are Markdown to MDX as well, and blanked the
 * same way; an import among them, which MDX hoists, is moved to the end, where it binds the same.
 *
 * Not MDX's parser, which is asynchronous and ESM — `parser:before` is neither — but what MDX
 * reads them by: an import or export at the start of a line that does not continue a paragraph,
 * running to the next blank line once nothing it opened is still open; an element's tag, its
 * attributes read as JavaScript; an expression to the brace that closes it, a blockquote's `>`
 * at the start of each of its lines left out; a code block to its fence, or to the end of the
 * blockquote or list item it is in.
 */
export const mdxToTsx = (input: string): string => {
  const length = input.length
  /** The blockquotes a tag or an expression being read is in: the `>` opening each line it runs on is theirs. */
  let quoted = 0

  const lineEnd = (at: number) => {
    const end = input.indexOf('\n', at)
    return end === -1 ? length : end
  }

  const lineAt = (at: number) => input.slice(at, lineEnd(at)).replace(/\r$/, '')

  const isBlankLine = (at: number) => {
    for (let i = at; i < length; i++) {
      const c = input[i]
      if (c === '\n') return true
      if (c !== ' ' && c !== '\t' && c !== '\r') return false
    }
    return true
  }

  /** The start of a line, past the markers of the blockquotes being read in. */
  const lineStart = (at: number) => {
    if (!quoted) return at
    const past = pastQuotes(lineAt(at), quoted)
    return past === -1 ? at : at + past
  }

  const skipBlockComment = (at: number) => {
    const end = input.indexOf('*/', at + 2)
    return end === -1 ? length : end + 2
  }

  /** Past a quoted string, or at the line's end where it does not close. */
  const skipString = (at: number) => {
    const quote = input[at]
    for (let i = at + 1; i < length; i++) {
      const c = input[i]
      if (c === '\\') i++
      else if (c === quote) return i + 1
      else if (c === '\n') return i
    }
    return length
  }

  const skipTemplate = (at: number) => {
    let i = at + 1
    while (i < length) {
      const c = input[i]
      if (c === '\\') i += 2
      else if (c === '`') return i + 1
      else if (c === '$' && input[i + 1] === '{') i = skipScript(i + 2, 'brace')
      else i++
    }
    return length
  }

  /** Past a regular expression, or at the line's end, where a `/` turns out to have divided. */
  const skipRegex = (at: number) => {
    let inClass = false
    for (let i = at + 1; i < length; i++) {
      const c = input[i]
      if (c === '\\') i++
      else if (c === '\n') return i
      else if (inClass) inClass = c !== ']'
      else if (c === '[') inClass = true
      else if (c === '/') {
        IDENTIFIER.lastIndex = i + 1
        return i + 1 + (IDENTIFIER.exec(input)?.[0].length ?? 0)
      }
    }
    return length
  }

  const startsElement = (at: number) => {
    const next = input[at + 1]
    return next === '>' || (next !== undefined && NAME_START.test(next))
  }

  /**
   * Past a JSX tag: `<name`, its attributes — strings, `{expressions}` and comments whole, where a
   * `>` closes nothing — and the `>` or `/>` that ends it.
   */
  const skipTag = (at: number) => {
    let i = at + 1
    const closing = input[i] === '/'
    if (closing) i++
    // Only an attribute's value may be an element: `<` anywhere else in a tag is a stray.
    let value = false
    while (i < length) {
      const c = input[i]!
      if (c === '>') return { end: i + 1, closing, selfClosing: false }
      if (c === '/') {
        const next = input[i + 1]
        if (next === '>') return { end: i + 2, closing, selfClosing: true }
        i = next === '*' ? skipBlockComment(i) : next === '/' ? lineEnd(i) : i + 1
        continue
      }
      if (c === '"' || c === "'") {
        const end = input.indexOf(c, i + 1)
        i = end === -1 ? length : end + 1
      } else if (c === '{') i = skipScript(i + 1, 'brace')
      else if (c === '<' && value && startsElement(i)) i = skipElement(i)
      // A blockquote's `>` opening the line is no end of the tag.
      else if (c === '\n') i = lineStart(i + 1)
      else i++
      if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\n') value = c === '='
    }
    return { end: length, closing, selfClosing: false }
  }

  /**
   * Past a JSX element inside JavaScript, whose children are JSX text rather than Markdown. One
   * tag at a time, counting what each opens and closes, so a deep element is not a deep stack.
   */
  const skipElement = (at: number): number => {
    let open = 0
    let i = at
    while (i < length) {
      const tag = skipTag(i)
      i = tag.end
      if (tag.closing) open--
      else if (!tag.selfClosing) open++
      if (open <= 0) return i
      while (i < length) {
        const c = input[i]
        if (c === '{') i = skipScript(i + 1, 'brace')
        else if (c === '<' && (input[i + 1] === '/' || startsElement(i))) break
        else i++
      }
    }
    return length
  }

  /**
   * Where JavaScript starting at `at` ends: past the `}` that closes a brace already open, or —
   * an import or export — past the line before a blank one, once nothing it opened is open.
   *
   * As much of the language as finding that needs: strings, templates, comments, regular
   * expressions and JSX, so that a brace, a blank line or an apostrophe in one is not read as
   * the end.
   */
  const skipScript = (at: number, until: 'brace' | 'statement'): number => {
    let braces = until === 'brace' ? 1 : 0
    let brackets = 0
    // Whether what follows may start an expression, which is what tells a regular expression
    // from a division and JSX from a comparison.
    let expression = true
    let i = at
    while (i < length) {
      const c = input[i]!
      if (c === '"' || c === "'") {
        i = skipString(i)
        expression = false
      } else if (c === '`') {
        i = skipTemplate(i)
        expression = false
      } else if (c === '/' && input[i + 1] === '/') i = lineEnd(i)
      else if (c === '/' && input[i + 1] === '*') i = skipBlockComment(i)
      else if (c === '/' && expression) {
        i = skipRegex(i)
        expression = false
      } else if (c === '<' && expression && startsElement(i)) {
        i = skipElement(i)
        expression = false
      } else if (c === '{' || c === '(' || c === '[') {
        if (c === '{') braces++
        else brackets++
        i++
        expression = true
      } else if (c === '}') {
        i++
        if (--braces === 0 && until === 'brace') return i
        expression = true
      } else if (c === ')' || c === ']') {
        brackets--
        i++
        expression = false
      } else if (c === '\n') {
        i = lineStart(i + 1)
        if (until === 'statement' && braces <= 0 && brackets <= 0 && isBlankLine(i)) return i
      } else if (c === ' ' || c === '\t' || c === '\r') i++
      else if (NAME_START.test(c)) {
        IDENTIFIER.lastIndex = i
        const word = IDENTIFIER.exec(input)![0]
        i += word.length
        expression = OPERATOR_KEYWORDS.has(word)
      } else if (c >= '0' && c <= '9') {
        NUMBER.lastIndex = i
        i += NUMBER.exec(input)![0].length
        expression = false
      } else {
        i++
        expression = c !== '.'
      }
    }
    return length
  }

  /** Whether the line at `at`, in `quotes` blockquotes, ends the paragraph above it: blank, or a block of its own. */
  const endsParagraph = (at: number, quotes: number) => {
    const line = lineAt(at)
    const past = pastQuotes(line, quotes)
    // One with fewer markers continues the paragraph lazily, as text — unless it is a block, or nothing.
    const body = past === -1 ? unquote(line) : line.slice(past)
    if (!body.trim()) return true
    if (past !== -1 && quoteDepth(body) > 0) return true
    return (
      fenceOf(body) !== null ||
      ATX_HEADING.test(body) ||
      THEMATIC_BREAK.test(body) ||
      LIST_INTERRUPT.test(body) ||
      JSX_OR_EXPRESSION.test(body)
    )
  }

  /**
   * Where a span opened by `size` of `marker` closes: the next run as long, in the paragraph.
   * Where none does, remembered to the paragraph's end, so the next run asking is answered at once.
   */
  const unclosed = new Map<string, number>()
  const closingRun = (at: number, marker: string, size: number, quotes: number) => {
    const key = marker + size
    if (at < (unclosed.get(key) ?? -1)) return -1
    let i = at
    while (i < length) {
      const c = input[i]
      if (c === marker) {
        let run = 0
        while (input[i + run] === marker) run++
        if (run === size) return i
        i += run
      } else if (c === '\n' && endsParagraph(i + 1, quotes)) break
      else i++
    }
    unclosed.set(key, i)
    return -1
  }

  const out: string[] = []
  let fragment = false
  /** Elements open in the Markdown. */
  let depth = 0
  /** Whether the line before was prose, which a line starting `import ` continues, as MDX reads it. */
  let paragraph = false
  /** Imports and exports among an element's children, which MDX hoists. */
  const hoisted: string[] = []
  /** The list items the line is in, innermost last: where each one's content starts, inside the blockquotes it is in. */
  const lists: Array<{ column: number; quotes: number }> = []

  const keep = (kept: string) => {
    // After the `;` that an export without one needs: `export const a = 'b'` and a `<` on the
    // line after read as a comparison.
    if (!fragment) out.push(';<>')
    fragment = true
    out.push(kept)
  }

  /**
   * A tag or an expression starting at `at`, as `read` finds its end. One in a blockquote that
   * runs past its line is read, and kept, without the `>` markers of the lines it runs on.
   */
  const keepConstruct = (at: number, quotes: number, read: (at: number) => number) => {
    quoted = quotes
    let end: number
    try {
      end = read(at)
    } finally {
      quoted = 0
    }
    let kept = input.slice(at, end)
    if (quotes > 0 && kept.includes('\n')) {
      kept = kept.replace(/\n([^\n]*)/g, (_, line: string) => {
        const past = pastQuotes(line, quotes)
        return past === -1 ? `\n${line}` : `\n${' '.repeat(past)}${line.slice(past)}`
      })
    }
    keep(kept)
    return end
  }

  /**
   * A line of Markdown, and past it whatever it opened that runs on: a tag, an expression or a
   * code span. Where the line it stops on ends, and whether any of it was prose.
   */
  const scanMarkdown = (at: number, quotes: number) => {
    let i = at
    let run = at
    let prose = false
    // Whether a `[` came before, which a `](` needs to be a link's.
    let bracket = false
    const flush = (to: number) => {
      if (to > run) out.push(blank(input.slice(run, to)))
      run = to
    }
    while (i < length) {
      const c = input[i]!
      if (c === '\n') {
        flush(++i)
        return { next: i, prose }
      }
      if (c === '\\' && ASCII_PUNCTUATION.test(input[i + 1] ?? '')) {
        i += 2
        prose = true
      } else if (c === '`' || c === '$') {
        let size = 0
        while (input[i + size] === c) size++
        const close = closingRun(i + size, c, size, quotes)
        // Math, as `remark-math` reads `$…$`, only where it holds LaTeX: a price on either side
        // of a `{value}` leaves the value as it is.
        const span = close !== -1 && (c === '`' || LATEX.test(input.slice(i + size, close)))
        i = span ? close + size : i + size
        prose = true
      } else if (c === '{') {
        flush(i)
        i = run = keepConstruct(i, quotes, (from) => skipScript(from + 1, 'brace'))
      } else if (c === '<' && input.startsWith('<!--', i)) {
        const end = input.indexOf('-->', i + 4)
        i = end === -1 ? length : end + 3
      } else if (c === '<' && ((AUTOLINK.lastIndex = i), AUTOLINK.test(input))) {
        i = AUTOLINK.lastIndex
        prose = true
      } else if (c === '<' && (input[i + 1] === '/' || startsElement(i))) {
        flush(i)
        let tag = { end: i, closing: false, selfClosing: true }
        i = run = keepConstruct(i, quotes, (from) => (tag = skipTag(from)).end)
        if (tag.closing) depth = Math.max(0, depth - 1)
        else if (!tag.selfClosing) depth++
      } else if (c === ']' && input[i + 1] === '(' && bracket) {
        // A link's destination and title, as one is written: a URL, braces and all.
        const resource = LINK_RESOURCE.exec(input.slice(i + 1, i + 1 + DESTINATION_LIMIT))
        i += resource ? 1 + resource[0].length : 1
        prose = true
      } else {
        if (c !== ' ' && c !== '\t' && c !== '\r') prose = true
        if (c === '[') bracket = true
        i++
      }
    }
    flush(length)
    return { next: length, prose }
  }

  /**
   * Where a block opened on the line before `from` ends: past the line that `closes` it, or at
   * the start of one that leaves the `quotes` blockquotes, or the list `item`, it is in.
   */
  const blockUntil = (
    from: number,
    quotes: number,
    item: { column: number; quotes: number } | undefined,
    closes: (body: string) => boolean,
  ) => {
    let i = from
    while (i < length) {
      const line = lineAt(i)
      const past = pastQuotes(line, quotes)
      if (past === -1) return i
      if (item && line.trim() !== '') {
        const inItem = pastQuotes(line, item.quotes)
        if (inItem === -1 || indentation(line.slice(inItem)) < item.column) return i
      }
      i = lineEnd(i) + 1
      if (closes(line.slice(past))) break
    }
    return Math.min(i, length)
  }

  // Past a byte order mark, which MDX reads past too: before it, `import` was no import.
  let i = input.charCodeAt(0) === 0xfeff ? 1 : 0
  out.push(input.slice(0, i))
  const frontmatter = FRONTMATTER.exec(input.slice(i))
  if (frontmatter) {
    out.push(blank(frontmatter[0]))
    i += frontmatter[0].length
  }

  while (i < length) {
    const end = lineEnd(i)
    const line = input.slice(i, end).replace(/\r$/, '')

    if (!line.trim()) {
      out.push(input.slice(i, end + 1))
      i = end + 1
      paragraph = false
      continue
    }

    if (!paragraph && ESM.test(line)) {
      const stop = skipScript(i, 'statement')
      if (depth === 0) {
        if (fragment) out.push('</>;')
        fragment = false
        out.push(input.slice(i, stop))
      } else {
        out.push(blank(input.slice(i, stop)))
        hoisted.push(input.slice(i, stop))
      }
      lists.length = 0
      i = stop
      continue
    }

    const quotes = quoteDepth(line)
    const body = unquote(line)
    // What follows every marker, blockquote or list item, the line opens with.
    const rest = line.slice(CONTAINERS.exec(line)![0].length)
    const fenceQuotes = quoteDepth(line.slice(0, line.length - rest.length))

    // A line left of where an item's content starts, inside its blockquotes, has left the item.
    while (lists.length) {
      const top = lists.at(-1)!
      const past = pastQuotes(line, top.quotes)
      if (past !== -1 && indentation(line.slice(past)) >= top.column) break
      lists.pop()
    }
    const item = LIST_ITEM.exec(body)
    if (item) lists.push({ column: item[1]!.length + item[2]!.length + contentOffset(item[3]!), quotes })

    const marker = fenceOf(rest)
    if (marker !== null) {
      const stop = blockUntil(end + 1, fenceQuotes, lists.at(-1), (text) => {
        const closing = FENCE_CLOSE.exec(text)
        return closing !== null && closing[1]![0] === marker[0] && closing[1]!.length >= marker.length
      })
      out.push(blank(input.slice(i, stop)))
      i = stop
      paragraph = false
      continue
    }

    // A block, opened by a line of its own: `$$` with no second on the line, which is inline.
    if (MATH_FENCE.test(body) && !body.slice(body.indexOf('$$') + 2).includes('$$')) {
      const stop = blockUntil(end + 1, quotes, lists.at(-1), (text) => /^[ \t]*\$\$/.test(text))
      if (LATEX.test(input.slice(i, stop))) {
        out.push(blank(input.slice(i, stop)))
        i = stop
        paragraph = false
        continue
      }
    }

    const definition = paragraph ? null : DEFINITION.exec(rest)
    if (definition) {
      let stop = Math.min(end + 1, length)
      // Its title, on the line after, inside the same blockquotes — where the line held none.
      if (definition[1] === undefined && stop < length) {
        const next = lineAt(stop)
        const past = pastQuotes(next, quotes)
        if (past !== -1 && quoteDepth(next) === quotes && DEFINITION_TITLE.test(next.slice(past))) {
          stop = Math.min(lineEnd(stop) + 1, length)
        }
      }
      out.push(blank(input.slice(i, stop)))
      i = stop
      continue
    }

    const { next, prose } = scanMarkdown(i, quotes)
    // A heading or a break ends what it follows, and the line after it may be an import.
    paragraph =
      prose && !ATX_HEADING.test(body) && !THEMATIC_BREAK.test(body) && !(paragraph && SETEXT_UNDERLINE.test(body))
    i = next
  }

  if (fragment) out.push(hoisted.length ? '</>;' : '</>')
  for (const statement of hoisted) out.push('\n', statement)
  return out.join('')
}

/**
 * Built in, as the Astro converter is. Last of the `parser:before` hooks, and
 * only for a file none before it made something of: a project that already converts its MDX
 * itself keeps its own.
 */
export const pluginMdx = (): BambooPlugin => ({
  name: '@bamboocss/node:mdx',
  hooks: {
    'parser:before': ({ filePath, content, original }) => {
      if (!MDX_FILE.test(filePath)) return
      if (content === (original ?? content)) return mdxToTsx(content)
      logger.debug('mdx', `${filePath} was rewritten by a \`parser:before\` hook, and is read as that left it`)
    },
  },
})
