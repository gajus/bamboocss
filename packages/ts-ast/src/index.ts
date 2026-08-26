export {
  forEachDescendant,
  getDescendantsOfKind,
  getDefaultImport,
  getExportDeclarations,
  getFirstAncestor,
  getFirstAncestorByKind,
  getImportDeclarations,
  getLineAndColumnAtPos,
  getLiteralText,
  getName,
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
