import * as ast from '@typescript/api/unstable/ast'
import * as predicates from '@typescript/api/unstable/ast/is'
import type { Node } from './types'

/**
 * The `ts` namespace, as `ts-evaluator` expects to be handed one.
 *
 * This exists for a single consumer. `evaluate-node.ts` passes it as ts-evaluator's `typescript`
 * option, and ts-evaluator was written against TypeScript 6's namespace — so the surface here is
 * not "what bamboo uses" but "what that library reaches for", which is a much larger and less
 * negotiable list. Everything below was taken from the names it actually calls.
 *
 * Most are rebindings: TypeScript 7 has the same predicates under different names. The rest are
 * reimplemented against TypeScript 7's kinds, because there is no equivalent to rebind.
 *
 * Two names it references are deliberately absent. `factory` and `createEmptyStatement` are
 * reached only when constructing an `AsyncIteratorNotSupportedError`, on a path bamboo cannot
 * take from a style expression, and the call site already optional-chains. Supplying a fake node
 * factory over a tree this process does not own would be worse than the `TypeError` — it would
 * hand the evaluator a node the compiler never made.
 *
 * Also deliberately absent is everything that assumed a compiler in this process —
 * `resolveModuleName`, `createModuleResolutionCache`, `sys`. Module resolution is
 * `createResolver` now, and a shim that pretended otherwise would be a second resolver
 * disagreeing with the first.
 *
 * ⚠️ `SyntaxKind` values are renumbered between TypeScript 6 and 7 — `Identifier` is 80 there
 * and 79 here, `StringLiteral` 11 and 10. Nothing may compare a kind from one against a kind
 * from the other, which is why the migration had to swap every import at once rather than a
 * package at a time.
 */

/** Nodes that carry `modifiers`, which in TypeScript 7 holds decorators alongside modifiers. */
type WithModifiers = Node & { modifiers?: readonly Node[]; name?: Node }

/** The declaration kinds, as TypeScript's own `isDeclarationKind` enumerates them. */
const isDeclaration = (node: Node): boolean =>
  predicates.isVariableDeclaration(node) ||
  predicates.isParameterDeclaration(node) ||
  predicates.isBindingElement(node) ||
  predicates.isPropertyDeclaration(node) ||
  predicates.isPropertyAssignment(node) ||
  predicates.isShorthandPropertyAssignment(node) ||
  predicates.isFunctionLikeDeclaration(node) ||
  predicates.isClassLikeDeclaration(node) ||
  predicates.isInterfaceDeclaration(node) ||
  predicates.isTypeAliasDeclaration(node) ||
  predicates.isTypeParameterDeclaration(node) ||
  predicates.isEnumDeclaration(node) ||
  predicates.isEnumMember(node) ||
  predicates.isModuleDeclaration(node) ||
  predicates.isImportEqualsDeclaration(node) ||
  predicates.isImportClause(node) ||
  predicates.isNamespaceImport(node) ||
  predicates.isImportSpecifier(node) ||
  predicates.isExportSpecifier(node) ||
  predicates.isNamespaceExportDeclaration(node) ||
  predicates.isExportAssignment(node) ||
  predicates.isJsxAttribute(node)

/**
 * An elided slot in an array binding pattern — the gap in `([, value]) => value`.
 *
 * TypeScript 6 gave that slot its own node, `OmittedExpression`. TypeScript 7 keeps it as a
 * `BindingElement` with no `name`, and a `BindingElement` without a name is exactly and only a
 * hole, since `name` is required for every element that binds anything.
 */
const isHole = (node: Node): boolean =>
  predicates.isBindingElement(node) && (node as { name?: Node }).name === undefined

/** Kinds that may carry a decorator, as TypeScript's `canHaveDecorators` lists them. */
const canHaveDecorators = (node: Node): boolean =>
  predicates.isParameterDeclaration(node) ||
  predicates.isPropertyDeclaration(node) ||
  predicates.isMethodDeclaration(node) ||
  predicates.isGetAccessorDeclaration(node) ||
  predicates.isSetAccessorDeclaration(node) ||
  predicates.isClassExpression(node) ||
  predicates.isClassDeclaration(node)

