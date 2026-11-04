import { logger } from '@bamboocss/logger'
import { createRequire } from 'node:module'

/**
 * The one export of `@tsrx/core` this reads: its parser, which returns an ESTree AST widened with
 * TSRX's template nodes, each carrying `start`/`end` UTF-16 offsets into the source.
 */
type ParseModule = (source: string, filename: string) => TsrxNode

interface TsrxNode {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

type TsrxParser = { parseModule: ParseModule }

/**
 * The parser a `.tsrx` file is read with: `parseModule` from `@tsrx/core`, the package every
 * TSRX framework plugin already depends on. An optional peer, like the Astro compilers — a
 * project with `.tsrx` files has it.
 *
 * Absent, `.tsrx` files are read as the TSX most of them are. Present and failing to load —
 * a platform binary missing, a Node too old for `require` of an ES module — is said, rather
 * than read as one to install.
 */
export const loadTsrxParser = (require: NodeJS.Require = createRequire(import.meta.url)): TsrxParser | null => {
  try {
    return require('@tsrx/core') as TsrxParser
  } catch (error) {
    const absent =
      (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' && String(error).includes(`'@tsrx/core'`)
    logger.warn(
      'tsrx',
      absent
        ? "`@tsrx/core` could not be loaded, so nothing in a `.tsrx` file's `@{ }` templates is extracted. " +
            'Install `@tsrx/core` to extract them.'
        : `\`@tsrx/core\` is installed and failed to load: ${(error as Error).message ?? error}`,
    )
    return null
  }
}

/**
 * Loaded the first time a `.tsrx` file is actually parsed. A static import would make every
 * project configuring the plugin load its parser even if no `.tsrx` file is read — the
 * reason the Vue, Svelte and Astro plugins load theirs lazily too.
 */
let parser: TsrxParser | null | undefined
const loaded = () => (parser === undefined ? (parser = loadTsrxParser()) : parser)

type Position = 'function-body' | 'statement' | 'jsx-child' | 'expression'

interface Edit {
  start: number
  end: number
  text: string
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const ELEMENT_TYPES = new Set(['JSXElement', 'TSRXJSXElement'])
const FRAGMENT_TYPES = new Set(['JSXFragment', 'TSRXJSXFragment'])
const DIRECTIVE_TYPES = new Set(['JSXIfExpression', 'JSXForExpression', 'JSXSwitchExpression', 'JSXTryExpression'])

/**
 * Where `node` sits, which decides the form its lowering takes: a directive can only be a
 * statement in a statement list, an arrow elsewhere, and a JSX expression where a `<` is a
 * comparison.
 */
const positionOf = (node: TsrxNode, parent: TsrxNode | null, key: string): Position => {
  if (!parent) return 'statement'
  if (node.type === 'JSXCodeBlock' && key === 'body' && FUNCTION_TYPES.has(parent.type)) return 'function-body'
  if (
    (key === 'body' && ['Program', 'BlockStatement', 'JSXCodeBlock', 'StaticBlock'].includes(parent.type)) ||
    (key === 'render' && parent.type === 'JSXCodeBlock') ||
    (key === 'consequent' && parent.type === 'SwitchCase') ||
    (['consequent', 'alternate', 'block', 'pending', 'finalizer'].includes(key) &&
      (parent.type === 'IfStatement' ||
        parent.type === 'JSXIfExpression' ||
        parent.type === 'JSXTryExpression' ||
        DIRECTIVE_TYPES.has(parent.type) ||
        parent.type === 'ForStatement' ||
        parent.type === 'ForInStatement' ||
        parent.type === 'ForOfStatement' ||
        parent.type === 'WhileStatement' ||
        parent.type === 'DoWhileStatement' ||
        parent.type === 'WithStatement' ||
        parent.type === 'LabeledStatement'))
  ) {
    return 'statement'
  }
  if (key === 'children' && (ELEMENT_TYPES.has(parent.type) || FRAGMENT_TYPES.has(parent.type))) return 'jsx-child'
  return 'expression'
}

/**
 * A `.tsrx` file as TSX, lowered by text edits on the original source so every call keeps its
 * exact text, scope and line.
 *
 * `@tsrx/core` parses the file; what its AST marks as TSRX-only — `@{ }` blocks, the
 * `@if`/`@for`/`@switch`/`@try` directives, dynamic `<{expr}>` tags, `{attr}` shorthand, raw
 * `<style>`/`<script>` bodies and comments directly in JSX children — is rewritten in place,
 * and everything else is copied verbatim. No edit adds or removes a newline, so a diagnostic
 * against the result still points at the line it would in the `.tsrx` file.
 *
 * Directives in statement position lower to the statement they spell (`@if` → `if`,
 * `@for (x of y; index i; key k) {…} @empty {…}` → `for (x of y) { let i!: number; (k); … } {…}`);
 * elsewhere they become `(async? () => { … })()`, wrapped in `{ }` as a JSX child. `@try`'s
 * `pending` and `catch` blocks lower to plain blocks, the catch parameters to `let` declarations,
 * since a `try` cannot keep them in source order. `let` declarations stay initializer-free so a
 * call reading one (`css({ order: i })`) remains unevaluable rather than reading as `0`.
 *
 * A `<style>` element's CSS is not JSX and is never scanned: the element lowers to
 * `({} as Record<string, string>)` (`styles.card` still parses) or `{null}` as a child. A raw
 * `<script>` body and a comment in JSX children are blanked to whitespace, newlines kept.
 *
 * Without `@tsrx/core`, or when it cannot parse the file, `undefined`: the file is then read as
 * it always was — TSX-shaped `.tsrx` files keep extracting, and a real template fails the way it
 * did before, with the framework's own compiler reporting the syntax error far better.
 */
export const tsrxToTsx = (
  code: string,
  filename = 'component.tsrx',
  tsrx: TsrxParser | null | undefined = loaded(),
) => {
  if (!tsrx) return undefined
  let program: TsrxNode
  try {
    program = tsrx.parseModule(code, filename)
  } catch (error) {
    logger.debug('tsrx', `@tsrx/core could not parse ${filename}: ${(error as Error).message ?? error}`)
    return undefined
  }

  const edits: Edit[] = []
  const newlinesIn = (start: number, end: number) => '\n'.repeat((code.slice(start, end).match(/\n/g) ?? []).length)
  const replace = (node: TsrxNode, text: string) => edits.push({ start: node.start, end: node.end, text })
  /** Whitespace for a span, keeping its newlines so line numbers below it do not move. */
  const blank = (start: number, end: number) =>
    edits.push({ start, end, text: code.slice(start, end).replaceAll(/[^\n]/g, ' ') })
  const insert = (start: number, text: string) => edits.push({ start, end: start, text })
  /** The `@` opening a keyword span (or starting at `start` when no span is known). */
  const dropAt = (start: number, end = start + 2) => {
    const at = code.indexOf('@', start)
    if (at !== -1 && at < end) blank(at, at + 1)
  }
  /** An `@else`/`@empty`/`@case`-style keyword span, when the node records one. */
  const keywordAt = (node: TsrxNode | null | undefined) => (node ? dropAt(node.start, node.end) : undefined)

  /** Whether a generated arrow must be `async`: `await` or `for await` in the wrapped text. */
  const needsAsync = (node: TsrxNode) => /(^|[^\w$])await(?![\w$])/.test(code.slice(node.start, node.end))

  /** The wrap a lowered statement list needs in `position`, returned as [prefix, suffix]. */
  const wrapped = (node: TsrxNode, position: Position): [string, string] => {
    const arrow = `${needsAsync(node) ? 'async ' : ''}() => { `
    return position === 'jsx-child' ? [`{(${arrow}`, ' })()}'] : [`(${arrow}`, ' })()']
  }

  /** Every `@{…}` or directive node in `position` wraps the same way around its own edits. */
  const lowerBlockLike = (node: TsrxNode, position: Position, keywordEnd: number) => {
    if (position === 'function-body' || position === 'statement') {
      blank(node.start, keywordEnd)
    } else {
      const [prefix, suffix] = wrapped(node, position)
      edits.push({ start: node.start, end: keywordEnd, text: prefix + newlinesIn(node.start, keywordEnd) })
      insert(node.end, suffix)
    }
  }

  const walk = (node: unknown, parent: TsrxNode | null, key: string): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, parent, key)
      return
    }
    const n = node as TsrxNode
    if (typeof n.type !== 'string' || typeof n.start !== 'number' || typeof n.end !== 'number') {
      for (const [childKey, value] of Object.entries(n)) {
        if (childKey === 'loc' || childKey === 'metadata' || childKey === 'css' || childKey === 'innerComments')
          continue
        walk(value, parent, key)
      }
      return
    }
    const position = positionOf(n, parent, key)

    switch (n.type) {
      case 'JSXCodeBlock': {
        // `@{…}`: the `@` is the whole marker — the braces already spell a block.
        lowerBlockLike(n, position, n.start + 1)
        walk(n.body, n, 'body')
        if (n.render) walk(n.render, n, 'render')
        return
      }
      case 'JSXIfExpression': {
        lowerBlockLike(n, position, n.start + 1)
        lowerIfChain(n)
        return
      }
      case 'JSXForExpression': {
        lowerBlockLike(n, position, n.start + 1)
        lowerFor(n)
        return
      }
      case 'JSXSwitchExpression': {
        lowerBlockLike(n, position, n.start + 1)
        for (const switchCase of (n.cases as TsrxNode[]) ?? []) {
          keywordAt(switchCase) // `@case`/`@default` start each case's span
          if (switchCase.test) walk(switchCase.test, switchCase, 'test')
          walk(switchCase.consequent, switchCase, 'consequent')
        }
        if (n.discriminant) walk(n.discriminant, n, 'discriminant')
        return
      }
      case 'JSXTryExpression': {
        const block = n.block as TsrxNode
        lowerBlockLike(n, position, block.start) // `@try ` → the block stands alone
        let previous = block
        for (const partName of ['pending', 'handler', 'finalizer'] as const) {
          const part = n[partName] as TsrxNode | null | undefined
          if (!part) continue
          const partBody = (part.type === 'CatchClause' ? part.body : part) as TsrxNode
          if (part.type === 'CatchClause') {
            // `@catch (err, reset) {C}` → `;((err, reset) => {C})` — an arrow keeps `err` and
            // `reset` scoped over `{C}` however they are written, destructuring included.
            const params = [part.param, part.resetParam]
              .filter((p): p is TsrxNode => !!p)
              .map((p) => code.slice(p.start, p.end))
            edits.push({
              start: previous.end,
              end: partBody.start,
              text: ` ;((${params.join(', ')}) => ` + newlinesIn(previous.end, partBody.start),
            })
            // Rewriting the block's own `}` keeps this inside any wrapper the node grew.
            if (code[partBody.end - 1] === '}') {
              edits.push({ start: partBody.end - 1, end: partBody.end, text: '})' })
            } else {
              edits.push({
                start: partBody.start,
                end: partBody.end,
                text: `${code.slice(partBody.start, partBody.end)})`,
              })
            }
            walk(partBody.body, partBody, 'body')
          } else {
            // `@pending {P}` / `@finally {F}` → `{P}` / `{F}`.
            blank(previous.end, partBody.start)
            walk(partBody.body, partBody, 'body')
          }
          previous = partBody
        }
        walk(block.body, block, 'body')
        return
      }
      case 'JSXStyleElement': {
        const newlines = '\n'.repeat((code.slice(n.start, n.end).match(/\n/g) ?? []).length)
        replace(n, position === 'jsx-child' ? `{null${newlines}}` : `({} as Record<string, string>${newlines})`)
        if (position === 'statement') insert(n.start, ';')
        return
      }
      default:
        break
    }

    if (ELEMENT_TYPES.has(n.type)) {
      const opening = n.openingElement as TsrxNode | undefined
      const closing = n.closingElement as TsrxNode | null | undefined
      // `<{props.as} …>` — a neutral intrinsic holding the expression as an attribute value.
      const name = opening?.name as TsrxNode | undefined
      if (n.isDynamic && name?.type === 'JSXExpressionContainer') {
        replace(name, `tsrx-dynamic tag=${code.slice(name.start, name.end)}`)
        const closingName = closing?.name as TsrxNode | undefined
        if (closingName?.type === 'JSXExpressionContainer') replace(closingName, 'tsrx-dynamic')
      }
      // A raw `<script>` body is text, not JSX children: its bytes would not parse.
      if (typeof n.content === 'string' && opening && closing) blank(opening.end, closing.start)
      if (position === 'statement') insert(n.start, ';')
      for (const attribute of (opening?.attributes as TsrxNode[]) ?? []) {
        // `{foo}` attribute shorthand → `foo={foo}`.
        if (attribute.shorthand) {
          const attributeName = attribute.name as TsrxNode | undefined
          const nameText = attributeName ? code.slice(attributeName.start, attributeName.end) : ''
          replace(attribute, `${nameText}=${code.slice(attribute.start, attribute.end)}`)
        } else {
          walk(attribute, opening ?? n, 'attributes')
        }
      }
      walk(n.children, n, 'children')
      return
    }

    if (FRAGMENT_TYPES.has(n.type)) {
      if (position === 'statement') insert(n.start, ';')
      walk(n.children, n, 'children')
      return
    }

    if (n.type === 'JSXExpressionContainer') {
      const expression = n.expression as TsrxNode | undefined
      // A `//` or `/* */` comment directly in JSX children, which the parser reports as a
      // container over an empty expression: the text is a comment, not a JSX expression, and a
      // `{` or `<` inside it would fail the parse.
      if (position === 'jsx-child' && expression?.type === 'JSXEmptyExpression') {
        blank(n.start, n.end)
        return
      }
      if (expression) walk(expression, n, 'expression')
      return
    }

    // Everything else — statements, declarations, plain expressions — keeps its text; only its
    // children may hold template syntax.
    for (const [childKey, value] of Object.entries(n)) {
      if (
        childKey === 'loc' ||
        childKey === 'metadata' ||
        childKey === 'css' ||
        childKey === 'innerComments' ||
        childKey === 'content'
      ) {
        continue
      }
      walk(value, n, childKey)
    }
  }

