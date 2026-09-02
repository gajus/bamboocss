import { SyntaxKind as SyntaxKindValues, formatSyntaxKind } from '@typescript/api/unstable/ast'
import * as predicates from '@typescript/api/unstable/ast/is'
import type { ExportDeclaration, ImportDeclaration, SourceFile } from '@typescript/api/unstable/ast'
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
/**
 * Returned from a `forEachDescendant` visitor to leave that node's subtree unvisited.
 *
 * A symbol rather than `false` because skipping is semantic, not cosmetic — the extractor
 * declines to walk into imports and exports because the identifiers there are module bindings
 * rather than values. Spelling it as a boolean makes any visitor that happens to end in a
 * boolean expression silently stop descending, which is a wrong answer that still passes;
 * against a symbol the same expression is a type error.
 */
export const SKIP: unique symbol = Symbol('bamboo.forEachDescendant.skip')

export const forEachDescendant = (node: Node, visit: (child: Node) => void | typeof SKIP): void => {
  node.forEachChild((child: Node) => {
    if (visit(child) === SKIP) return
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
export const getModuleSpecifierValue = (declaration: ExportDeclaration | ImportDeclaration): string | undefined =>
  declaration.moduleSpecifier && predicates.isStringLiteral(declaration.moduleSpecifier)
    ? declaration.moduleSpecifier.text
    : undefined

/** The export declarations of a source file, without walking past the top level. */
export const getExportDeclarations = (sourceFile: SourceFile): ExportDeclaration[] =>
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
/**
 * A literal's text as its value, not as it was written.
 *
 * ts-morph's `getLiteralText()` reads like a request for source, and it is not: it returned
 * `compilerNode.text`, which is the *cooked* text — `red` for `'red'`, and `1px ` for the head
 * of `` `1px ${x}` ``. `getText()` returns the source span instead, quotes, backticks and
 * `${` included, which survives all the way into the stylesheet: a property name keeps its
 * quotes, and an interpolated template comes out as its own source with the substitution
 * spliced into the middle of it.
 */
export const getLiteralText = (node: Node): string => (node as Node & { text?: string }).text ?? node.getText()

/** Where each line of a source text starts, held as long as the file object it was read off. */
const lineStartsBySourceFile = new WeakMap<SourceFile, { text: string; starts: number[] }>()

const lineStartsOf = (sourceFile: SourceFile) => {
  const text = sourceFile.text
  const cached = lineStartsBySourceFile.get(sourceFile)
  if (cached && cached.text === text) return cached.starts
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1)
  lineStartsBySourceFile.set(sourceFile, { text, starts })
  return starts
}

/**
 * 1-based line and column for an offset, for a diagnostic that names a place in a file.
 *
 * Line starts are computed once per source text and searched. Slicing and splitting the text
 * up to each offset was fine for a diagnostic or two; a source map asks this once per call
 * site of a project, which made it quadratic in a file's length.
 */
export const getLineAndColumnAtPos = (sourceFile: SourceFile, pos: number): { line: number; column: number } => {
  const starts = lineStartsOf(sourceFile)
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle]! <= pos) low = middle
    else high = middle - 1
  }
  return { line: low + 1, column: pos - starts[low]! + 1 }
}

/** The named bindings of an import — `import { a, b } from 'x'`. */
/**
 * The import clause, whether given the declaration or the clause itself.
 *
 * ts-morph hung `getNamedImports()` and friends on the *declaration*, so that is what most
 * callers hold. But a caller that has already narrowed to `statement.importClause` — because it
 * needed to check the clause for a type-only import first — naturally passes the clause, and
 * silently reading `undefined.namedBindings` off it reports a file with no imports at all.
 * Accepting both is one comparison and removes a whole class of caller-side mistake.
 */
const clauseOf = (node: Node): { isTypeOnly?: boolean; name?: Node; namedBindings?: Node } | undefined => {
  const declared = (node as { importClause?: { isTypeOnly?: boolean; name?: Node; namedBindings?: Node } }).importClause
  if (declared) return declared
  return predicates.isImportClause(node)
    ? (node as { isTypeOnly?: boolean; name?: Node; namedBindings?: Node })
    : undefined
}

