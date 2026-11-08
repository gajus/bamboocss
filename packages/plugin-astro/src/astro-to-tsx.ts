import { logger } from '@bamboocss/logger'
import type { BambooPlugin } from '@bamboocss/types'
import { createRequire } from 'node:module'
import { prepareAstroTemplate } from './astro-template'
import { isValidTsx } from '@bamboocss/node/syntax'

/** What a `<script>` Astro reports converting: `processed-module` is one it bundles. */
interface AstroScript {
  type: string
  content: string
}

type ConvertToTsx = (
  source: string,
  options: { filename?: string },
) => { code: string; metaRanges?: { scripts?: AstroScript[] | null } }

/** What a `<script>` `@astrojs/compiler-rs` reports hoisting: `inline` is one it bundles. */
interface HoistedScript {
  type: string
  code?: string
}

type Transform = (source: string, options: { filename?: string }) => { code: string; scripts?: HoistedScript[] | null }

/**
 * The compilers a `.astro` file is read with: `@astrojs/compiler-rs`'s `transform`, and
 * `@astrojs/compiler`'s `convertToTSX` for what that cannot read.
 */
export interface AstroCompiler {
  transform?: Transform
  convertToTSX?: ConvertToTsx
}

/**
 * The compilers to read `.astro` files with, of those `require` can load.
 *
 * `@astrojs/compiler-rs` first. Astro 7 depends on it rather than on `@astrojs/compiler`, so a
 * project on it had no compiler here, and each of its `.astro` files was read as empty, without a
 * word. Its `transform` is synchronous, as `parser:before` is, and reads a template as Astro's own
 * build does. `@astrojs/compiler`, which Astro 6 and before depend on, through the `sync` entry for
 * the same reason. Each is an optional peer: a project with `.astro` files has the one its `astro`
 * depends on.
 *
 * One that is there and fails to load — a platform binary missing, a Node with no `require` of an
 * ES module — is said, rather than read as one to install.
 */