const compat = {
  /**
   * A kind's canonical name.
   *
   * Not `SyntaxKind[kind]`. Several kinds share a numeric value with a range marker —
   * `NumericLiteral` is also `FirstLiteralToken`, `Identifier` is also `FirstNode` — and a
   * reverse lookup answers with whichever name the enum declared last. ts-morph's
   * `getKindName()` returned the real one, and this string reaches snapshots and diagnostics.
   */
  formatSyntaxKind: ast.formatSyntaxKind,

  /** TypeScript 7 spells the type guard `isStringLiteralLikeNode`. */
  isStringLiteralLike: predicates.isStringLiteralLikeNode,
  isParameter: predicates.isParameterDeclaration,
  isClassLike: predicates.isClassLikeDeclaration,
  isTypeAssertionExpression: predicates.isTypeAssertion,
  /** `isExpression` here; the 6-era name described the same test. */
  isExpressionNode: predicates.isExpression,

  isDeclaration,
  canHaveDecorators,

  /**
   * A hole in an array binding pattern — the elided slot in `([, value]) => value`.
   *
   * TypeScript 6 gave that slot its own node, `OmittedExpression`, and ts-evaluator tests for
   * it to know there is nothing to bind. TypeScript 7 keeps the slot as a `BindingElement` with
   * no `name` instead, so the 6-era test answers `false` and the evaluator tries to bind a
   * nameless element — the whole call then fails to evaluate, and a `clsx`-style helper that
   * filters entries with `([, value]) => …` silently contributes no classes.
   *
   * A `BindingElement` without a name is exactly and only a hole: `name` is required for every
   * element that binds anything.
   */
  isOmittedExpression: ((node: Node): boolean =>
    predicates.isOmittedExpression(node) || isHole(node)) as typeof predicates.isOmittedExpression,

  /**
   * A hole is not a binding element, which is the half that actually matters.
   *
   * ts-evaluator dispatches on `isBindingElement` *before* `isOmittedExpression`, so leaving
   * this alone sends every hole into the binding path, where it reads `node.name.text` off an
   * element that has no name. Declining here is what lets the hole reach the branch written
   * for it — and it is faithful, not a workaround: in the tree ts-evaluator was written
   * against, a hole was never a `BindingElement` in the first place.
   */
  isBindingElement: ((node: Node): boolean =>
    predicates.isBindingElement(node) && !isHole(node)) as typeof predicates.isBindingElement,

  /**
   * A statement that is not also a declaration.
   *
   * `function f() {}` is both, and ts-evaluator relies on the distinction to decide whether a
   * node is executed or merely bound — so this cannot be `isStatement` alone.
   */
  isStatementButNotDeclaration: (node: Node): boolean => predicates.isStatement(node) && !isDeclaration(node),

  /** Every kind can be asked for modifiers; only some can hold them. */
  canHaveModifiers: (node: Node): boolean => 'modifiers' in node,

  /** Decorators and modifiers share one list in TypeScript 7, so each accessor filters it. */
  getDecorators: (node: Node): readonly Node[] | undefined =>
    canHaveDecorators(node) ? (node as WithModifiers).modifiers?.filter(predicates.isDecorator) : undefined,

  getModifiers: (node: Node): readonly Node[] | undefined =>
    (node as WithModifiers).modifiers?.filter((modifier) => !predicates.isDecorator(modifier)),

  /** The declared name, for the declarations that have one. */
  getNameOfDeclaration: (declaration: Node | undefined): Node | undefined =>
    declaration === undefined ? undefined : (declaration as WithModifiers).name,

  /**
   * A node's flags, folded together with those of the declaration list and statement above it.
   *
   * `const` and `let` live on the `VariableDeclarationList`, not on the declaration, so reading
   * a declaration's own flags answers `None` for every variable in the program.
   */
  getCombinedNodeFlags: (node: Node | undefined): number => {
    let current = node
    let flags = current?.flags ?? 0
    if (current && predicates.isVariableDeclaration(current)) current = current.parent as Node | undefined
    if (current && predicates.isVariableDeclarationList(current)) {
      flags |= current.flags
      current = current.parent as Node | undefined
    }
    if (current && predicates.isVariableStatement(current)) flags |= current.flags
    return flags
  },

  /** The nearest enclosing node the callback accepts. `'quit'` stops the walk without a match. */
  findAncestor: (node: Node | undefined, callback: (element: Node) => boolean | 'quit'): Node | undefined => {
    let current = node
    while (current) {
      const result = callback(current)
      if (result === 'quit') return undefined
      if (result) return current
      current = current.parent as Node | undefined
    }
    return undefined
  },

  /** A specifier that names a path rather than a package — `./x`, `../x`, or a rooted path. */
  isExternalModuleNameRelative: (moduleName: string): boolean =>
    /^\.\.?($|[\\/])/.test(moduleName) || /^([a-zA-Z]:)?[\\/]/.test(moduleName),
}

export const ts: typeof predicates &
  typeof compat & {
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
  ...compat,
}
