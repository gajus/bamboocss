export {
  forEachDescendant,
  getDescendantsOfKind,
  childOf,
  getChildIndex,
  getMember,
  getNamespaceExport,
  getVariableDeclaration,
  getVariableDeclarations,
  isInNodeModules,
  isReadonly,
  isStarExport,
  stringLiteralValue,
  getProperty,
  getDefaultImport,
  getExportDeclarations,
  getFirstAncestor,
  getFirstAncestorByKind,
  getImportDeclarations,
  getLineAndColumnAtPos,
  getLiteralText,
  getName,
  nameNodeOf,
  getNamedImports,
  getNamedExports,
  getNamespaceImport,
  isTypeOnly,
  getAliasNode,
  getKind,
  getModuleSpecifierValue,
  getParent,
  is,
  literalValueOf,
  Node,
} from './node'
export { Project } from './project'
export { ts } from './ts'
export { createResolver } from './resolve'
export type { ResolvedModule, ResolveOptions } from './resolve'
export type { FileSystemDelegate, ProjectOptions, SourceFile } from './types'

export { NodeFlags, ScriptKind, ScriptTarget, SyntaxKind } from '@typescript/api/unstable/ast'

/**
 * Every node type, under the names the extractor already imports.
 *
 * `CallExpression`, `Identifier`, `JsxOpeningElement` and the rest were types on ts-morph and
 * are types here; re-exporting the whole set is transcribing nothing, and a selective list would
 * need editing every time a call site narrows to a kind it did not before.
 */
export type * from '@typescript/api/unstable/ast'

/**
 * Types that live on the API surface rather than the AST one.
 *
 * `CompilerOptions` describes a project, not a tree, so TypeScript 7 keeps it with the client
 * rather than with the syntax — but bamboo imports it from the same place it imports nodes,
 * exactly as it did from ts-morph.
 */
export type { CompilerOptions } from '@typescript/api/unstable/sync'
