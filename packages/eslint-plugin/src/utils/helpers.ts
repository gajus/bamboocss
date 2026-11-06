import { type ImportResult, syncAction, syncActionUncached } from '.'
import {
  isCallExpression,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isJSXAttribute,
  isJSXExpressionContainer,
  isJSXIdentifier,
  isJSXMemberExpression,
  isJSXOpeningElement,
  isLiteral,
  isMemberExpression,
  isTemplateLiteral,
  isVariableDeclarator,
  type Node,
} from './nodes'
import { type DeprecatedToken, type ExtractionFindings } from './worker'
import { analyze, type ScopeManager, type Variable } from '@typescript-eslint/scope-manager'
import { type TSESTree } from '@typescript-eslint/utils'
import { type RuleContext } from '@typescript-eslint/utils/ts-eslint'

export const getAncestor = <N extends Node>(ofType: (node: Node) => node is N, for_: Node): N | undefined => {
  let current: Node | undefined = for_.parent
  while (current) {
    if (ofType(current)) {
      return current
    }

    current = current.parent
  }
}

const getSyncOptions = (context: RuleContext<any, any>) => {
  return {
    configPath: context.settings['@bamboocss/configPath'] as string | undefined,
    currentFile: context.filename,
    cwd: context.cwd,
  }
}

export const getImportSpecifiers = (context: RuleContext<any, any>) => {
  const specifiers: Array<{
    mod: string
    specifier: TSESTree.ImportSpecifier
  }> = []

  for (const node of context.sourceCode?.ast.body) {
    if (!isImportDeclaration(node)) {
      continue
    }

    const module_ = node.source.value
    if (!module_) {
      continue
    }

    for (const specifier of node.specifiers) {
      if (!isImportSpecifier(specifier)) {
        continue
      }

      specifiers.push({ mod: module_, specifier })
    }
  }

  return specifiers
}

export const hasPkgImport = (context: RuleContext<any, any>) => {
  const imports = _getImports(context)
  return imports.some(({ mod }) => mod === '@bamboocss/dev')
}

export const isBambooConfigFunction = (context: RuleContext<any, any>, name: string) => {
  const imports = _getImports(context)
  return imports.some(({ alias, mod }) => alias === name && mod === '@bamboocss/dev')
}

/**
 * What the per-file caches below are keyed by: the `SourceCode` the linter hands every rule linting
 * one version of a file.
 *
 * Not the rule's context. ESLint creates a context per rule per file, but oxlint creates one per rule
 * and passes it to `create` for every file, so a cache keyed by it held the first file's answer for
 * every file after it, and which file came first decided what each rule saw: `no-hardcoded-color`
 * reported 29 colors in one directory and none in its parent. oxlint's `context.sourceCode` is one
 * object throughout as well, and it has a `WeakMap` keyed by that object read per file, as ESLint's
 * own `SourceCode` per file is. A context without one keys by itself, as before.
 */
const fileKey = (context: RuleContext<any, any>): object => context.sourceCode ?? context

// Each file's imports as written, so the AST is walked once per file.
const rawImportsCache = new WeakMap<object, ImportResult[]>()

const _getImports = (context: RuleContext<any, any>) => {
  const key = fileKey(context)
  const cached = rawImportsCache.get(key)
  if (cached) return cached

  const specifiers = getImportSpecifiers(context)

  const imports: ImportResult[] = specifiers.map(({ mod, specifier }) => ({
    alias: specifier.local.name,
    mod,
    name: (specifier.imported as any).name,
  }))

  rawImportsCache.set(key, imports)
  return imports
}

// Each file's imports that reach bamboo, so the worker is asked once per file.
const importsCache = new WeakMap<object, ImportResult[]>()

const getImports = (context: RuleContext<any, any>): ImportResult[] => {
  const key = fileKey(context)
  const cached = importsCache.get(key)
  if (cached) return cached

  const imports = _getImports(context)
  // Batch filter all imports in a single sync call to reduce worker thread crossings
  const filteredImports = syncAction('filterImports', getSyncOptions(context), imports)
  // syncAction returns undefined when the worker fails (e.g. config loading error).
  // Fall back to an empty array to prevent downstream crashes.
  const result = filteredImports ?? []
  importsCache.set(key, result)
  return result
}

const isValidStyledProperty = <T extends Node>(node: T, context: RuleContext<any, any>) => {
  return isJSXIdentifier(node) && isValidProperty(node.name, context)
}