export const getNamedImports = (declaration: Node): Node[] => {
  const bindings = clauseOf(declaration)?.namedBindings
  return bindings && predicates.isNamedImports(bindings) ? [...bindings.elements] : []
}

/** The default binding of an import — `import a from 'x'` — or `undefined`. */
export const getDefaultImport = (declaration: Node): Node | undefined => clauseOf(declaration)?.name

/** The namespace binding of an import — `import * as a from 'x'` — or `undefined`. */
export const getNamespaceImport = (declaration: Node): Node | undefined => {
  const bindings = clauseOf(declaration)?.namedBindings
  return bindings && predicates.isNamespaceImport(bindings) ? (bindings as { name?: Node }).name : undefined
}

/**
 * Whether a declaration or specifier is `type`-only, in any of the three places it is spelled.
 *
 * Two of them carry the flag themselves: a specifier — `import { type A }`, `export { type A }`
 * — and an export declaration, `export type { A } from './a'`. An **import** declaration does
 * not. `import type { A } from './a'` puts it on the import clause, so reading it off the
 * declaration answers `false` for every type-only import there is.
 *
 * That silence is the whole reason this is written out. Callers guarding with
 * `if (isTypeOnly(declaration)) continue` looked correct and did nothing on the import side, so
 * the recipe walk descended into modules it had already decided not to read, and resolution
 * installed and parsed them. What that costs is set by how a codebase generates its types: an
 * app whose components each import a generated artifact type-only pulls the whole generated
 * tree into the compiler's program, for an answer that is nothing by construction.
 *
 * A clause-less import — `import './a'` for its side effects — has no flag anywhere and is not
 * type-only, which is the right answer: it names a module that must still be loaded.
 */
export const isTypeOnly = (node: Node): boolean => {
  if ((node as { isTypeOnly?: boolean }).isTypeOnly === true) return true
  return clauseOf(node)?.isTypeOnly === true
}

/** The local alias of a specifier — the `b` in `import { a as b }` — or `undefined`. */
export const getAliasNode = (specifier: Node): Node | undefined => {
  const propertyName = (specifier as { propertyName?: Node }).propertyName
  return propertyName ? (specifier as { name?: Node }).name : undefined
}

/** The named specifiers of an export — `export { a, b }`. */
export const getNamedExports = (declaration: Node): Node[] => {
  const clause = (declaration as { exportClause?: Node }).exportClause
  return clause && predicates.isNamedExports(clause) ? [...clause.elements] : []
}

/**
 * The name node of a declaration, without narrowing first.
 *
 * ts-morph let `.getNameNode()` be reached off any node because its class hierarchy declared it
 * broadly; TypeScript 7 puts `name` only on the kinds that have one, so a call site that has a
 * `Node` in hand cannot ask. Rather than narrow at every one of those sites — which would be
 * inventing a decision about which kinds are expected there — this answers `undefined` for a
 * node with no name, exactly as the old call did.
 */
/**
 * The node ts-morph's `getNameNode()` returned.
 *
 * For most nodes that is simply `name`. For an import or export specifier it is not: ts-morph
 * answered with the name being *imported* — `token` in `import { token as t }` — while
 * TypeScript keeps that under `propertyName` and puts the local binding in `name`. Reading
 * `name` there silently swaps the two, so an aliased import resolves against the alias, finds
 * no such export, and the styles it named are dropped rather than reported.
 *
 * The preference has to stay scoped to specifiers. A `BindingElement` also carries
 * `propertyName` — `const { a: b } = x` — and there ts-morph's `getNameNode()` really is `b`,
 * so preferring `propertyName` everywhere would break destructuring in the opposite direction.
 */
export const nameNodeOf = (node: Node): Node | undefined => {
  if (predicates.isImportSpecifier(node) || predicates.isExportSpecifier(node)) {
    return ((node as { propertyName?: Node }).propertyName ?? (node as { name?: Node }).name) as Node | undefined
  }
  return (node as { name?: Node }).name
}