  const lowerIfChain = (node: TsrxNode) => {
    walk(node.test, node, 'test')
    walk(node.consequent, node, 'consequent')
    const alternate = node.alternate as TsrxNode | null | undefined
    if (!alternate) return
    // `@else if`/`@else`: the `@` sits in the gap before `alternate` (or in `alternateKeyword`).
    const keyword = node.alternateKeyword as TsrxNode | null | undefined
    if (keyword) dropAt(keyword.start, keyword.end)
    else dropAt((node.consequent as TsrxNode).end, alternate.start)
    if (alternate.type === 'IfStatement') lowerIfChain(alternate)
    else walk(alternate, node, 'alternate')
  }

  const lowerFor = (node: TsrxNode) => {
    const body = node.body as TsrxNode
    // The `; index i; key k` header suffix: everything from the last real header part to `)`.
    const lastPart = (node.right ?? node.update ?? node.test ?? node.init) as TsrxNode | undefined
    if (lastPart) {
      const closeParen = code.lastIndexOf(')', body.start)
      if (closeParen > lastPart.end) blank(lastPart.end, closeParen)
    }
    const index = node.index as TsrxNode | null | undefined
    const keyExpr = node.key as TsrxNode | null | undefined
    if (index || keyExpr) {
      const declared = index ? ` let ${code.slice(index.start, index.end)}!: number;` : ' '
      const key = keyExpr ? ` (${code.slice(keyExpr.start, keyExpr.end)});` : ''
      insert(body.start + 1, `${declared}${key}`)
    }
    walk(node.left, node, 'left')
    walk(node.right, node, 'right')
    walk(node.init, node, 'init')
    walk(node.test, node, 'test')
    walk(node.update, node, 'update')
    walk(body.body, body, 'body')
    const empty = node.empty as TsrxNode | null | undefined
    if (empty) {
      // `@empty` has no statement to keep: the gap becomes whitespace and `{E}` a bare block.
      const keyword = node.emptyKeyword as TsrxNode | null | undefined
      blank(keyword ? keyword.start : body.end, keyword ? keyword.end : empty.start)
      walk(empty.body, empty, 'body')
    }
  }

  walk(program, null, 'body')

  if (edits.length === 0) return code
  // Non-overlapping only: an edit inside a range another edit already rewrites is dropped (an
  // attribute or expression inside a blanked `<script>` body, say).
  const accepted: Edit[] = []
  let cursor = -1
  const order = (a: Edit, b: Edit) =>
    a.start - b.start || Number(a.end !== a.start) - Number(b.end !== b.start) || b.end - a.end
  for (const edit of [...edits].sort(order)) {
    // A zero-width insert only conflicts when it falls strictly inside an accepted non-empty
    // edit; sorted ahead of a same-start replacement, its text lands before it. Of two
    // non-empty edits with the same start, the enclosing one wins.
    if (edit.start < cursor) continue
    accepted.push(edit)
    cursor = Math.max(cursor, edit.end)
  }
  let output = code
  for (const edit of [...accepted].reverse()) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)
  }
  return output
}