const matchFile = (name: string, imports: ImportResult[], context: RuleContext<any, any>) => {
  return syncAction('matchFile', getSyncOptions(context), name, imports)
}

const isBambooIsh = (name: string, context: RuleContext<any, any>) => {
  const imports = getImports(context)
  if (imports.length === 0) {
    return false
  }

  return matchFile(name, imports, context)
}

// Caching scope analysis per AST to avoid expensive re-computation
const scopeCache = new WeakMap<TSESTree.Program, ScopeManager>()

const scopeManagerOf = (context: RuleContext<any, any>) => {
  const source = context.sourceCode
  if (!source) return undefined
  let scope = scopeCache.get(source.ast)
  if (!scope) {
    scope = analyze(source.ast, {
      sourceType: 'module',
    })
    scopeCache.set(source.ast, scope)
  }
  return scope
}

/** What each identifier read in a file resolves to, by the scope analysis it was read in. */
const resolvedReferences = new WeakMap<ScopeManager, Map<TSESTree.Node, Variable | null>>()

/**
 * The variable `identifier` reads, as scope analysis resolves it: a parameter or a nested
 * declaration of the same name shadows a module-scope one, as it does when the code runs.
 * Undefined for a name this file does not declare.
 */
export const resolveReference = (identifier: TSESTree.Identifier, context: RuleContext<any, any>) => {
  try {
    const manager = scopeManagerOf(context)
    if (!manager) return undefined
    let resolved = resolvedReferences.get(manager)
    if (!resolved) {
      resolved = new Map()
      for (const scope of manager.scopes) {
        for (const reference of scope.references) resolved.set(reference.identifier, reference.resolved)
      }
      resolvedReferences.set(manager, resolved)
    }
    return resolved.get(identifier) ?? undefined
  } catch {
    return undefined
  }
}

const findDeclaration = (name: string, context: RuleContext<any, any>) => {
  try {
    const source = context.sourceCode

    if (!source) {
      console.warn("⚠️ ESLint's sourceCode is not available. Ensure that the rule is invoked with valid code.")
      return undefined
    }

    const scope = scopeManagerOf(context)!

    const decl = scope.variables
      .find((v) => v.name === name)
      ?.defs.find((d) => isIdentifier(d.name) && d.name.name === name)?.node
    if (isVariableDeclarator(decl)) {
      return decl
    }
  } catch (error) {
    console.error('Error in findDeclaration:', error)
    return undefined
  }
}

/** Whether `node` calls bamboo's `keyframes()`. @see isKeyframesName */
const isKeyframesCall = (node: Node | null | undefined, context: RuleContext<any, any>): boolean => {
  if (!node || !isCallExpression(node) || !isIdentifier(node.callee)) return false
  const callee = node.callee.name
  const imported = _getImports(context).find(({ alias, name }) => alias === callee && name === 'keyframes')
  if (!imported) return false
  // `keyframes` is exported beside `css`, so it is bamboo's where a `css` from the same module would be.
  return syncAction('matchImports', getSyncOptions(context), { alias: 'css', mod: imported.mod, name: 'css' }) === true
}

/**
 * Whether `node` is a keyframes name: a call to bamboo's `keyframes()`, or a binding this file
 * declares as one.
 *
 * The build evaluates the call and writes the name it returns in its place, so a style reading it
 * is as static as one written with the name: `css({ animationName: fadeIn })`, or `fadeIn` in a
 * template. A binding imported from another module is not followed, as no other binding is.
 */
export const isKeyframesName = (node: Node | null | undefined, context: RuleContext<any, any>): boolean => {
  if (node && isIdentifier(node)) return isKeyframesCall(findDeclaration(node.name, context)?.init, context)
  return isKeyframesCall(node, context)
}

const isLocalStyledFactory = (node: TSESTree.JSXOpeningElement, context: RuleContext<any, any>) => {
  if (!isJSXIdentifier(node.name)) {
    return
  }

  const decl = findDeclaration(node.name.name, context)

  if (!decl) {
    return
  }

  if (!isCallExpression(decl.init)) {
    return
  }

  if (!isIdentifier(decl.init.callee)) {
    return
  }

  // Check if the callee is 'styled' from bamboo imports
  const calleeName = decl.init.callee.name
  const rawImports = _getImports(context)
  const isStyledImport = rawImports.some((imp) => imp.alias === calleeName && imp.mod.includes('bamboo'))

  if (!isStyledImport && !isBambooIsh(calleeName, context)) {
    return
  }

  return true
}

