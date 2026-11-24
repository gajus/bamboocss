import { mergeConfigs, mergeHooks } from '@bamboocss/config'
import { RuleProcessor } from '@bamboocss/core'
import { Generator } from '@bamboocss/generator'
import { BambooContext } from '@bamboocss/node'
import { omit, parseJson, pick, stringifyJson, traverse } from '@bamboocss/shared'
import type { Config, LoadConfigResult, UserConfig } from '@bamboocss/types'
import { assertNoRemovedOptions } from '../../config/src/validation/validate-removed'
import { fixturePreset } from './config'

const hookUtils = {
  omit,
  pick,
  traverse,
}

const defaults: UserConfig = {
  cwd: '',
  outdir: 'styled-system',
  include: [],
  //
  cssVarRoot: ':where(html)',
  // Production hashes class names by default, and a fixture context is production. Readable
  // names are what make an emitted rule reviewable, so the snapshots keep them; a test about
  // naming states the setting it is about.
  hash: false,
}
const config = Object.assign({}, fixturePreset, defaults)

export const fixtureDefaults = {
  dependencies: [],
  config,
  path: '',
  hooks: {},
  serialized: stringifyJson(config),
  deserialize: () => parseJson(stringifyJson(config)),
} as LoadConfigResult

/**
 * Whether a test wants a context with none of the fixture defaults.
 *
 * Spelled `presets: []` because that is what it means to a real config now — the list is
 * authoritative, so an empty one loads nothing. It used to be `eject: true`, an option
 * whose whole job was to change what a *different* option meant.
 */
const isBare = (userConfig?: Config) => userConfig?.presets?.length === 0

/**
 * A test's config as the product resolves one: laid over the fixture preset, refused if it sets an
 * option that no longer exists, and given the hooks its plugins bring, with their `config:resolved`
 * applied.
 *
 * Hooks come from `plugins`, the same and only source the real pipeline reads. Kept in step with
 * it deliberately: a fixture that accepted a config shape the product does not would let a test
 * pass against an input no user can write. Four did: `createGeneratorContext` left a plugin's
 * hooks out and nothing refused a removed option, so two tests handing it `plugins`, and one each
 * handing a fixture a top-level `hooks` or `globalCss`, ran without what they were written about,
 * and passed.
 */
const resolveUserConfig = (userConfig?: Config) => {
  let resolvedConfig = mergeConfigs([isBare(userConfig) ? {} : fixtureDefaults.config, userConfig ?? {}]) as UserConfig
  // On the merged config, as the product reads it.
  assertNoRemovedOptions(resolvedConfig)

  const plugins = userConfig?.plugins ?? []
  const hooks = mergeHooks(plugins)

  // This allows editing the config before the context is created. Only the user's plugins,
  // not the presets', so that this function can stay sync — and applied one plugin at a time
  // rather than through `hooks`, because `mergeHooks` wraps `config:resolved` in an async
  // reducer whose promise this would assign to the config wholesale.
  for (const plugin of plugins) {
    const result = plugin.hooks?.['config:resolved']?.({
      config: resolvedConfig,
      path: fixtureDefaults.path,
      dependencies: fixtureDefaults.dependencies,
      utils: hookUtils,
    })
    if (result) {
      resolvedConfig = result as UserConfig
    }
  }

  return { resolvedConfig, hooks }
}

export const createGeneratorContext = (userConfig?: Config) => {
  const { resolvedConfig, hooks } = resolveUserConfig(userConfig)
  return new Generator({ ...fixtureDefaults, hooks, config: resolvedConfig })
}

export const createContext = (userConfig?: Config & Pick<Partial<LoadConfigResult>, 'tsconfig' | 'tsOptions'>) => {
  const { resolvedConfig, hooks } = resolveUserConfig(userConfig)

  return new BambooContext({
    ...fixtureDefaults,
    hooks,
    // Path mappings reach the context through `conf`, not through the config, so a test
    // exercising alias resolution has to supply them here.
    ...(userConfig?.tsOptions ? { tsOptions: userConfig.tsOptions } : {}),
    config: Object.assign({}, defaults, resolvedConfig),
    tsconfig: {
      ...userConfig?.tsconfig,
      // @ts-expect-error
      useInMemoryFileSystem: true,
    },
  })
}

export const createRuleProcessor = (userConfig?: Config) => {
  const ctx = createContext(userConfig)
  return new RuleProcessor(ctx)
}