export const loadAstroCompiler = (require: NodeJS.Require = createRequire(import.meta.url)): AstroCompiler | null => {
  const failures: string[] = []
  const load = <T>(id: string): T | undefined => {
    try {
      return require(id) as T
    } catch (error) {
      const absent = (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' && String(error).includes(`'${id}'`)
      if (!absent) failures.push(`\`${id}\` is installed and failed to load: ${(error as Error).message ?? error}`)
      return undefined
    }
  }
  const transform = load<{ transform: Transform }>('@astrojs/compiler-rs')?.transform
  const convertToTSX = load<{ convertToTSX: ConvertToTsx }>('@astrojs/compiler/sync')?.convertToTSX
  if (transform || convertToTSX) {
    for (const failure of failures) logger.debug('astro', failure)
    return { transform, convertToTSX }
  }
  logger.warn(
    'astro',
    'No Astro compiler could be loaded, so nothing in a `.astro` file is extracted. ' +
      ['Install `@astrojs/compiler-rs` for Astro 7, or `@astrojs/compiler` for Astro 6 and before.', ...failures].join(
        '\n',
      ),
  )
  return null
}

/**
 * Loaded the first time a `.astro` file is parsed after the plugin is explicitly registered.
 */
let compiler: AstroCompiler | null | undefined
const loaded = () => (compiler === undefined ? (compiler = loadAstroCompiler()) : compiler)

/** The inline source map Astro appends, which nothing downstream reads. */
const SOURCE_MAP_COMMENT = /\n\/\/# sourceMappingURL=data:[^\n]*\s*$/

/** A static `import` statement starting a line: a binding clause and `from`, or neither. */
const IMPORT_STATEMENT = /^[ \t]*import\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?(['"])[^'"\n]+\1[ \t]*;?/gm

/**
 * A bundled `<script>` as module code: its imports at the top level, where they bind, and the
 * rest in a block of its own, so its declarations do not meet the frontmatter's.
 */
const moduleCode = (script: string) => {
  const imports: string[] = []
  const body = script.replace(IMPORT_STATEMENT, (statement) => {
    imports.push(statement.trim())
    return ''
  })
  // `export` cannot stand in a block; at the top level a name it shares with the frontmatter is
  // tolerated by extraction, and the calls are what is read.
  return `${imports.join('\n')}\n${/^[ \t]*export\b/m.test(body) ? body : `{\n${body}\n}`}`
}

/**
 * The component, and each `<script>` Astro bundles as module code after it.
 *
 * Neither compiler's output holds a bundled script where its calls are read: the TSX has it inside
 * an arrow function, where its imports bind nothing, and the compiled module only names it. So no
 * call in one was seen — while Vite compiles the script, and its classes shipped with no rule.
 */
const withScripts = (code: string, scripts: string[]) =>
  scripts.length ? `${code}\n${scripts.map(moduleCode).join('\n')}\n` : code

/** Whether code parses as extraction will parse it: a parse error there fails the whole file. */
const parses = (code: string) => {
  try {
    return isValidTsx(code)
  } catch {
    return true
  }
}

const transformed = (transform: Transform, code: string, filename: string | undefined) => {
  let result: ReturnType<Transform>
  try {
    result = transform(code, { filename })
  } catch {
    return
  }
  // A component it cannot read comes back as no code, with the diagnostics Astro's own build
  // reports for it.
  if (!result.code) return
  const scripts = (result.scripts ?? []).flatMap((script) =>
    script.type === 'inline' && script.code ? [script.code] : [],
  )
  return withScripts(result.code, scripts)
}

const converted = (convertToTSX: ConvertToTsx, code: string, filename: string | undefined) => {
  let result: ReturnType<ConvertToTsx>
  try {
    result = convertToTSX(code, { filename })
  } catch {
    return
  }
  const scripts = (result.metaRanges?.scripts ?? []).flatMap((script) =>
    script.type === 'processed-module' ? [script.content] : [],
  )
  return withScripts(result.code.replace(SOURCE_MAP_COMMENT, '\n'), scripts)
}

/**
 * A `.astro` file as code the extractor can parse.
 *
 * Nothing converted these before: the TypeScript parser read the raw file, recovering from the
 * `---` fences and the template well enough to find calls in it. Oxc, which does all extraction
 * now, rejects that text, failing the build on every Astro component.
 *
 * Either compiler keeps every expression the template evaluates, `class={css({ … })}` included.
 * `@astrojs/compiler-rs` compiles the component to the module Astro serves. A component it cannot
 * read — one in a project on Astro 6, which takes templates Astro 7 does not — is converted by
 * `@astrojs/compiler` instead, when that is there too, to the TSX Astro's language tools
 * type-check against: the frontmatter as module code, the template as JSX in a fragment.
 *
 * That conversion misreads two shapes of template, and the TSX it gives for them does not parse;
 * see `prepareAstroTemplate`. A template holding one is converted again prepared, if its TSX does
 * not parse, and that kept only if it does, so a component that converts today is converted as
 * it was.
 *
 * A component neither can read comes back as nothing: it fails Astro's own compile with a far
 * better message than any this could give, and there is nothing to extract from it here.
 */
export const astroToTsx = (code: string, filename?: string, astro = loaded()) => {
  if (!astro) return ''
  const compiled = astro.transform && transformed(astro.transform, code, filename)
  if (compiled !== undefined) return compiled
  if (!astro.convertToTSX) return ''
  const tsx = converted(astro.convertToTSX, code, filename)
  if (tsx === undefined) return ''
  // Nearly every template holds neither shape, and then there is nothing to retry: it is not
  // parsed here as well.
  const prepared = prepareAstroTemplate(code)
  if (prepared === code || parses(tsx)) return tsx
  const retried = converted(astro.convertToTSX, prepared, filename)
  return retried !== undefined && parses(retried) ? retried : tsx
}

/** Register Astro component extraction in the Bamboo config. */
export const pluginAstro = (): BambooPlugin => ({
  name: '@bamboocss/plugin-astro',
  hooks: {
    'parser:before': ({ filePath, content }) => {
      if (filePath.endsWith('.astro')) return astroToTsx(content, filePath)
    },
  },
})
