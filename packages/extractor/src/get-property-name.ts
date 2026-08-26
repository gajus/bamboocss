import type { ObjectLiteralElementLike } from '@bamboocss/ts-ast'
import { Node, getLiteralText, getName } from '@bamboocss/ts-ast'
import { box } from './box'
import { maybePropName } from './maybe-box-node'
import type { BoxContext } from './types'
import { unwrapExpression } from './utils'

export const getPropertyName = (property: ObjectLiteralElementLike, stack: Node[], ctx: BoxContext) => {
  if (!property) return

  if (Node.isPropertyAssignment(property)) {
    const node = unwrapExpression(property.name)

    // { propName: "value" }
    if (Node.isIdentifier(node)) return box.from(node.getText(), node, stack)

    // { [computed]: "value" }
    if (Node.isComputedPropertyName(node)) {
      const expression = node.expression
      stack.push(expression)
      return maybePropName(expression, stack, ctx)
    }

    // { "propName": "value" }
    if (Node.isStringLiteral(node) || Node.isNumericLiteral(node)) return box.from(getLiteralText(node), node, stack)
  }

  if (Node.isShorthandPropertyAssignment(property)) {
    const name = getName(property)
    if (name != null) return box.from(name, property, stack)
  }

  if (Node.isGetAccessorDeclaration(property)) {
    const node = unwrapExpression(property.name)

    if (Node.isIdentifier(node)) return box.from(node.getText(), node, stack)

    if (Node.isComputedPropertyName(node)) {
      const expression = node.expression
      stack.push(expression)
      return maybePropName(expression, stack, ctx)
    }

    if (Node.isStringLiteral(node) || Node.isNumericLiteral(node)) return box.from(getLiteralText(node), node, stack)
  }
}