const NO_EXTRACTION_FINDINGS: ExtractionFindings = { styles: [], tokenCalls: [] }

/** Each lint's findings, by the `SourceCode` ESLint hands every rule linting one version of a file. */
const extractionFindingsCache = new WeakMap<object, ExtractionFindings>()

/**
 * What the build says of this file as it extracts it, in its own words. Asked only of a file the
 * build reads — one that imports bamboo, which `include` reaches, and that is a file rather than a
 * code block a processor such as `@eslint/markdown` lifted out of one — which the cached answers
 * settle without sending the file's text. A file reaching bamboo only through `require()` or a
 * re-export is not asked about.
 *
 * Extracted once per lint however many rules report from it: two rules asking of the same
 * `SourceCode` share one answer, and the next edit is a new `SourceCode`, read afresh.
 */
const getExtractionFindings = (context: RuleContext<any, any>): ExtractionFindings => {
  // `physicalFilename` is ESLint 8.40's; before it, `getPhysicalFilename()`.
  const physicalFilename =
    context.physicalFilename ?? (context as { getPhysicalFilename?: () => string }).getPhysicalFilename?.()
  if ((physicalFilename ?? context.filename) !== context.filename) return NO_EXTRACTION_FINDINGS
  if (getImports(context).length === 0 || !isValidFile(context)) return NO_EXTRACTION_FINDINGS

  const cached = extractionFindingsCache.get(context.sourceCode)
  if (cached) return cached

  const findings =
    syncActionUncached('extractionFindings', getSyncOptions(context), context.sourceCode.text) ?? NO_EXTRACTION_FINDINGS
  extractionFindingsCache.set(context.sourceCode, findings)
  return findings
}

/** The styles in this file the build could not read, as the build explains them. */
export const getUnresolvedStyles = (context: RuleContext<any, any>) => getExtractionFindings(context).styles

/** The `token()` calls in this file naming no token, as the build explains them. */
export const getUnresolvedTokenCalls = (context: RuleContext<any, any>) => getExtractionFindings(context).tokenCalls

export const isValidFile = (context: RuleContext<any, any>) => {
  return syncAction('isValidFile', getSyncOptions(context))
}

export const isValidProperty = (name: string, context: RuleContext<any, any>, calleName?: string) => {
  return syncAction('isValidProperty', getSyncOptions(context), name, calleName)
}

export const isBambooImport = (node: TSESTree.ImportDeclaration, context: RuleContext<any, any>) => {
  const imports = getImports(context)
  return imports.some((imp) => imp.mod === node.source.value)
}

export const isBambooProp = (node: TSESTree.JSXAttribute, context: RuleContext<any, any>) => {
  const jsxAncestor = getAncestor(isJSXOpeningElement, node)

  if (!jsxAncestor) {
    return
  }

  // <styled.div /> && <Box />
  if (!isJSXMemberExpression(jsxAncestor.name) && !isJSXIdentifier(jsxAncestor.name)) {
    return
  }

  let isBambooComponent = false
  let componentName: string | undefined

  if (isJSXMemberExpression(jsxAncestor.name)) {
    // For <styled.div>, check if 'styled' is a Bamboo import
    const objectName = (jsxAncestor.name.object as any).name
    componentName = objectName
    // Check if 'styled' is imported from bamboo - check both filtered and raw imports
    const imports = getImports(context)
    const rawImports = _getImports(context)
    isBambooComponent =
      imports.some((imp) => imp.alias === objectName) ||
      rawImports.some((imp) => imp.alias === objectName && imp.mod.includes('bamboo')) ||
      isBambooIsh(objectName, context)

    // For styled.div, all props are valid styled props
    if (isBambooComponent) {
      return true
    }
  } else if (isJSXIdentifier(jsxAncestor.name)) {
    // For <Circle> or <BambooComp>
    componentName = jsxAncestor.name.name

    // Check if it's a local styled factory (e.g., const BambooComp = styled(div))
    const isLocalStyled = isLocalStyledFactory(jsxAncestor, context)

    // For local styled components, we need to check if the prop is a valid Bamboo prop
    if (isLocalStyled) {
      const property = node.name.name
      // Special props like 'css' and props starting with '_' are Bamboo props
      if (property === 'css' || (typeof property === 'string' && property.startsWith('_'))) {
        return true
      }

      // Other props need to be valid style properties
      if (typeof property !== 'string' || !isValidProperty(property, context)) {
        return false
      }

      return true
    }

    // For imported Bamboo components like Circle
    isBambooComponent = isBambooIsh(componentName, context)
  }

  if (!isBambooComponent) {
    return
  }

  const property = node.name.name
  // Ensure prop is a styled prop
  if (typeof property !== 'string' || !isValidProperty(property, context, componentName)) {
    return
  }

  return true
}

