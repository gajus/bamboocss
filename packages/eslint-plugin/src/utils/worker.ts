// Must stay a fully type-only import: under `verbatimModuleSyntax` an
// `import { type X }` survives as a runtime import, which pulls the plugin
// entry — and its `createSyncFn` call — into this worker's bundle.
import type { ImportResult } from '.'
import { loadConfig } from '@bamboocss/config'
import { resolveTsPathPattern } from '@bamboocss/config/ts-path'
import { Generator } from '@bamboocss/generator'
import type { TokenDataTypes } from '@bamboocss/types'
import { logger } from '@bamboocss/logger'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { runAsWorker } from 'synckit'
import { configFor } from './config-path'

type Options = {
  configPath?: string
  currentFile: string
  /** ESLint's working directory, which a relative `configPath` is read against. */
  cwd?: string
}

/** A config's context, and — for one that failed to load — the config's mtime it failed at. */
const contextCache = new Map<string, { context: Promise<Generator>; failedAt?: number }>()

/** `@bamboocss/node`, loaded once, and only when a rule needs a context. */
let nodeModule: Promise<typeof import('@bamboocss/node')> | undefined
const loadNode = () => (nodeModule ??= import('@bamboocss/node'))

/**
 * Nothing the worker logs reaches ESLint's output, where a line corrupts `--format json`: no
 * level, and no filter, which would lift the level to `debug` for what it matches. Again after
 * every config load, which sets both from the config.
 */
const silence = () => {
  logger.level = 'silent'
  logger.filter = ''
}

const mtimeOf = (file: string) => statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? -1

export type DeprecatedToken =
  | string
  | {
      category: string
      value: string
    }

// Set by this repo's own test suite to the module that builds a Generator from
// the fixture config. Never set for consumers of the published package, which
// ships `dist` only — keying this off NODE_ENV would break anyone linting with
// NODE_ENV=test, since the fixtures are not published.
const testContextModule = process.env.BAMBOO_ESLINT_TEST_CONTEXT

/**
 * The context every rule reads: `@bamboocss/node`'s, as the build prepares it — `include` matched
 * from the config's directory, the tsconfig's aliases read, the extraction behind it — one per
 * config, so no two rules answer from different readings of one config.
 *
 * A config that fails to load is not loaded again until it changes: once per edit that broke it,
 * rather than once per question every rule asks of every file.
 */
export async function getContext(options: Options): Promise<Generator> {
  silence()
  const key = testContextModule ?? configFor(options)
  const cached = contextCache.get(key)
  if (cached && (cached.failedAt === undefined || cached.failedAt === mtimeOf(key))) return cached.context

  const entry: { context: Promise<Generator>; failedAt?: number } = { context: createContext(key) }
  entry.context.then(silence, () => {
    entry.failedAt = mtimeOf(key)
  })
  contextCache.set(key, entry)
  return entry.context
}

async function createContext(configPath: string): Promise<Generator> {
  if (testContextModule) {
    const { createContext } = await import(testContextModule)
    return createContext({
      exclude: ['**/Invalid.tsx', '**/bamboo.config.ts'],
      importMap: './bamboo',
      include: ['**/*'],
    })
  }

  const cwd = path.dirname(configPath)
  const { loadConfigAndCreateContext } = await loadNode()
  try {
    return await loadConfigAndCreateContext({ configPath, cwd })
  } catch {
    // The build's preparation refused what the generator alone does not need — a tsconfig that
    // does not parse, class names the build and the browser would disagree on. The rules that
    // read only the config go on from it, and the extraction stands aside.
    const conf = await loadConfig({ cwd, file: configPath })
    conf.config.cwd ??= cwd
    return new Generator(conf)
  }
}

/**
 * What the build says of `text` as it extracts it. The styles it could not read: where they are,
 * what is lost and what to do — what `bamboo` warns about at build time, each declaration it names
 * absent from the stylesheet. And the `token()` calls naming no token, each of which drops the
 * property it was written into the same way, in the sentence the build fails with. Asked only of a
 * file that imports bamboo and that `include` reaches (`getExtractionFindings`), once per lint of
 * it, however many rules report from it.
 *
 * None for a file under `outdir`, which nothing the author writes would change, as the build skips
 * it too; nor for one the build reads rewritten — a `.vue`, `.svelte` or `.astro` file, or one a
 * plugin's `parser:before` changes — whose positions are not the file's. The editor's text stands
 * in for the file only while it is read, and only where it differs from the file: another file
 * importing this one reads what is on disk. Its styles are encoded apart, and dropped: nothing in
 * the worker emits CSS, and a long editor session would otherwise keep every version linted.
 */
