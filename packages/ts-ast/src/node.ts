import * as predicates from '@typescript/api/unstable/ast/is'
import type { ImportDeclaration, SourceFile } from '@typescript/api/unstable/ast'
import type { Node as AstNode } from './types'

/**
 * The predicates, under the spelling the extractor already uses.
 *
 * ts-morph exposes them as statics on `Node` — `Node.isIdentifier(x)` — and TypeScript 7 as
 * free functions in `unstable/ast/is`. The names match after the namespace, so this is a
 * rebinding rather than a translation, and the 349 predicates arrive whether or not bamboo has
 * a use for each one.
 *
 * Deliberately not a class. ts-morph's `Node` is a wrapper allocated per node as you walk, and
 * that allocation — not the parse — is what it charges for; the AST-backend benchmark measures
 * the difference at 1.79x. TypeScript 7 hands back lazy views over a binary buffer, so the only
 * way to keep that win is to pass those views through untouched. Everything here is therefore a
 * function over a node, never a thing that owns one.
 */
export const is = predicates

/**
 * The same predicates under ts-morph's spelling, so the call sites do not have to move.
 *
 * ts-morph exposes them as statics on a `Node` class — `Node.isIdentifier(x)` — and bamboo
 * writes that 438 times. Rebinding the namespace rather than rewriting those call sites means
 * the backend swap reaches them through the import statement alone, which is 438 fewer chances
 * to change a predicate while changing a backend.
 *
 * Merged with the type of the same name below, exactly as ts-morph's class was both.
 */
export const Node = predicates

/** The type half of the merge, so `Node` names both the predicates and what they narrow. */
export type Node = AstNode

/**
 * ts-morph spells the parent and the kind as getters; TypeScript 7 spells them as properties.
 *
 * Kept as functions rather than asking every call site to know which backend it is on, and
 * because a property access that might throw on an absent parent reads worse at 23 call sites
 * than one that returns `undefined`.
 */
export const getParent = (node: Node): Node | undefined => node.parent
export const getKind = (node: Node): number => node.kind

/**
 * Every node beneath this one, in source order.
 *
 * `forEachChild` visits *named* children only — it skips punctuation and keyword tokens, which
 * is what makes it cheaper than materializing `getChildren()`. Nothing the extractor looks for
 * is a bare token, so the cheaper walk is also the correct one; `getDescendantsOfKind` below
 * relies on the same thing.
 */
export const forEachDescendant = (node: Node, visit: (child: Node) => void): void => {
  node.forEachChild((child: Node) => {
    visit(child)
    forEachDescendant(child, visit)
  })
}

/** The descendants of one kind, collected. `SyntaxKind` values are the TypeScript 7 numbering. */
export const getDescendantsOfKind = (node: Node, kind: number): Node[] => {
  const found: Node[] = []
  forEachDescendant(node, (child) => {
    if (child.kind === kind) found.push(child)
  })
  return found
}

/**
 * The first ancestor satisfying a predicate, or `undefined`.
 *
 * Walks `parent` rather than re-descending from the source file, which is why parent pointers
 * mattered when choosing this backend: TypeScript 7's nodes are views over a buffer and could
 * as easily have omitted them.
 */
export const getFirstAncestor = (node: Node, matches: (ancestor: Node) => boolean): Node | undefined => {
  let current = node.parent
  while (current) {
    if (matches(current)) return current
    current = current.parent
  }
  return undefined
}

/** The import declarations of a source file, without walking past the top level. */
export const getImportDeclarations = (sourceFile: SourceFile): ImportDeclaration[] =>
  sourceFile.statements.filter((statement) => predicates.isImportDeclaration(statement))

/**
 * The module a declaration imports from, as written.
 *
 * `moduleSpecifier` is a string literal node, so `.text` is the value with the quotes already
 * removed — the same thing ts-morph's `getModuleSpecifierValue()` returns.
 */
export const getModuleSpecifierValue = (declaration: ImportDeclaration): string | undefined =>
  predicates.isStringLiteral(declaration.moduleSpecifier) ? declaration.moduleSpecifier.text : undefined
