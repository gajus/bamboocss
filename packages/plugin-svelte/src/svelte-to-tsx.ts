import { createRequire } from 'node:module'

/**
 * Svelte's compiler, loaded the first time a `.svelte` file is actually parsed.
 *
 * Auto-injected into every project, so a static import would make every build pay to load a
 * compiler most projects never call — the reason `plugin-vue` loads its compiler lazily too.
 * `svelte` is an optional peer: a project with `.svelte` files already has it installed.
 */
type SvelteParse = (source: string, options: { modern: true }) => SvelteRoot
let parseSvelte: SvelteParse | undefined
const parse: SvelteParse = (source, options) =>
  (parseSvelte ??= (createRequire(import.meta.url)('svelte/compiler') as { parse: SvelteParse }).parse)(source, options)

interface SvelteNode {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

interface SvelteRoot {
  instance?: { content: SvelteNode } | null
  module?: { content: SvelteNode } | null
  fragment: SvelteNode
}

/**
 * Keys whose value is JavaScript the component evaluates: an expression, a pattern binding, a
 * block's test. Everything else in the template tree is markup, text or metadata.
 */
const EXPRESSION_KEYS = new Set(['expression', 'test', 'key', 'index'])

/** Keys that never lead to template content and would only cost a walk. */
const SKIPPED_KEYS = new Set(['metadata', 'parent', 'loc'])

/**
 * A `.svelte` file as TypeScript the extractor can parse.
 *
 * This used to wrap the raw template in `<div>…</div>` and hand it over as JSX. Svelte's
 * template language is not JSX: `{#if a > 1}` read as a JSX expression starting with the private
 * name `#if`, `{#each items as item}` as a malformed `for…in`, and a strict parser — Oxc, which
 * does all stylesheet extraction — rejected the whole file, failing the build on any component
 * with a block in it. The TypeScript parser happened to recover, which is why this went unseen.
 *
 * The output is now built from Svelte's own parse tree instead, so it is valid by construction:
 *
 * - The `<script>` contents are kept verbatim, in source order, so imports and local
 *   declarations still resolve.
 * - Every expression the template evaluates — `{css({...})}`, `class={...}`, `class:x={...}`,
 *   `{#if test}`, an `{#each}` key — becomes one expression statement, parenthesized so an
 *   object literal is not read as a block.
 *
 * What is lost is the markup structure, which nothing downstream reads: extraction only needs
 * the calls and the bindings they reference. Template-scoped names (`{#each items as item}`)
 * become free identifiers, which the evaluator treats as unknown — exactly how it treated them
 * inside the old JSX.
 */
export const svelteToTsx = (code: string) => {
  let ast: SvelteRoot
  try {
    ast = parse(code, { modern: true })
  } catch {
    // A component Svelte itself cannot parse will fail Svelte's own compile with a far better
    // message than any this could give; there is nothing to extract from it here.
    return ''
  }

  const scripts = [ast.module, ast.instance]
    .filter((script): script is { content: SvelteNode } => Boolean(script?.content))
    .sort((a, b) => a.content.start - b.content.start)
    .map((script) => code.slice(script.content.start, script.content.end))

  const expressions: string[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    const record = node as SvelteNode
    for (const [key, value] of Object.entries(record)) {
      if (SKIPPED_KEYS.has(key) || !value || typeof value !== 'object') continue
      if (EXPRESSION_KEYS.has(key) && typeof (value as SvelteNode).start === 'number') {
        const expression = value as SvelteNode
        expressions.push(`;(${code.slice(expression.start, expression.end)})`)
        continue
      }
      visit(value)
    }
  }
  visit(ast.fragment)

  return [...scripts, ...expressions].join('\n')
}