export const isStyledProperty = (node: TSESTree.Property, context: RuleContext<any, any>, calleeName?: string) => {
  if (!isIdentifier(node.key) && !isLiteral(node.key) && !isTemplateLiteral(node.key)) {
    return
  }

  if (isIdentifier(node.key) && !isValidProperty(node.key.name, context, calleeName)) {
    return
  }

  if (
    isLiteral(node.key) &&
    typeof node.key.value === 'string' &&
    !isValidProperty(node.key.value, context, calleeName)
  ) {
    return
  }

  if (isTemplateLiteral(node.key) && !isValidProperty(node.key.quasis[0].value.raw, context, calleeName)) {
    return
  }

  return true
}

export const isInBambooFunction = (node: TSESTree.Property, context: RuleContext<any, any>) => {
  const callAncestor = getAncestor(isCallExpression, node)
  if (!callAncestor) {
    return
  }

  let calleeName: string | undefined

  // E.g. css({...}), cvs({...})
  if (isIdentifier(callAncestor.callee)) {
    calleeName = callAncestor.callee.name
  }

  // E.g. css.raw({...})
  if (isMemberExpression(callAncestor.callee) && isIdentifier(callAncestor.callee.object)) {
    calleeName = callAncestor.callee.object.name
  }

  if (!calleeName) {
    return
  }

  if (!isBambooIsh(calleeName, context)) {
    return
  }

  return calleeName
}

export const isInJSXProp = (node: TSESTree.Property, context: RuleContext<any, any>) => {
  const jsxExprAncestor = getAncestor(isJSXExpressionContainer, node)
  const jsxAttributeAncestor = getAncestor(isJSXAttribute, node)

  if (!jsxExprAncestor || !jsxAttributeAncestor) {
    return
  }

  // Get the JSX element to check if it's a Bamboo component
  const jsxElement = getAncestor(isJSXOpeningElement, jsxAttributeAncestor)
  if (!jsxElement) {
    return
  }

  // Check if it's a Bamboo component (styled.div, Circle, etc.)
  let isBambooComponent = false
  if (isJSXMemberExpression(jsxElement.name)) {
    // For <styled.div>, check if 'styled' is a Bamboo import
    const objectName = (jsxElement.name.object as any).name
    isBambooComponent = isBambooIsh(objectName, context)
  } else if (isJSXIdentifier(jsxElement.name)) {
    // For <Circle> or <BambooComp>
    const componentName = jsxElement.name.name
    isBambooComponent = isBambooIsh(componentName, context) || Boolean(isLocalStyledFactory(jsxElement, context))
  }

  if (!isBambooComponent) {
    return
  }

  // Check if the attribute name is a valid styled prop
  if (!isJSXIdentifier(jsxAttributeAncestor.name)) {
    return
  }

  if (!isValidStyledProperty(jsxAttributeAncestor.name, context)) {
    return
  }

  return true
}

/**
 * Whether a key sits in a bamboo call or a bamboo JSX prop at all — `isBambooAttribute` without
 * asking what the key is. Answered from the tree and the file's imports, so a rule can ask it of
 * every key before anything costs a worker call.
 */
export const isInBambooStyle = (node: TSESTree.Property, context: RuleContext<any, any>) => {
  return getAncestor(isCallExpression, node)
    ? Boolean(isInBambooFunction(node, context))
    : Boolean(isInJSXProp(node, context))
}

/** A property key as written, when it is a name rather than a computed expression. */
const getKeyName = (key: TSESTree.Property['key']) => {
  if (isIdentifier(key)) return key.name
  if (isLiteral(key) && typeof key.value === 'string') return key.value
}

/**
 * The style property a literal value is written for, and the node naming it.
 *
 * Its own key, or, for a value under `base` or a condition inside a property's object —
 * `color: { base: 'x', _hover: 'y' }` — the property that object belongs to. `base` is no
 * property at all, so a check reading the value's own key skipped it, and a condition is not
 * what the value has to be valid for.
 */
