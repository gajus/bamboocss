import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { logger } from '@bamboocss/logger'
import { analyze, loadConfigAndCreateContext, type BambooContext } from '@bamboocss/node'
import { TOKEN_CATEGORIES } from '@bamboocss/token-dictionary'
import { Console } from 'node:console'
import { resolve } from 'node:path'
import * as z from 'zod/v4'
import { version } from '../package.json'
import { createContextSource } from './context-source'

const tokenCategorySchema = z
  .enum(TOKEN_CATEGORIES as [string, ...string[]])
  .optional()
  .describe('Filter by token category')

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
})

export interface CreateMcpServerOptions {
  ctx: BambooContext
  /**
   * The context as of now: `startMcpServer` passes one that reloads the config when it has changed
   * on disk. Without it, every tool answers from `ctx`.
   */
  current?: () => Promise<BambooContext>
}

/**
 * A recipe's or a pattern's name, checked against the config as of the call.
 *
 * Not an enum: a request is validated against the schema before any tool runs, so an enum built
 * from the config the server started with rejected a recipe added since. The names are still in
 * the description, refreshed when the config reloads.
 */
const nameSchema = (kind: string, names: string[]) =>
  z
    .string()
    .optional()
    .describe(names.length ? `Filter by ${kind} name: ${names.join(', ')}` : `Filter by ${kind} name`)

const noSuchName = (kind: string, name: string, names: string[]) => ({
  content: [
    {
      type: 'text' as const,
      text: `No ${kind} is named \`${name}\`. ${names.length ? `The ${kind}s are: ${names.join(', ')}.` : `The config defines none.`}`,
    },
  ],
  isError: true,
})

/**
 * Create an MCP server with all tools registered.
 * This is separated from `startMcpServer` to allow testing with custom transports.
 */