/**
 * A named child of a node, without narrowing to the kind that declares it.
 *
 * The generalisation of `nameNodeOf`, for the same reason: ts-morph declared `getExpression()`,
 * `getArguments()` and the rest broadly enough to call off any node, while TypeScript 7 puts
 * each accessor only on the kinds that have it. Narrowing at every such site would mean
 * inventing a claim about which kinds are expected there — a claim the old code never made and
 * that would silently drop a node it did not anticipate.
 *
 * Returns `undefined` for a node without that child, exactly as the old call did.
 */
export const childOf = <T = Node>(node: Node, key: string): T | undefined =>
  (node as unknown as Record<string, T | undefined>)[key]

/** A named property of an object literal, by key — ts-morph's `getProperty(name)`. */
/**
 * A named entry of an object literal or of a type literal.
 *
 * One name, two containers: ts-morph put `getProperty()` on both `ObjectLiteralExpression`,
 * whose entries are `properties`, and `TypeLiteralNode`, whose entries are `members`. Reading
 * only `properties` therefore answers `undefined` for every type literal — and the caller that
 * needs it is the one that resolves a `declare const tokens: { readonly shadows: … }`, where
 * the declaration has no initializer and its *type* is the only thing holding the values. That
 * failure is silent: the property resolves as unresolvable and its declarations are dropped.
 */
export const getProperty = (node: Node, name: string): Node | undefined =>
  (childOf<Node[]>(node, 'properties') ?? childOf<Node[]>(node, 'members') ?? []).find(
    (property) => getName(property) === name,
  )

/** A named member of a type literal, interface or enum — ts-morph's `getMember(name)`. */
export const getMember = (node: Node, name: string): Node | undefined =>
  (childOf<Node[]>(node, 'members') ?? []).find((member) => getName(member) === name)

/**
 * A node's position among its parent's named children.
 *
 * ts-morph counted every child including punctuation; `forEachChild` visits named children
 * only. Nothing bamboo does with the index cares about commas — it identifies which element of a
 * binding pattern or array a node is — and the named-only count is the one that matches.
 */
export const getChildIndex = (node: Node): number => {
  const parent = node.parent
  if (!parent) return -1
  let index = -1
  let seen = 0
  parent.forEachChild((child) => {
    if (child === node) index = seen
    seen++
  })
  return index
}

/**
 * Every variable declaration directly inside a node, across its `var`/`let`/`const` statements.
 *
 * Takes any node that holds statements, not only a source file. ts-morph put this on
 * `StatementedNode` — a block, a module block and a case clause answered it as readily as a
 * file — and the scope walk in `compiled-jsx` depends on that: it climbs from an identifier
 * through every enclosing statement asking each what it declares, so the innermost binding
 * wins. Narrowing this to source files would answer only at the top of the walk, which is the
 * one scope a shadowed binding is *not* in.
 */
export const getVariableDeclarations = (node: Node | SourceFile): Node[] => {
  const statements = (node as { statements?: readonly Node[] }).statements
  if (!statements) return []

  return statements
    .filter((statement) => predicates.isVariableStatement(statement))
    .flatMap((statement) => [...(childOf<{ declarations?: Node[] }>(statement, 'declarationList')?.declarations ?? [])])
}

/** One variable declaration by name, or `undefined`. */
export const getVariableDeclaration = (node: Node | SourceFile, name: string): Node | undefined =>
  getVariableDeclarations(node).find((declaration) => getName(declaration) === name)

/** The `* as ns` clause of an export, or `undefined`. */
export const getNamespaceExport = (declaration: Node): Node | undefined => {
  const clause = childOf<Node>(declaration, 'exportClause')
  return clause && predicates.isNamespaceExport(clause) ? clause : undefined
}

/** Whether a file was loaded out of `node_modules`. */
export const isInNodeModules = (sourceFile: SourceFile): boolean => sourceFile.fileName.includes('/node_modules/')

