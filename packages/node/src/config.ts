import { loadConfig, mergeHooks } from '@bamboocss/config'
import type { Config, BambooPlugin } from '@bamboocss/types'
import { pluginSvelte } from '@bamboocss/plugin-svelte'
import { pluginVue } from '@bamboocss/plugin-vue'
import { pluginAstro } from './astro-to-tsx'
import { BambooContext } from './create-context'
import { copyLaidOver, rememberConfigReload } from './config-reload'
import { loadTsConfig, rememberTsConfigResolutionFiles } from './load-tsconfig'
import { pluginMdx } from './mdx-to-tsx'

const RESOLVED_HOOKS_NAME = '__resolved__'
const AUTO_PARSER_HOOKS = Object.freeze(['vue', 'svelte', 'astro'] as const)
const autoPluginFactories: Record<(typeof AUTO_PARSER_HOOKS)[number], () => BambooPlugin> = {
  astro: pluginAstro,
  svelte: pluginSvelte,
  vue: pluginVue,
}

/**
 * Built-in plugins that are auto-injected when using the CLI or PostCSS plugin.
 * These provide Vue, Svelte and Astro single-file-component support.
 *
 * LightningCSS is not among them any more. It was reached through a `lightningcss: true`
 * config flag whose only job was to push `pluginLightningcss()` into this list — a second
 * way to say something `plugins` already said, and the expensive one: naming the plugin
 * here meant a static import, which made `@bamboocss/plugin-lightningcss` a hard dependency
 * of this package, which put a native binary in every install whether or not the flag was
 * ever set. List the plugin yourself to use it.
 */
function getAutoPlugins(): BambooPlugin[] {
  return AUTO_PARSER_HOOKS.map((identity) => autoPluginFactories[identity]())
}

interface NodeConfigOptions {
  cwd?: string
  config?: Config
  configPath?: string
  dev?: boolean
}

interface PreparedNodeConfig {
  conf: Awaited<ReturnType<typeof loadConfig>>
}

/** Resolve all config state without constructing the parser Project owned by BambooContext. */
async function prepareNodeConfig(
  options: NodeConfigOptions = {},
  // Where the file is found and read from. Read again, it is read from where it was read first,
  // wherever `process.cwd()` has moved since.
  cwd = options.cwd ?? options?.config?.cwd ?? process.cwd(),
): Promise<PreparedNodeConfig> {
  const { config, configPath } = options

  const conf = await loadConfig({ cwd, file: configPath })

  if (config) {
    Object.assign(conf.config, config)
  }

  if (options.cwd) {
    conf.config.cwd = options.cwd
  }

  // The integration's, not the project's: only a dev server knows it is one. Read by
  // `hash: 'auto'`, and fixed for the life of this context so a class name cannot change
  // under the sheet that already named it.
  if (options.dev) {
    conf.config.dev = true
  }

  // Auto plugins run first, then the already-resolved user hooks run after — and MDX's after
  // those, for a file none of them rewrote. @see pluginMdx
  const autoPlugins = getAutoPlugins()
  const mdx = pluginMdx()

  // conf.hooks is already properly merged from the user's plugins by resolveConfig.
  // Prepend auto-plugins before it — don't re-process user plugins to avoid double-execution.
  conf.hooks = mergeHooks([...autoPlugins, { name: RESOLVED_HOOKS_NAME, hooks: conf.hooks }, mdx])
  conf.config.plugins = [...autoPlugins, ...(conf.config.plugins ?? []), mdx]

  const tsconfigResolutionFiles: { value?: readonly string[] } = {}
  const tsConfResult = await loadTsConfig(conf, cwd, tsconfigResolutionFiles)

  if (tsConfResult) {
    Object.assign(conf, tsConfResult)
  }
  rememberTsConfigResolutionFiles(conf, tsconfigResolutionFiles.value ?? [])

  // Read again as it was read now: the file it found, from where it found it, with what was laid
  // over it. A copy of that, taken before anything is handed it — a hook changing `include` in
  // place would otherwise change it for every config read after.
  const again = { ...options, config: copyLaidOver(config), configPath: conf.path }
  rememberConfigReload(conf, async () => (await prepareNodeConfig(again, cwd)).conf)

  return { conf }
}

/**
 * Load config and create context with auto-injected plugins.
 * Used by the CLI and PostCSS plugin.
 */
export async function loadConfigAndCreateContext(options: NodeConfigOptions = {}) {
  const { conf } = await prepareNodeConfig(options)
  return new BambooContext(conf)
}
