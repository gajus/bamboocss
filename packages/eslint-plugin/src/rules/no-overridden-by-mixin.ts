import { isImportant } from '@bamboocss/shared'
import { type TSESTree } from '@typescript-eslint/utils'
import { type RuleFix, type RuleFixer } from '@typescript-eslint/utils/ts-eslint'
import { createRule } from '../utils'
import { getOverriddenByMixin, isBambooAttribute } from '../utils/helpers'

export const RULE_NAME = 'no-overridden-by-mixin'

/** The name a key is written as, unless it is computed. */
const keyName = (property: TSESTree.Property): string | undefined => {
  if (property.computed) return undefined
  if (property.key.type === 'Identifier') return property.key.name
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value
  return undefined
}

/** A string the build reads as written: a literal, or a template with nothing interpolated. */
const literalString = (node: TSESTree.Node): string | undefined => {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? undefined
  return undefined
}

/** What a `mixin` key applies, when it is written out: a name, or names chosen per condition. */
const mixinValue = (node: TSESTree.Node): Record<string, string> | string | undefined => {
  const name = literalString(node)
  if (name !== undefined) return name
  if (node.type !== 'ObjectExpression') return undefined
  const chosen: Record<string, string> = {}
  for (const property of node.properties) {
    if (property.type !== 'Property') return undefined
    const condition = keyName(property)
    const value = literalString(property.value)
    if (condition === undefined || value === undefined) return undefined
    chosen[condition] = value
  }
  return chosen
}

interface Declaration {
  /** Where to report it: the key naming the value. */
  node: TSESTree.Property
  keys: string[]
  important: boolean
}

/** Each declaration `property` writes, with the keys from the object it is written in down to it. */
const declarationsOf = (property: TSESTree.Property, keys: string[] = [], into: Declaration[] = []) => {
  const name = keyName(property)
  if (name === undefined) return into
  const path = [...keys, name]
  if (property.value.type === 'ObjectExpression') {
    for (const inner of property.value.properties) {
      if (inner.type === 'Property') declarationsOf(inner, path, into)
    }
    return into
  }
  const value = literalString(property.value)
  into.push({ important: value !== undefined && isImportant(value), keys: path, node: property })
  return into
}

const rule = createRule({
  create(context) {
    const { sourceCode } = context

    /**
     * Write the mixin first in its object, which is what the properties it overrode meant: each of
     * them then follows it, and wins. Only where nothing before the mixin is a spread or a computed
     * key, whose keys the mixin would now precede unread, and no comment lies between it and the
     * key before it, which moving the mixin would leave stranded.
     */
    const moveFirst = (object: TSESTree.ObjectExpression, mixin: TSESTree.Property, index: number) => {
      const before = object.properties.slice(0, index)
      if (before.some((property) => property.type !== 'Property' || property.computed)) return undefined
      const first = before[0]!
      const previous = before.at(-1)!
      if (
        sourceCode
          .getTokensBetween(previous, mixin, { includeComments: true })
          .some((token) => token.type === 'Block' || token.type === 'Line')
      ) {
        return undefined
      }

      const text = sourceCode.getText(mixin)
      const onItsOwnLine = first.loc.start.line !== object.loc.start.line
      const indentation = sourceCode.lines[first.loc.start.line - 1]!.slice(0, first.loc.start.column)
      const separator = onItsOwnLine ? `,\n${indentation}` : ', '

      return (fixer: RuleFixer): RuleFix[] => [
        fixer.insertTextBefore(first, `${text}${separator}`),
        fixer.removeRange([previous.range[1], mixin.range[1]]),
      ]
    }

    return {
      Property(node: TSESTree.Property) {
        if (keyName(node) !== 'mixin') return
        const object = node.parent
        if (object?.type !== 'ObjectExpression') return
        // Of two `mixin` keys the object holds the last.
        const index = object.properties.indexOf(node)
        if (
          object.properties
            .slice(index + 1)
            .some((property) => property.type === 'Property' && keyName(property) === 'mixin')
        ) {
          return
        }
        if (index === 0) return

        const mixin = mixinValue(node.value)
        if (mixin === undefined) return
        if (!isBambooAttribute(node, context)) return

        const declarations = object.properties
          .slice(0, index)
          .flatMap((property) => (property.type === 'Property' ? declarationsOf(property) : []))
        if (declarations.length === 0) return

        const overridden = getOverriddenByMixin(
          context,
          mixin,
          declarations.map(({ important, keys }) => ({ important, keys })),
        )
        if (overridden.length === 0) return

        const fix = moveFirst(object, node, index)
        for (const { index: at, property } of overridden) {
          context.report({
            data: { mixin: sourceCode.getText(node.value), property },
            fix,
            messageId: 'overridden',
            node: declarations[at]!.node.key,
          })
        }
      },
    }
  },
  defaultOptions: [],
  meta: {
    docs: {
      description: 'Disallow a property a mixin written after it in the same object overrides',
    },
    fixable: 'code',
    messages: {
      overridden:
        '`{{property}}` is overridden by `mixin: {{mixin}}`, written after it, which sets it too, so this one does nothing. Write the mixin first, or `{{property}}` after it.',
    },
    schema: [],
    type: 'problem',
  },
  name: RULE_NAME,
})

export default rule