export const getStyleProperty = (
  node: TSESTree.Property,
  context: RuleContext<any, any>,
): { name: string; node: TSESTree.Property } | undefined => {
  let current = node
  for (;;) {
    const name = getKeyName(current.key)
    if (name === undefined) return
    if (!syncAction('isCondition', getSyncOptions(context), name)) return { name, node: current }

    const object = current.parent
    const owner = object?.parent
    if (object?.type !== 'ObjectExpression' || owner?.type !== 'Property' || owner.value !== object) return
    current = owner
  }
}

export const isBambooAttribute = (node: TSESTree.Property, context: RuleContext<any, any>) => {
  const callAncestor = getAncestor(isCallExpression, node)

  if (callAncestor) {
    const callee = isInBambooFunction(node, context)
    if (!callee) {
      return
    }

    return isStyledProperty(node, context, callee)
  }

  // Object could be in JSX prop value i.e css prop or a pseudo
  return isInJSXProp(node, context) && isStyledProperty(node, context)
}

export const resolveLonghand = (name: string, context: RuleContext<any, any>) => {
  return syncAction('resolveLongHand', getSyncOptions(context), name)
}

export const resolveShorthands = (name: string, context: RuleContext<any, any>) => {
  return syncAction('resolveShorthands', getSyncOptions(context), name)
}

export const isColorAttribute = (attribute: string, context: RuleContext<any, any>) => {
  return syncAction('isColorAttribute', getSyncOptions(context), attribute)
}

export const isColorToken = (value: string | undefined, context: RuleContext<any, any>) => {
  if (!value) {
    return
  }

  return syncAction('isColorToken', getSyncOptions(context), value)
}

