export {
  forEachDescendant,
  getDescendantsOfKind,
  getFirstAncestor,
  getImportDeclarations,
  getKind,
  getModuleSpecifierValue,
  getParent,
  is,
  Node,
} from './node'
export { Project } from './project'
export { createResolver } from './resolve'
export type { ResolvedModule, ResolveOptions } from './resolve'
export type { FileSystemDelegate, ProjectOptions, SourceFile } from './types'

export { ScriptKind, ScriptTarget, SyntaxKind } from '@typescript/api/unstable/ast'