const extractionFindings = async (options: Options, text: string): Promise<ExtractionFindings> => {
  const [context, { BambooContext, explainUnresolvedStyle }] = await Promise.all([getContext(options), loadNode()])
  if (!(context instanceof BambooContext)) return NO_EXTRACTION_FINDINGS
  const file = path.resolve(options.cwd ?? process.cwd(), options.currentFile)
  if (context.isGenerated(file)) return NO_EXTRACTION_FINDINGS

  // ESLint drops a byte order mark from the text it lints.
  const overlaid = readIfExists(file)?.replace(/^\uFEFF/, '') !== text
  if (overlaid) context.project.addSourceFile(file, text)
  try {
    if (context.parsedSourceText(file) !== text) return NO_EXTRACTION_FINDINGS
    const result = context.parseFile(file, context.encoder.clone())
    const own = <T extends { filePath: string }>(entries: T[] = []) =>
      entries.filter((entry) => path.resolve(entry.filePath) === file)
    return {
      styles: own(result?.unresolved).map((entry) => {
        const { fix, what } = explainUnresolvedStyle(entry)
        return { column: entry.column, fix, line: entry.line, what }
      }),
      tokenCalls: own(result?.unresolvedTokenCalls).map(({ call, column, line }) => ({
        column,
        line,
        message: context.utility.explainUnresolvedTokenCall(call),
      })),
    }
  } finally {
    if (overlaid) context.project.removeOverlay(file)
  }
}

const readIfExists = (file: string) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

// Refactored to arrow function, removed async
const filterDeprecatedTokens = (context: Generator, tokens: DeprecatedToken[]): DeprecatedToken[] => {
  return tokens.filter((token) => {
    const value = typeof token === 'string' ? token : token.category + '.' + token.value
    return context.utility.tokens.isDeprecated(value)
  })
}

/**
 * The `token()` paths the build would not take, by its own resolution, so the squiggle and the
 * build agree about a colour's opacity — `token(colors.red.300/50)` resolves, `/hlaf` does not —
 * as about everything else.
 */
const filterInvalidTokens = (context: Generator, paths: string[]): string[] => {
  return paths.filter((path) => !context.utility.tokens.isValidReference(path.trim()))
}

/** Whether a key is a condition, `base` included, rather than a property. */
const isCondition = (context: Generator, name: string): boolean => {
  return name === 'base' || context.conditions.isCondition(name)
}

/**
 * The build's own verdict on one property/value pair, for the editor.
 *
 * The same predicate and the same sentence the build prints — not a second implementation of
 * either. The type layer used to give this feedback by narrowing every generated prop type, at
 * a measured 19% of the types and 28% of the instantiations in a real project, and it could
 * only ever say "not assignable"; the resolver knows the value is a `sizes` token used on a
 * property that reads `spacing`, and knowing that is the whole point.
 */
const explainUnresolvedValue = (context: Generator, property: string, value: string): string | undefined => {
  const { utility } = context
  if (!utility.isUnresolvedTokenValue(property, value)) return undefined

  const key = utility.resolveShorthand(property)
  return utility.explainUnresolvedToken(utility.unresolvedTokenRef(key, utility.bareTokenPath(key, value)))
}

/**
 * A value as CSS reads it: the spacing between words, and around `/` and `,`, aside; a hex color's
 * case, and its short form spelled out; a leading zero written. Nothing else's case — a keyframe's
 * name, a custom property's — is CSS's to fold, and a quoted string or a `url()` is kept as written.
 */
