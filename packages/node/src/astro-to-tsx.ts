import type { BambooPlugin } from '@bamboocss/types'
import { createRequire } from 'node:module'

/** What a `<script>` Astro reports converting: `processed-module` is one it bundles. */
interface AstroScript {
  type: string
  content: string
}

type ConvertToTsx = (
  source: string,
  options: { filename?: string },
) => { code: string; metaRanges?: { scripts?: AstroScript[] | null } }

/**
 * Astro's compiler, loaded the first time a `.astro` file is actually parsed.
 *
 * Every build carries this hook, so a static import would make every build pay to load a
 * compiler most projects never call — the reason the Vue and Svelte plugins load theirs lazily
 * too. The `sync` entry because `parser:before` is synchronous. `@astrojs/compiler` is an
 * optional peer: `astro` depends on it, so a project with `.astro` files already has it.
 */
let convert: ConvertToTsx | undefined
const load = (): ConvertToTsx =>
  (convert ??= (createRequire(import.meta.url)('@astrojs/compiler/sync') as { convertToTSX: ConvertToTsx })
    .convertToTSX)

/** The inline source map Astro appends, which nothing downstream reads. */
const SOURCE_MAP_COMMENT = /\n\/\/# sourceMappingURL=data:[^\n]*\s*$/

/** A static `import` statement starting a line: a binding clause and `from`, or neither. */
const IMPORT_STATEMENT = /^[ \t]*import\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?(['"])[^'"\n]+\1[ \t]*;?/gm

/**
 * A bundled `<script>` as module code: its imports at the top level, where they bind, and the
 * rest in a block of its own, so its declarations do not meet the frontmatter's.
 */
const moduleCode = (script: AstroScript) => {
  const imports: string[] = []
  const body = script.content.replace(IMPORT_STATEMENT, (statement) => {
    imports.push(statement.trim())
    return ''
  })
  // `export` cannot stand in a block; at the top level a name it shares with the frontmatter is
  // tolerated by extraction, and the calls are what is read.
  return `${imports.join('\n')}\n${/^[ \t]*export\b/m.test(body) ? body : `{\n${body}\n}`}`
}

/**
 * A `.astro` file as TSX the extractor can parse.
 *
 * Nothing converted these before: the TypeScript parser read the raw file, recovering from the
 * `---` fences and the template well enough to find calls in it. Oxc, which does all extraction
 * now, rejects that text, failing the build on every Astro component.
 *
 * Astro's own TSX output is what its language tools type-check against — the frontmatter as
 * module code, the template as JSX in a fragment — so it is valid by construction and keeps
 * every expression the template evaluates, `class={css({ … })}` included.
 */
export const astroToTsx = (code: string, filename?: string) => {
  let result: ReturnType<ConvertToTsx>
  try {
    result = load()(code, { filename })
  } catch {
    // A component Astro itself cannot convert will fail Astro's own compile with a far better
    // message than any this could give; there is nothing to extract from it here.
    return ''
  }
  const tsx = result.code.replace(SOURCE_MAP_COMMENT, '\n')
  // A `<script>` Astro bundles is in its TSX only inside an arrow function, where the script's
  // imports bind nothing, so no call in it was seen — while Vite compiles the script, and its
  // classes shipped with no rule. Each one is appended as module code as well.
  const scripts = (result.metaRanges?.scripts ?? []).filter((script) => script.type === 'processed-module')
  if (!scripts.length) return tsx
  return `${tsx}\n${scripts.map(moduleCode).join('\n')}\n`
}

/** Built in, rather than a plugin package: Astro support is part of the Vite integration. */
export const pluginAstro = (): BambooPlugin => ({
  name: '@bamboocss/node:astro',
  hooks: {
    'parser:before': ({ filePath, content }) => {
      if (filePath.endsWith('.astro')) return astroToTsx(content, filePath)
    },
  },
})
