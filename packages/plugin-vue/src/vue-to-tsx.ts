import { createRequire } from 'node:module'

/**
 * Vue's SFC compiler, loaded the first time a `.vue` file is actually parsed.
 *
 * This plugin is auto-injected into every project, so a static import made every build of every
 * project — Vue or not — pay 55ms to load a compiler most of them never call. The `parser:before`
 * hook is synchronous, so this is a lazy `require` rather than a dynamic import.
 */
let parseSfc: typeof import('@vue/compiler-sfc').parse | undefined
const parse: typeof import('@vue/compiler-sfc').parse = (...args) => {
  const load = (parseSfc ??= createRequire(import.meta.url)('@vue/compiler-sfc').parse)
  return load(...args)
}

/**
 * @see https://github.com/vuejs/core/blob/d2c3d8b70b2df6e16f053a7ac58e6b04e7b2078f/packages/compiler-core/src/ast.ts#L28-L60
 * import { NodeTypes } from '@vue/compiler-core' isn't working for some reason (?)
 *  Cannot read properties of undefined (reading 'ELEMENT')
 */
const NodeTypes = {
  ELEMENT: 1,
  SIMPLE_EXPRESSION: 4,
  INTERPOLATION: 5,
  DIRECTIVE: 7,
} as const

interface TemplateNode {
  type: number
  props?: Array<{ type: number; name?: string; exp?: { type: number; content: string } }>
  children?: TemplateNode[]
  content?: { type: number; content: string }
  branches?: TemplateNode[]
}

/**
 * Directives whose expression is not a value: `v-for="item in items"` is a loop header and
 * `v-slot="{ item }"` a parameter list. Neither is a JavaScript expression on its own, and
 * neither can hold a style call.
 */
const NOT_AN_EXPRESSION = new Set(['for', 'slot'])

/**
 * A `.vue` file as TypeScript the extractor can parse.
 *
 * This used to rewrite `:class="…"` into `class={…}` inside the raw `<template>` and hand the
 * result over as JSX. A template is not JSX: `{{ items[0] }}` read as an object literal with a
 * computed key, and a strict parser — Oxc, which does all stylesheet extraction — rejected the
 * whole file, failing the build on any component with a common interpolation in it. The
 * TypeScript parser happened to recover, which is why this went unseen.
 *
 * The output is now built from Vue's own parse tree instead, so it is valid by construction:
 * the `<script>`/`<script setup>` contents verbatim, then every expression the template
 * evaluates — bound attributes, event handlers, `v-if`, interpolations — as one parenthesized
 * expression statement each. The markup structure is dropped; extraction only ever needed the
 * calls and the bindings they reference.
 */
export const vueToTsx = (code: string) => {
  let parsed: ReturnType<typeof import('@vue/compiler-sfc').parse>
  try {
    parsed = parse(code)
  } catch {
    return ''
  }
  const { descriptor } = parsed

  const scripts = [descriptor.script, descriptor.scriptSetup]
    .filter((script): script is NonNullable<typeof script> => Boolean(script?.content))
    .sort((a, b) => a.loc.start.offset - b.loc.start.offset)
    .map((script) => script.content)

  const expressions: string[] = []
  const stack: TemplateNode[] = [...((descriptor.template?.ast?.children ?? []) as unknown as TemplateNode[])]

  // recursion-free traversal
  while (stack.length) {
    const node = stack.pop()
    if (!node) continue

    if (node.type === NodeTypes.INTERPOLATION && node.content?.type === NodeTypes.SIMPLE_EXPRESSION) {
      expressions.push(node.content.content)
    }

    for (const prop of node.props ?? []) {
      if (prop.type !== NodeTypes.DIRECTIVE || !prop.exp || prop.exp.type !== NodeTypes.SIMPLE_EXPRESSION) continue
      if (prop.name && NOT_AN_EXPRESSION.has(prop.name)) continue
      expressions.push(prop.exp.content)
    }

    for (const child of node.children ?? []) stack.push(child)
    for (const branch of node.branches ?? []) stack.push(branch)
  }

  // Source order, so the output reads in the order the template does; the stack reversed it.
  expressions.reverse()

  return [...scripts, ...expressions.map((expression) => `;(${expression})`)].join('\n')
}
