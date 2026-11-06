import { type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../utils'
import { isBambooImport, isValidFile, resolveReference } from '../utils/helpers'
import {
  isArrayExpression,
  isCallExpression,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isMemberExpression,
} from '../utils/nodes'

export const RULE_NAME = 'no-unlayered-override'

/**
 * Functions from npm that, like the runtime `cx`, put class names side by side and resolve
 * nothing between them. `cn` is the name projects give a `clsx` wrapper.
 */
const CLASS_JOINERS = new Set(['clsx', 'classnames', 'classNames', 'cn'])

/** The operands of `a + b + c`, however it is parenthesized. */
const operandsOf = (node: TSESTree.Node): TSESTree.Node[] =>
  node.type === 'BinaryExpression' && node.operator === '+'
    ? [...operandsOf(node.left), ...operandsOf(node.right)]
    : [node]

/**
 * A class this file styled with `css()`, joined with one it cannot see.
 *
 * Both are in the `utilities` layer, so which applies is decided by stylesheet order. The Vite
 * compiler merges the styles a `cx()` call holds and keeps the atoms it joins with an outside class
 * in the entry sheet when it splits the stylesheet per route. A join it does not see — a template
 * literal, `+`, `clsx` — gets neither, and can resolve differently depending on the route the
 * visitor opened first. So every one of them is reported, and `cx` under an alias as well.
 *
 * Styles this file owns are a `css()` call, or a `const` this file declares holding one:
 * `cx(styles, className)` is the forwarding a component does, and `cx(css(…), styles)` joins two
 * of the file's own. A name is read as the code reads it, so a parameter that shadows such a
 * binding is a value the rule cannot see. A binding imported from another module is not
 * followed, as this rule reads one file.
 *
 * Recipe results are not reported, though they collide the same way: a recipe compiles to the same
 * `utilities` atoms as `css()`, and there is no `recipes` layer for a consumer's class to beat it
 * from. Reporting them is a decision of its own.
 */
const rule = createRule({
  create(context) {
    if (!isValidFile(context)) return {}

    let names: { css: Set<string>; cx: Set<string> } | undefined
    /** Bamboo's `css` and `cx` under the names this file gives them. */
    const bambooNames = () => {
      if (names) return names
      names = { css: new Set(['css']), cx: new Set(['cx']) }
      for (const statement of context.sourceCode.ast.body) {
        if (!isImportDeclaration(statement) || !isBambooImport(statement, context)) continue
        for (const specifier of statement.specifiers) {
          if (!isImportSpecifier(specifier)) continue
          const imported = isIdentifier(specifier.imported) ? specifier.imported.name : String(specifier.imported.value)
          if (imported === 'css') names.css.add(specifier.local.name)
          if (imported === 'cx') names.cx.add(specifier.local.name)
        }
      }
      return names
    }

    /** A part that may be styles this file owns, before asking which names are Bamboo's. */
    const isCandidate = (node: TSESTree.Node | null): node is TSESTree.CallExpression | TSESTree.Identifier =>
      node !== null && ((isCallExpression(node) && isIdentifier(node.callee)) || isIdentifier(node))

    const isStyleCall = (node: TSESTree.Node | null | undefined) =>
      node != null && isCallExpression(node) && isIdentifier(node.callee) && bambooNames().css.has(node.callee.name)

    /** A `const` this file declares holding a `css()` call. */
    const isStyleBinding = (node: TSESTree.Identifier) => {
      const variable = resolveReference(node, context)
      if (!variable || variable.defs.length !== 1) return false
      const [definition] = variable.defs
      return definition?.type === 'Variable' && definition.parent.kind === 'const' && isStyleCall(definition.node.init)
    }

    const isOwnStyles = (node: TSESTree.Node) =>
      isIdentifier(node) ? node.name !== 'undefined' && isStyleBinding(node) : isStyleCall(node)

    /**
     * A part the rule cannot see the styles behind: a prop, a parameter, anything whose value
     * arrives at runtime. `props.className` is the shape this exists for.
     */
    const isOpaque = (node: TSESTree.Node) =>
      isMemberExpression(node) || (isIdentifier(node) && node.name !== 'undefined' && !isStyleBinding(node))

    const check = (parts: ReadonlyArray<TSESTree.Node | null>, join: string) => {
      const candidates = parts.filter(isCandidate)
      if (candidates.length === 0) return
      const own = candidates.find(isOwnStyles)
      if (!own) return
      if (!parts.some((part) => part !== null && part !== own && isOpaque(part))) return
      context.report({ data: { join }, messageId: 'unlayeredOverride', node: own })
    }

    return {
      BinaryExpression(node: TSESTree.BinaryExpression) {
        if (node.operator !== '+') return
        // The outermost `+` of a chain reads all of it.
        if (node.parent?.type === 'BinaryExpression' && node.parent.operator === '+') return
        check(operandsOf(node), 'Concatenating with `+`')
      },
      CallExpression(node: TSESTree.CallExpression) {
        const { callee } = node
        if (isIdentifier(callee)) {
          if (node.arguments.length < 2 || !node.arguments.some(isCandidate)) return
          const { name } = callee
          if (!CLASS_JOINERS.has(name) && !bambooNames().cx.has(name)) return
          check(node.arguments, `\`${name}\``)
          return
        }
        // `[styles, className].join(' ')`
        if (
          isMemberExpression(callee) &&
          !callee.computed &&
          isIdentifier(callee.property) &&
          callee.property.name === 'join' &&
          isArrayExpression(callee.object)
        ) {
          check(callee.object.elements, 'An array `join()`')
        }
      },
      TemplateLiteral(node: TSESTree.TemplateLiteral) {
        if (node.parent?.type === 'TaggedTemplateExpression') return
        check(node.expressions, 'A template literal')
      },
    }
  },
  defaultOptions: [],
  meta: {
    docs: {
      description:
        'Disallow joining a class this file styled with a class it cannot see, where neither can win by cascade layer.',
    },
    messages: {
      unlayeredOverride: [
        '{{join}} joins class names, it does not resolve conflicts between them.',
        'These styles and the ones being joined are both in the `utilities` layer, so which applies is decided by stylesheet order rather than by the caller.',
        'For an override the caller chooses, expose a recipe variant instead of accepting a class name; to combine styles this file owns, pass them all to `cx()` as style calls, which the compiler merges per property.',
      ].join(' '),
    },
    schema: [],
    type: 'problem',
  },
  name: RULE_NAME,
})

export default rule
