import { JsxOpeningElement, JsxSelfClosingElement, Node } from '@bamboocss/ts-ast'
import type { PrimitiveType } from './types'

type Nullable<T> = T | null | undefined

export const isNotNullish = <T>(element: Nullable<T>): element is T => element != null
export const isNullish = <T>(element: Nullable<T>): element is null | undefined => element == null
export const isTruthyOrZero = <T>(element: T): element is T => !!element || element === 0

/** Returns true if typeof value is object && not null */
export const isObject = (value: any): value is object => value != null && typeof value === 'object'

export const isArray = (value: any): value is any[] => Array.isArray(value)

export const isPrimitiveType = (value: unknown): value is PrimitiveType => {
  const type = typeof value
  return type === 'string' || type === 'number' || type === 'boolean' || value === null || value === undefined
}

export const unwrapExpression = (node: Node): Node => {
  // Object as any => Object
  if (Node.isAsExpression(node)) {
    return unwrapExpression(node.expression)
  }

  // (Object) => Object
  if (Node.isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression)
  }

  // "red"! => "red"
  if (Node.isNonNullExpression(node)) {
    return unwrapExpression(node.expression)
  }

  // <T>Object => Object
  if (Node.isTypeAssertion(node)) {
    return unwrapExpression(node.expression)
  }

  // xxx satisfies yyy -> xxx
  if (Node.isSatisfiesExpression(node)) {
    return unwrapExpression(node.expression)
  }

  return node
}

export const getComponentName = (node: JsxOpeningElement | JsxSelfClosingElement) => {
  return node.tagName.getText()
}

const whitespaceRegex = /\s+/g
export const trimWhitespace = (str: string) => {
  return str.replaceAll(whitespaceRegex, ' ')
}
