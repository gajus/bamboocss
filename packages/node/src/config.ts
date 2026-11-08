import { loadConfig } from '@bamboocss/config'
import type { Config } from '@bamboocss/types'
import { BambooContext } from './create-context'
import { copyLaidOver, rememberConfigReload } from './config-reload'
import { loadTsConfig, rememberTsConfigResolutionFiles } from './load-tsconfig'

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
 * Load config and create context with the explicitly configured plugins.
 * Used by the CLI and PostCSS plugin.
 */
export async function loadConfigAndCreateContext(options: NodeConfigOptions = {}) {
  const { conf } = await prepareNodeConfig(options)
  return new BambooContext(conf)
}
