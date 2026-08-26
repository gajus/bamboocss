import * as ast from '@typescript/api/unstable/ast'
import * as predicates from '@typescript/api/unstable/ast/is'
import type { Node } from './types'

/**
 * The `ts` namespace, narrowed to what bamboo reached for.
 *
 * ts-morph re-exported the whole TypeScript 6 namespace and the extractor used a corner of it:
 * `SyntaxKind`, a handful of predicates, `forEachChild`, and the script/target enums. Those all
 * exist on TypeScript 7's AST surface under the same names, so this is a rebinding.
 *
 * What is deliberately absent is everything that assumed a compiler in this process —
 * `resolveModuleName`, `createModuleResolutionCache`, `sys`. Module resolution is
 * `createResolver` now, and a shim that pretended otherwise would be a second resolver
 * disagreeing with the first.
 *
 * ⚠️ `SyntaxKind` values are renumbered between TypeScript 6 and 7 — `Identifier` is 80 there
 * and 79 here, `StringLiteral` 11 and 10. Nothing may compare a kind from one against a kind
 * from the other, which is why the migration had to swap every import at once rather than a
 * package at a time.
 */
export const ts: typeof predicates & {
  SyntaxKind: typeof ast.SyntaxKind
  ScriptKind: typeof ast.ScriptKind
  ScriptTarget: typeof ast.ScriptTarget
  NodeFlags: typeof ast.NodeFlags
  forEachChild: <T>(node: Node, visit: (child: Node) => T | undefined) => T | undefined
} = {
  SyntaxKind: ast.SyntaxKind,
  ScriptKind: ast.ScriptKind,
  ScriptTarget: ast.ScriptTarget,
  NodeFlags: ast.NodeFlags,
  forEachChild: <T>(node: Node, visit: (child: Node) => T | undefined): T | undefined =>
    node.forEachChild(visit as never) as T | undefined,
  ...predicates,
}