export function createMcpServer(options: CreateMcpServerOptions) {
  const server = new McpServer({
    name: '@bamboocss/mcp',
    version,
  })

  // The names each filter takes, refreshed on the tool's schema when a reload changes them.
  let recipeNames = options.ctx.recipes.keys
  let patternNames = options.ctx.patterns.keys
  let seen = options.ctx

  const context = async () => {
    const ctx = options.current ? await options.current() : options.ctx
    if (ctx === seen) return ctx
    seen = ctx

    const nextRecipes = ctx.recipes.keys
    if (nextRecipes.join() !== recipeNames.join()) {
      recipeNames = nextRecipes
      recipesTool.update({ paramsSchema: { name: nameSchema('recipe', recipeNames) } })
    }
    const nextPatterns = ctx.patterns.keys
    if (nextPatterns.join() !== patternNames.join()) {
      patternNames = nextPatterns
      patternsTool.update({ paramsSchema: { name: nameSchema('pattern', patternNames) } })
    }
    return ctx
  }

  // Register tools
  server.registerTool(
    'get_tokens',
    {
      description: 'Get all design tokens with their values, CSS variables, and usage examples',
      inputSchema: { category: tokenCategorySchema },
    },
    async ({ category }) => {
      const ctx = await context()
      const spec = ctx.getSpecOfType('tokens')
      const data = category ? spec.data.filter((group: any) => group.type === category) : spec.data
      return json({ type: spec.type, data })
    },
  )

  server.registerTool(
    'get_semantic_tokens',
    {
      description: 'Get semantic tokens with their conditional values (responsive, color modes)',
      inputSchema: { category: tokenCategorySchema },
    },
    async ({ category }) => {
      const ctx = await context()
      const spec = ctx.getSpecOfType('semantic-tokens')
      const data = category ? spec.data.filter((group: any) => group.type === category) : spec.data
      return json({ type: spec.type, data })
    },
  )

  const recipesTool = server.registerTool(
    'get_recipes',
    {
      description: 'Get component recipes with their variants, default values, and usage examples',
      inputSchema: { name: nameSchema('recipe', recipeNames) },
    },
    async ({ name }) => {
      const ctx = await context()
      if (name && !recipeNames.includes(name)) return noSuchName('recipe', name, recipeNames)
      const spec = ctx.getSpecOfType('recipes')
      const data = name ? spec.data.filter((item: any) => item.name === name) : spec.data
      return json({ type: spec.type, data })
    },
  )

  const patternsTool = server.registerTool(
    'get_patterns',
    {
      description: 'Get layout patterns with their properties and usage examples',
      inputSchema: { name: nameSchema('pattern', patternNames) },
    },
    async ({ name }) => {
      const ctx = await context()
      if (name && !patternNames.includes(name)) return noSuchName('pattern', name, patternNames)
      const spec = ctx.getSpecOfType('patterns')
      const data = name ? spec.data.filter((item: any) => item.name === name) : spec.data
      return json({ type: spec.type, data })
    },
  )

  server.registerTool(
    'get_conditions',
    { description: 'Get all conditions (breakpoints, pseudo-classes, color modes) and their CSS values' },
    async () => json((await context()).getSpecOfType('conditions')),
  )

  server.registerTool('get_keyframes', { description: 'Get keyframe animations defined in the theme' }, async () =>
    json((await context()).getSpecOfType('keyframes')),
  )

  server.registerTool(
    'get_mixins',
    { description: 'Get the named style bundles the theme declares, applied through the `mixin` style property' },
    async () => json((await context()).getSpecOfType('mixins')),
  )

  server.registerTool('get_color_palette', { description: 'Get the color palette with all color values' }, async () =>
    json((await context()).getSpecOfType('color-palette')),
  )

  server.registerTool(
    'get_config',
    { description: 'Get the resolved Bamboo CSS configuration including paths, JSX settings, and output options' },
    async () => json((await context()).config),
  )

  server.registerTool(
    'get_usage_report',
    {
      description:
        'Get a usage report of the design system across the codebase: design tokens, recipes, patterns, utilities and keyframes. Shows which are used and how often, and which are defined but unused. Useful for auditing, cleanup, and identifying dead code. `unused` lists the names the build keeps nothing for, the ones safe to remove; a `usedCount` counts direct uses only, so a token or keyframes reached through another token, a mixin or global css can be used at a count of 0.',
      inputSchema: {
        scope: z
          .enum(['all', 'token', 'recipe', 'pattern', 'utility', 'keyframe'])
          .optional()
          .describe('Analysis scope: token, recipe, pattern, utility, keyframe, or all (default)'),
      },
    },
    async ({ scope }) => {
      const ctx = await context()
      const result = await analyze(ctx)
      const includes = (part: string) => !scope || scope === 'all' || scope === part

      const report: Record<string, unknown> = {}

      if (includes('token') && !ctx.tokens.isEmpty) {
        report.tokens = result.getTokenReport().report.getSummary()
      }

      if (includes('recipe') && !ctx.recipes.isEmpty()) {
        report.recipes = result.getRecipeReport().report
      }

      if (includes('pattern') && !ctx.patterns.isEmpty()) {
        report.patterns = result.getPatternReport()
      }

      if (includes('utility')) {
        report.utilities = result.getUtilityReport()
      }

      if (includes('keyframe')) {
        const keyframes = result.getKeyframeReport()
        if (keyframes.length) report.keyframes = keyframes
      }

      // The build's own answer, beside counts that only see direct uses. An agent reading
      // `usedCount: 0` as unused deleted keyframes a semantic token still reached.
      // Only the kinds asked for: an empty list under a kind nobody asked about reads as "none".
      const kinds = (['tokens', 'recipes', 'patterns', 'keyframes'] as const).filter((kind) =>
        includes(kind.slice(0, -1)),
      )
      if (kinds.length) {
        const unused = result.getUnused(kinds)
        report.unused = Object.fromEntries(kinds.map((kind) => [kind, unused[kind]]))
      }

      return json(report)
    },
  )

  return server
}