export const extractTokens = (value: string) => {
  // `token(colors.red.300)`. The fallback form it also matched is retired, and a value still
  // carrying one fails the build before a lint rule could have an opinion about its path.
  const regex = /token\(([^"'(),]+)\)/g
  const matches = []
  let match

  while ((match = regex.exec(value)) !== null) {
    if (match[1]) matches.push(match[1])
  }

  return matches
}

// Caching invalid tokens to avoid redundant computations
const invalidTokensCache = new Map<string, string[]>()

export const getInvalidTokens = (value: string, context: RuleContext<any, any>) => {
  if (invalidTokensCache.has(value)) {
    return invalidTokensCache.get(value)!
  }

  const tokens = extractTokens(value)
  if (!tokens.length) {
    return []
  }

  const invalidTokens = syncAction('filterInvalidTokens', getSyncOptions(context), tokens)
  invalidTokensCache.set(value, invalidTokens)
  return invalidTokens
}

const unresolvedValueCache = new Map<string, string | undefined>()

/**
 * What the build would say about this property and value, or nothing if it is fine.
 *
 * Asked of the resolver rather than reimplemented, so the squiggle and the build agree by
 * construction. `getInvalidTokens` above answers a narrower question — is this dotted path a
 * token — and cannot see `color: 'mutedd'` or tell `top: 'navH'` from `animationName: 'fadeIn'`,
 * because neither is decidable without the property and its CSS grammar.
 */
export const getUnresolvedValueMessage = (property: string, value: string, context: RuleContext<any, any>) => {
  const id = `${property}:${value}`
  if (unresolvedValueCache.has(id)) return unresolvedValueCache.get(id)

  const message = syncAction('explainUnresolvedValue', getSyncOptions(context), property, value)
  unresolvedValueCache.set(id, message)
  return message
}

/** Whether a call is to a recipe, whose argument selects variants rather than styles anything. */
export const isRecipeCall = (call: TSESTree.CallExpression, context: RuleContext<any, any>) => {
  if (call.callee.type !== 'Identifier') return false
  const imports = getImports(context)
  return imports.length > 0 && Boolean(syncAction('isRecipe', getSyncOptions(context), call.callee.name, imports))
}

/**
 * Whether a property selects a variant rather than styling one: under a recipe's `defaultVariants`,
 * or among a compound variant's conditions beside its `css`. Its key names a variant axis and its
 * value a variant, whatever style they happen to share a name with.
 */
export const isVariantSelection = (node: TSESTree.Property) => {
  let current = node.parent as TSESTree.Node | undefined
  while (current && current.type !== 'CallExpression') {
    if (current.type === 'Property' && !current.computed) {
      const key = getKeyName(current.key)
      if (key === 'defaultVariants') return true
      if (key === 'css') return false
    }
    if (current.type === 'ArrayExpression' && current.parent?.type === 'Property') {
      if (getKeyName(current.parent.key) === 'compoundVariants') return true
    }
    current = current.parent as TSESTree.Node | undefined
  }
  return false
}

/**
 * Whether a key is one the pattern its object is handed to declares, which the pattern's
 * transform reads by that name: `size` in `circle({ size: '4' })`. A pattern can declare one named
 * as a style is — a `padding` it maps onto a scale of its own — and the key is then the
 * pattern's, not the style's.
 */
export const isPatternProperty = (node: TSESTree.Property, context: RuleContext<any, any>) => {
  const call = node.parent.parent
  if (node.computed || node.parent.type !== 'ObjectExpression') return false
  if (call?.type !== 'CallExpression' || call.callee.type !== 'Identifier') return false
  const name = getKeyName(node.key)
  const imports = getImports(context)
  if (name === undefined || imports.length === 0) return false
  return Boolean(syncAction('isPatternProperty', getSyncOptions(context), name, call.callee.name, imports))
}

/**
 * The tokens holding `value` as written, in the category of the first of `properties` that reads
 * one, innermost first: what to write instead.
 */
export const getTokensWithValue = (properties: string[], value: string, context: RuleContext<any, any>) => {
  return (
    syncAction('tokensWithValue', getSyncOptions(context), properties, value) ?? { category: undefined, tokens: [] }
  )
}

// Caching deprecated tokens to avoid redundant computations
const deprecatedTokensCache = new Map<string, DeprecatedToken[]>()

export const getDeprecatedTokens = (property: string, value: string, context: RuleContext<any, any>) => {
  const propertyCategory = syncAction('getPropCategory', getSyncOptions(context), property)

  const tokens = extractTokens(value)

  if (!propertyCategory && !tokens.length) {
    return []
  }

  const values = tokens.length ? tokens : [{ category: propertyCategory, value: value.split('/')[0] }]

  if (deprecatedTokensCache.has(value)) {
    return deprecatedTokensCache.get(value)!
  }

  const deprecatedTokens = syncAction('filterDeprecatedTokens', getSyncOptions(context), values)
  deprecatedTokensCache.set(value, deprecatedTokens)

  return deprecatedTokens
}

export const getTokenImport = (context: RuleContext<any, any>) => {
  const imports = _getImports(context)
  return imports.find((imp) => imp.name === 'token')
}

export const getTaggedTemplateCaller = (node: TSESTree.TaggedTemplateExpression) => {
  // css``
  if (isIdentifier(node.tag)) {
    return node.tag.name
  }

  // styled.h1``
  if (isMemberExpression(node.tag)) {
    if (!isIdentifier(node.tag.object)) {
      return
    }

    return node.tag.object.name
  }

  // styled(Comp)``
  if (isCallExpression(node.tag)) {
    if (!isIdentifier(node.tag.callee)) {
      return
    }

    return node.tag.callee.name
  }
}

export const isStyledTaggedTemplate = (node: TSESTree.TaggedTemplateExpression, context: RuleContext<any, any>) => {
  const caller = getTaggedTemplateCaller(node)
  if (!caller) {
    return false
  }

  // Check if 'styled' is imported from bamboo
  const rawImports = _getImports(context)
  const isStyledImport = rawImports.some((imp) => imp.alias === caller && imp.mod.includes('bamboo'))

  return isStyledImport || isBambooIsh(caller, context)
}

export function isRecipeVariant(node: TSESTree.Property, context: RuleContext<any, any>) {
  const caller = isInBambooFunction(node, context)
  if (!caller) {
    return
  }

  // Check if the caller is either 'cva' or 'sva'
  const recipe = getImports(context).find((imp) => ['cva', 'sva'].includes(imp.name) && imp.alias === caller)
  if (!recipe) {
    return
  }

  //* Nesting is different here because of slots and variants. We don't want to warn about those.
  let currentNode: any = node
  let length = 0
  let styleObjectParent: null | string = null

  // Traverse up the AST
  while (currentNode) {
    const keyName = currentNode?.key?.name
    if (keyName && ['base', 'variants'].includes(keyName)) {
      styleObjectParent = keyName
    }

    currentNode = currentNode.parent
    if (!styleObjectParent) {
      length++
    }
  }

  // Determine the required length based on caller and styleObjectParent
  const isCvaCaller = caller === 'cva'
  const requiredLength = isCvaCaller ? 2 : 4
  const extraLength = styleObjectParent === 'base' ? 0 : 4

  if (length < requiredLength + extraLength) {
    return true
  }
}
