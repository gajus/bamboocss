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

/**
 * A literal's value, with the type ts-morph gave it.
 *
 * Not a rename of `getLiteralValue()` to `.text`, which is what the shape of the two APIs
 * invites. `.text` is a string for every literal kind, while ts-morph returned a number for a
 * numeric literal and a boolean for `true`/`false` — so the tempting sed turns
 * `<Box color={123} />` into the string `"123"` and `truncate={true}` into `undefined`. Both
 * reach `box.literal()`, which is a style value, which is emitted CSS. Three of the twenty call
 * sites are the non-string kinds.
 */
export const literalValueOf = (node: Node): string | number | boolean | undefined => {
  if (predicates.isNumericLiteral(node)) return Number(node.text)
  if (predicates.isTrueLiteral(node)) return true
  if (predicates.isFalseLiteral(node)) return false
  return (node as { text?: string }).text
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

/** The export declarations of a source file, without walking past the top level. */
export const getExportDeclarations = (sourceFile: SourceFile): Node[] =>
  sourceFile.statements.filter((statement) => predicates.isExportDeclaration(statement))

/** The nearest ancestor of a kind, or `undefined`. */
export const getFirstAncestorByKind = (node: Node, kind: number): Node | undefined =>
  getFirstAncestor(node, (ancestor) => ancestor.kind === kind)

/**
 * A declaration's name, as text.
 *
 * ts-morph's `getName()` answered for every named node by walking to whatever held the name;
 * here the name is a child node, so this reads its text and leaves the caller to decide what an
 * absent name means. Computed and string-literal names answer with their own text, which is what
 * a property key needs.
 */
export const getName = (node: Node): string | undefined => {
  const name = (node as { name?: Node }).name
  if (!name) return undefined
  if (predicates.isIdentifier(name) || predicates.isStringLiteral(name) || predicates.isNumericLiteral(name)) {
    return name.text
  }
  return name.getText()
}

/**
 * A literal's source text, quotes and escapes included.
 *
 * The counterpart to `literalValueOf`: that one answers what the literal *means*, this one what
 * was written. `'a\\nb'` is two characters to the first and six to the second, and a caller that
 * confuses them either loses an escape or invents one.
 */
export const getLiteralText = (node: Node): string => node.getText()

/** 1-based line and column for an offset, for a diagnostic that names a place in a file. */
export const getLineAndColumnAtPos = (sourceFile: SourceFile, pos: number): { line: number; column: number } => {
  const upto = sourceFile.text.slice(0, pos)
  const lastBreak = upto.lastIndexOf('\n')
  return { line: upto.split('\n').length, column: pos - lastBreak }
}

/** The named bindings of an import — `import { a, b } from 'x'`. */
export const getNamedImports = (declaration: Node): Node[] => {
  const bindings = (declaration as { importClause?: { namedBindings?: Node } }).importClause?.namedBindings
  return bindings && predicates.isNamedImports(bindings) ? [...bindings.elements] : []
}

/** The default binding of an import — `import a from 'x'` — or `undefined`. */
export const getDefaultImport = (declaration: Node): Node | undefined =>
  (declaration as { importClause?: { name?: Node } }).importClause?.name

/** The namespace binding of an import — `import * as a from 'x'` — or `undefined`. */
export const getNamespaceImport = (declaration: Node): Node | undefined => {
  const bindings = (declaration as { importClause?: { namedBindings?: Node } }).importClause?.namedBindings
  return bindings && predicates.isNamespaceImport(bindings) ? (bindings as { name?: Node }).name : undefined
}

/** Whether an import or export specifier is `type`-only — `import { type A }`. */
export const isTypeOnly = (specifier: Node): boolean => (specifier as { isTypeOnly?: boolean }).isTypeOnly === true

/** The local alias of a specifier — the `b` in `import { a as b }` — or `undefined`. */
export const getAliasNode = (specifier: Node): Node | undefined => {
  const propertyName = (specifier as { propertyName?: Node }).propertyName
  return propertyName ? (specifier as { name?: Node }).name : undefined
}

/** The named specifiers of an export — `export { a, b }`. */
export const getNamedExports = (declaration: Node): Node[] => {
  const clause = (declaration as { exportClause?: Node }).exportClause
  return clause && predicates.isNamedExports(clause) ? [...(clause as { elements: Node[] }).elements] : []
}