const normalizeValue = (value: string) => {
  const trimmed = value.trim()
  if (/url\(|["']/i.test(trimmed)) return trimmed
  return trimmed
    .replace(/\s+/g, ' ')
    .replace(/\s*([/,])\s*/g, '$1')
    .replace(
      /#([0-9a-f]{3,8})\b/gi,
      (_, hex: string) =>
        `#${(hex.length === 3 || hex.length === 4 ? [...hex].map((digit) => digit + digit).join('') : hex).toLowerCase()}`,
    )
    .replace(/(^|[\s(,/*+-])\.(\d)/g, '$10.$2')
}

/**
 * A keyword, or a name: `currentColor`, `auto`, `normal`, `thin`, `white`. A value of CSS, or a
 * name a theme gave one, rather than a design value written out — whatever token holds it.
 */
const isIdentifier = (value: string) => /^-?[a-z][a-z-]*$/i.test(value)

/** Each category's tokens by their value as CSS reads it, built once per context. */
const tokensByValue = new WeakMap<Generator, Map<string, Map<string, string[]>>>()

const valuesOf = (context: Generator, category: string) => {
  let categories = tokensByValue.get(context)
  if (!categories) tokensByValue.set(context, (categories = new Map()))
  let byValue = categories.get(category)
  if (byValue) return byValue

  byValue = new Map()
  for (const [name, token] of context.utility.tokens.view.categoryMap.get(category as keyof TokenDataTypes) ?? []) {
    const { condition, isNegative, isVirtual } = token.extensions
    if (isNegative || isVirtual || token.isConditional || token.isReference) continue
    if (condition !== undefined && condition !== 'base') continue
    if (typeof token.value !== 'string' && typeof token.value !== 'number') continue
    const value = normalizeValue(String(token.value))
    byValue.set(value, [...(byValue.get(value) ?? []), name])
  }
  categories.set(category, byValue)
  return byValue
}

/**
 * The tokens holding `value` as written — `1rem`, `#2f81f7` — in the category of the first of
 * `properties` that has one, innermost first: `padding: { base: '1rem' }` asks about `base`, then
 * `padding`. By the name a style writes them, and none for a value that already is one's name,
 * which reads as the token however it is spelled, or for a keyword. Not a token whose value no
 * literal is: a reference, a condition's, a negative, or a color palette's stand-in.
 */
const tokensWithValue = (context: Generator, properties: string[], value: string) => {
  for (const property of properties) {
    const category =
      context.utility.getTokenType(context.utility.resolveShorthand(property)) ?? getPropertyCategory(context, property)
    if (!category) continue

    const named = context.utility.tokens.view.categoryMap.get(category as keyof TokenDataTypes)
    if (!named || named.has(value) || isIdentifier(value.trim())) return { category, tokens: [] }
    return { category, tokens: valuesOf(context, category).get(normalizeValue(value)) ?? [] }
  }
  return { category: undefined, tokens: [] }
}

// Refactored to arrow function, removed async
const getPropertyCategory = (context: Generator, _attribute: string) => {
  const longhand = resolveLongHand(context, _attribute)
  const attribute = longhand || _attribute
  const attributeConfig = context.utility.config[attribute]
  return typeof attributeConfig?.values === 'string' ? attributeConfig.values : undefined
}

// Refactored to arrow function, removed async
const isColorAttribute = (context: Generator, _attribute: string): boolean => {
  const category = getPropertyCategory(context, _attribute)
  return category === 'colors'
}

// Refactored to arrow function, removed async
const isColorToken = (context: Generator, value: string): boolean => {
  return Boolean(context.utility.tokens.view.categoryMap.get('colors')?.get(value))
}

/** A style the build could not read: where it is, what is lost, and what to do about it. */
export type UnresolvedStyleReport = { column: number; fix: string; line: number; what: string }

/** A `token()` call naming no token: where it starts, and what the build says of it. */
export type UnresolvedTokenCallReport = { column: number; line: number; message: string }

/** @see extractionFindings */
export type ExtractionFindings = { styles: UnresolvedStyleReport[]; tokenCalls: UnresolvedTokenCallReport[] }

const NO_EXTRACTION_FINDINGS: ExtractionFindings = { styles: [], tokenCalls: [] }

type MatchImportResult = {
  alias: string
  mod: string
  name: string
}

export function run(action: 'filterInvalidTokens', options: Options, paths: string[]): string[]
export function run(
  action: 'explainUnresolvedValue',
  options: Options,
  property: string,
  value: string,
): string | undefined

export function run(action: 'isColorToken', options: Options, value: string): boolean

export function run(action: 'isColorAttribute', options: Options, attribute: string): boolean

export function run(action: 'isCondition', options: Options, name: string): boolean

export function run(action: 'isValidFile', options: Options): boolean

export function run(action: 'resolveShorthands', options: Options, name: string): string[] | undefined
export function run(action: 'resolveLongHand', options: Options, name: string): string | undefined

export function run(action: 'isValidProperty', options: Options, name: string, patternName?: string): boolean
export function run(action: 'matchFile', options: Options, name: string, imports: ImportResult[]): boolean
export function run(action: 'isRecipe', options: Options, name: string, imports: ImportResult[]): boolean
export function run(
  action: 'isPatternProperty',
  options: Options,
  property: string,
  name: string,
  imports: ImportResult[],
): boolean
export function run(action: 'matchImports', options: Options, result: MatchImportResult): boolean
export function run(action: 'filterImports', options: Options, imports: MatchImportResult[]): MatchImportResult[]
export function run(action: 'getPropCategory', options: Options, property: string): string
export function run(action: 'filterDeprecatedTokens', options: Options, tokens: DeprecatedToken[]): DeprecatedToken[]
export function run(action: 'extractionFindings', options: Options, text: string): ExtractionFindings
export function run(
  action: 'tokensWithValue',
  options: Options,
  properties: string[],
  value: string,
): { category: string | undefined; tokens: string[] }
export function run(action: string, options: Options, ...args: any[]): any {
  // @ts-expect-error cast
  return runAsync(action, options, ...args)
}

export function runAsync(action: 'filterInvalidTokens', options: Options, paths: string[]): Promise<string[]>
export function runAsync(
  action: 'explainUnresolvedValue',
  options: Options,
  property: string,
  value: string,
): Promise<string | undefined>
export function runAsync(action: 'isColorToken', options: Options, value: string): Promise<boolean>
export function runAsync(action: 'isColorAttribute', options: Options, attribute: string): Promise<boolean>
export function runAsync(action: 'isCondition', options: Options, name: string): Promise<boolean>
export function runAsync(action: 'isValidFile', options: Options, fileName: string): Promise<string>
export function runAsync(action: 'resolveShorthands', options: Options, name: string): Promise<string[] | undefined>
export function runAsync(action: 'resolveLongHand', options: Options, name: string): Promise<string | undefined>

export function runAsync(
  action: 'isValidProperty',
  options: Options,
  name: string,
  patternName?: string,
): Promise<boolean>
export function runAsync(action: 'matchFile', options: Options, name: string, imports: ImportResult[]): Promise<boolean>
export function runAsync(action: 'matchImports', options: Options, result: MatchImportResult): Promise<boolean>
export function runAsync(
  action: 'filterImports',
  options: Options,
  imports: MatchImportResult[],
): Promise<MatchImportResult[]>
export function runAsync(action: 'getPropCategory', options: Options, property: string): Promise<string>
export function runAsync(
  action: 'filterDeprecatedTokens',
  options: Options,
  tokens: DeprecatedToken[],
): Promise<DeprecatedToken[]>
export async function runAsync(action: string, options: Options, ...args: any): Promise<any> {
  if (action === 'extractionFindings') return extractionFindings(options, args[0])

  const context = await getContext(options)

  switch (action) {
    case 'filterDeprecatedTokens':
      // @ts-expect-error cast
      return filterDeprecatedTokens(context, ...args)
    case 'filterImports':
      // @ts-expect-error cast
      return filterImports(context, ...args)
    case 'explainUnresolvedValue':
      // @ts-expect-error cast
      return explainUnresolvedValue(context, ...args)
    case 'filterInvalidTokens':
      // @ts-expect-error cast
      return filterInvalidTokens(context, ...args)
    case 'getPropCategory':
      // @ts-expect-error cast
      return getPropertyCategory(context, ...args)
    case 'isColorAttribute':
      // @ts-expect-error cast
      return isColorAttribute(context, ...args)
    case 'isColorToken':
      // @ts-expect-error cast
      return isColorToken(context, ...args)
    case 'isCondition':
      // @ts-expect-error cast
      return isCondition(context, ...args)
    case 'isValidFile':
      return isValidFile(context, path.resolve(options.cwd ?? process.cwd(), options.currentFile))
    case 'isValidProperty':
      // @ts-expect-error cast
      return isValidProperty(context, ...args)
    case 'isRecipe':
      // @ts-expect-error cast
      return isRecipe(context, ...args)
    case 'isPatternProperty':
      // @ts-expect-error cast
      return isPatternProperty(context, ...args)
    case 'matchFile':
      // @ts-expect-error cast
      return matchFile(context, ...args)
    case 'matchImports':
      // @ts-expect-error cast
      return matchImports(context, ...args)
    case 'resolveLongHand':
      // @ts-expect-error cast
      return resolveLongHand(context, ...args)
    case 'tokensWithValue':
      // @ts-expect-error cast
      return tokensWithValue(context, ...args)
    case 'resolveShorthands':
      // @ts-expect-error cast
      return resolveShorthands(context, ...args)
  }
}

/** Each context's answer to whether `include` reaches a file. @see isValidFile */
const sourceMatchers = new WeakMap<Generator, (path: string) => boolean>()

/**
 * Whether `include` reaches the file, as the build's glob reads it — a negated pattern among
 * `include`, a folder named in `exclude`, a hidden folder the glob does not enter — and without a
 * walk, which a rule asked of every file cannot afford.
 */
const isValidFile = async (context: Generator, fileName: string): Promise<boolean> => {
  const cwd = context.config.cwd || process.cwd()
  let matches = sourceMatchers.get(context)
  if (!matches) {
    const { sourceMatcher } = await loadNode()
    matches = sourceMatcher(context.config.include, context.config.exclude, cwd)
    sourceMatchers.set(context, matches)
  }
  const relativePath = path.isAbsolute(fileName) ? path.relative(cwd, fileName) : fileName
  return matches(relativePath.replaceAll('\\', '/'))
}

// Refactored to arrow function, removed async
const isValidProperty = (context: Generator, name: string, patternName?: string) => {
  if (context.isValidProperty(name)) {
    return true
  }

  if (!patternName) {
    return false
  }

  const pattern = context.patterns.details.find((p) => p.baseName === patternName)?.config.properties
  if (!pattern) {
    return false
  }

  return Object.keys(pattern).includes(name)
}

// Refactored to arrow function, removed async
const matchFile = (context: Generator, name: string, imports: ImportResult[]) => {
  const file = context.imports.file(imports)
  return file.match(name)
}

/** Whether `name`, among a file's imports, is a recipe: a call to it selects variants. */
const isRecipe = (context: Generator, name: string, imports: ImportResult[]) => {
  return context.imports.file(imports).isValidRecipe(name)
}

/**
 * Whether `property` is one the pattern `name` calls declares, which its transform reads by that
 * name: `size` in `circle({ size: '4' })`.
 */
const isPatternProperty = (context: Generator, property: string, name: string, imports: ImportResult[]) => {
  const file = context.imports.file(imports)
  if (!file.isValidPattern(name)) return false
  const properties = context.patterns.getConfig(file.getName(name))?.properties
  return properties !== undefined && Object.hasOwn(properties, property)
}

// Refactored to arrow function, removed async
const matchImports = (context: Generator, result: MatchImportResult) => {
  return context.imports.match(result, (module_) => {
    const { tsOptions } = context.parserOptions
    if (!tsOptions?.pathMappings) {
      return
    }

    return resolveTsPathPattern(tsOptions.pathMappings, module_)
  })
}

// Batch filter imports to reduce worker thread crossings
const filterImports = (context: Generator, imports: MatchImportResult[]): MatchImportResult[] => {
  return imports.filter((imp) =>
    context.imports.match(imp, (module_) => {
      const { tsOptions } = context.parserOptions
      if (!tsOptions?.pathMappings) {
        return
      }

      return resolveTsPathPattern(tsOptions.pathMappings, module_)
    }),
  )
}

// Cache reverse shorthand map per context to avoid O(N) rebuild on every call
const reverseShorthandsMapCache = new WeakMap<Generator, Map<string, string>>()

const getReverseShorthandsMap = (context: Generator): Map<string, string> => {
  let reverseMap = reverseShorthandsMapCache.get(context)
  if (!reverseMap) {
    reverseMap = new Map()
    const shorthands = context.utility.getPropShorthandsMap()
    for (const [key, values] of shorthands) {
      for (const value of values) {
        reverseMap.set(value, key)
      }
    }

    reverseShorthandsMapCache.set(context, reverseMap)
  }

  return reverseMap
}

// Refactored to use cached reverse shorthand map
const resolveLongHand = (context: Generator, name: string): string | undefined => {
  return getReverseShorthandsMap(context).get(name)
}

// Refactored to arrow function, removed async
const resolveShorthands = (context: Generator, name: string): string[] | undefined => {
  return context.utility.getPropShorthandsMap().get(name)
}

runAsWorker(run as any)
