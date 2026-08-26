import type { JsxAttribute } from '@bamboocss/ts-ast'
import { Node, getLiteralText } from '@bamboocss/ts-ast'
import { box } from './box'
import { maybeBoxNode } from './maybe-box-node'
import type { BoxContext } from './types'
import { trimWhitespace, unwrapExpression } from './utils'

// <ColorBox color="red.200" backgroundColor="blackAlpha.100" />
//           ^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// identifier = `color` (and then backgroundColor)
// parent = `color="red.200"` (and then backgroundColor="blackAlpha.100")

export const extractJsxAttribute = (jsxAttribute: JsxAttribute, ctx: BoxContext) => {
  const initializer = jsxAttribute.initializer
  const stack = [jsxAttribute, initializer] as Node[]

  if (!initializer) {
    const nameNode = jsxAttribute.name
    return box.emptyInitializer(nameNode, stack)
  }

  // <ColorBox color="red.200" />
  if (Node.isStringLiteral(initializer)) {
    const literalText = getLiteralText(initializer)
    return box.literal(trimWhitespace(literalText), initializer, stack)
  }

  // <ColorBox color={xxx} />
  if (Node.isJsxExpression(initializer)) {
    const expr = initializer.expression
    if (!expr) return

    const expression = unwrapExpression(expr)
    if (!expression) return

    stack.push(expression)

    const maybeValue = maybeBoxNode(expression, stack, ctx)
    if (maybeValue) return maybeValue
  }
}