/**
 * Whether an export re-exports everything — `export * from './m'`.
 *
 * Distinct from `getNamespaceExport`, which answers the `export * as ns from './m'` form. The
 * two look alike and behave differently: a bare star forwards every name, while `* as ns` binds
 * one object and forwards none, so a barrel walk that confuses them folds imports that resolve
 * to nothing. ts-morph spelled this `isNamespaceExport()`; here it is the absence of any export
 * clause.
 */
export const isStarExport = (declaration: Node): boolean => {
  if (!predicates.isExportDeclaration(declaration)) return false

  // Both forms, which is what ts-morph's `isNamespaceExport()` meant: `export * from` has no
  // clause at all, and `export * as ns from` has one that is itself a namespace export. Each
  // carries the whole module through, so anything asking "does this re-export everything" has
  // to see both — a survivor scan that saw only the first read `export * as ns from
  // 'styled-system/css'` as binding nothing, and let a module that keeps the runtime alive be
  // compiled away.
  const clause = childOf<Node>(declaration, 'exportClause')
  return clause === undefined || predicates.isNamespaceExport(clause)
}

/**
 * A string literal's value, for a caller that has already established the kind.
 *
 * `literalValueOf` answers for every literal kind and so returns a union; at a site guarded by
 * `is.isStringLiteral` that union is noise the call site would otherwise widen away with a cast.
 */
export const stringLiteralValue = (node: Node): string => (node as { text?: string }).text ?? ''

/** Whether a member carries the `readonly` modifier. */
export const isReadonly = (node: Node): boolean =>
  (childOf<Node[]>(node, 'modifiers') ?? []).some((modifier) => modifier.kind === SyntaxKindValues.ReadonlyKeyword)

/**
 * The suffix an unparseable extension is held under.
 *
 * TypeScript 7 decides a file's script kind from its extension and declines everything it does
 * not recognise — a `.vue`, `.svelte` or `.astro` path is simply not admitted to the program,
 * whatever text is supplied for it. ts-morph took a `scriptKind` argument and asked no further
 * questions, which is how bamboo has always parsed single-file components: a `parser:before`
 * hook lifts the script block out and the result is TSX under the original name.
 *
 * So the compiler is given a name it will accept, and bamboo keeps its own. The suffix is
 * appended rather than substituted so the original extension survives inside it, and it is
 * distinctive enough that `pathOf` can undo it without a lookup table.
 */
const ALIAS_SUFFIX = '.bamboo.tsx'

/** Extensions TypeScript will parse under their own name. */
const COMPILER_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.json', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])

const extensionOf = (filePath: string): string => {
  const at = filePath.lastIndexOf('.')
  const slash = filePath.lastIndexOf('/')
  return at > slash ? filePath.slice(at).toLowerCase() : ''
}

/** The name the compiler will hold this path under, which is the path itself unless it refuses it. */
export const compilerPathOf = (filePath: string): string =>
  COMPILER_EXTENSIONS.has(extensionOf(filePath)) ? filePath : `${filePath}${ALIAS_SUFFIX}`

/**
 * The path bamboo knows a file by, given the compiler's name for it.
 *
 * Identity for everything the compiler accepts under its own name, which is nearly every file.
 * Everywhere bamboo records or compares a path — the ledger, dependency records, diagnostics —
 * this is the spelling to use, because it is the one the watcher and the bundler will report.
 */
export function pathOf(file: string | { fileName: string }): string
export function pathOf(file: string | { fileName: string } | undefined): string | undefined
export function pathOf(file: string | { fileName: string } | undefined): string | undefined {
  if (file === undefined) return undefined
  const filePath = typeof file === 'string' ? file : file.fileName
  if (!filePath.endsWith(ALIAS_SUFFIX)) return filePath

  // Only when something recognisable is underneath: a file genuinely named `x.bamboo.tsx` ends
  // with the same characters and is not an alias of anything.
  const original = filePath.slice(0, -ALIAS_SUFFIX.length)
  return extensionOf(original) && !COMPILER_EXTENSIONS.has(extensionOf(original)) ? original : filePath
}

/** A kind's canonical name — see `ts.formatSyntaxKind` for why this is not a reverse lookup. */
export const kindNameOf = (kind: number | undefined): string => (kind === undefined ? '' : formatSyntaxKind(kind))
