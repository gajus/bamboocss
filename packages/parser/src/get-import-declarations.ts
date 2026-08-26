import { resolveTsPathPattern } from '@bamboocss/config/ts-path'
import type { ImportResult, ParserOptions } from '@bamboocss/core'
import type { SourceFile } from '@bamboocss/ts-ast'
import {
  getAliasNode,
  getImportDeclarations,
  getModuleSpecifierValue,
  getNamedImports,
  getNamespaceImport,
} from '@bamboocss/ts-ast'
import { getModuleSpecifierValue } from './get-module-specifier-value'

export function getImportDeclarations(context: ParserOptions, sourceFile: SourceFile) {
  const { imports, tsOptions } = context

  const importDeclarations: ImportResult[] = []

  getImportDeclarations(sourceFile).forEach((node) => {
    const mod = getModuleSpecifierValue(node)
    if (!mod) return

    // import { flex, stack } from "styled-system/patterns"
    getNamedImports(node).forEach((specifier) => {
      const name = specifier.name.getText()
      const alias = getAliasNode(specifier)?.getText() || name

      const result: ImportResult = { name, alias, mod, kind: 'named' }

      const found = imports.match(result, (mod) => {
        if (!tsOptions?.pathMappings) return
        return resolveTsPathPattern(tsOptions.pathMappings, mod)
      })

      if (!found) return

      importDeclarations.push(result)
    })

    // import * as p from "styled-system/patterns
    const namespace = getNamespaceImport(node)
    if (namespace) {
      const name = namespace.getText()
      const result: ImportResult = { name, alias: name, mod, kind: 'namespace' }

      const found = imports.match(result, (mod) => {
        if (!tsOptions?.pathMappings) return
        return resolveTsPathPattern(tsOptions.pathMappings, mod)
      })

      if (!found) return

      importDeclarations.push(result)
    }
  })

  return importDeclarations
}
