import type { Node } from '@bamboocss/ts-ast'
import { getLineAndColumnAtPos } from '@bamboocss/ts-ast'

export const getNodeRange = (node: Node) => {
  const src = node.getSourceFile()
  const [startPosition, endPosition] = [node.getStart(), node.getEnd()]

  const startInfo = getLineAndColumnAtPos(src, startPosition)
  const endInfo = getLineAndColumnAtPos(src, endPosition)

  return {
    startPosition,
    startLineNumber: startInfo.line,
    startColumn: startInfo.column,
    endPosition,
    endLineNumber: endInfo.line,
    endColumn: endInfo.column,
  }
}

export type NodeRange = ReturnType<typeof getNodeRange>