/**
 * Keep stdout to the protocol, and leave when the client has gone.
 *
 * Over stdio, stdout carries JSON-RPC and nothing else: a line printed there that is not a
 * message corrupts the stream. `silent` quieted the logger, but loading the config sets its level
 * from `logLevel` again, and `get_usage_report` then printed `Analyzing N file(s)` into it. The
 * `console` methods that write to stdout now write to stderr, which a client shows as the server's
 * log; the rest — `table`, `group`, `count` — print through `log`.
 *
 * A client that has gone leaves stdout without a reader, and a write to it fails with `EPIPE`.
 * Unheard, that reached the handler `@bamboocss/node` installs for uncaught errors, which logged
 * it — into a pipe without a reader, failing again — and kept the process alive doing so. Losing
 * stderr alone is a client that stopped reading the log, which costs only the log.
 *
 * That needs a write, though, and a client that goes closes stdin first. Nothing listened for it,
 * so a config keeping the event loop busy — a timer, a watcher of its own — kept the server running
 * with no client, until something killed it. Stdin ending is the client gone, so the server leaves.
 *
 * And an uncaught error is the end of it, as Node would have it: the handler `@bamboocss/node`
 * installs logs one and goes on, which suits a watch, but the logger here can be silenced — by
 * `silent`, by the config's `logLevel` — and a server whose state an error left unknown went on
 * answering, saying nothing. It is written to stderr, which a client shows as the server's log,
 * and the server leaves, for the client to start another.
 */
let guarded = false
function guardStdio() {
  if (guarded) return
  guarded = true

  const toStderr = new Console({ stdout: process.stderr, stderr: process.stderr })
  for (const method of ['log', 'info', 'debug', 'dir'] as const) {
    console[method] = toStderr[method].bind(toStderr)
  }

  const withoutReader = (error: NodeJS.ErrnoException) =>
    error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED'
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (withoutReader(error)) process.exit(0)
    throw error
  })
  process.stderr.on('error', (error: NodeJS.ErrnoException) => {
    if (!withoutReader(error)) throw error
  })

  const leave = () => process.exit(0)
  process.stdin.once('end', leave)
  process.stdin.once('close', leave)

  const fatal = (what: string) => (error: unknown) => {
    try {
      process.stderr.write(
        `Bamboo CSS MCP server: ${what}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      )
    } catch {
      // No log to write to: the client is gone too.
    }
    process.exit(1)
  }
  process.on('uncaughtException', fatal('uncaught exception'))
  process.on('unhandledRejection', fatal('unhandled rejection'))
}

export interface StartMcpServerOptions {
  cwd?: string
  config?: string
  silent?: boolean
  transport?: Transport
}

/**
 * Start the MCP server with the given options.
 * By default, uses StdioServerTransport for CLI usage.
 */
export async function startMcpServer(options: StartMcpServerOptions = {}) {
  const { cwd = process.cwd(), config: configPath, silent = false, transport } = options

  // Before the config loads, which logs at the level the config sets.
  if (!transport) guardStdio()

  if (silent) {
    logger.level = 'silent'
  }

  const resolvedCwd = resolve(cwd)
  const resolvedConfigPath = configPath ? resolve(configPath) : undefined

  // Loaded now, so a config that fails to load fails the start, and again whenever it changes.
  const current = createContextSource(() =>
    loadConfigAndCreateContext({
      cwd: resolvedCwd,
      configPath: resolvedConfigPath,
    }),
  )
  const ctx = await current()

  // Create MCP server
  const server = createMcpServer({ ctx, current })

  // Connect to transport
  const serverTransport = transport ?? new StdioServerTransport()
  await server.connect(serverTransport)

  // Use stderr for logging (stdout is reserved for MCP protocol)
  console.error('Bamboo CSS MCP server started')
  console.error(`Working directory: ${resolvedCwd}`)
  if (resolvedConfigPath) {
    console.error(`Config path: ${resolvedConfigPath}`)
  }

  return server
}
