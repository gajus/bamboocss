import type { Config, LoadConfigResult, StaticCssOptions, UserConfig } from '@bamboocss/types'
import { useMemo, useRef } from 'react'
import { Generator } from '@bamboocss/generator'
import { merge } from 'merge-anything'
import { resolveConfig } from '@/src/lib/config/resolve-config'
import { mergeHooks } from '@bamboocss/config/merge'
import { pluginLightningcssWasm } from '@/src/lib/lightningcss-plugin'

const defaultConfig = resolveConfig({
  cwd: '',
  include: [],
  outdir: 'styled-system',
  preflight: true,
  staticCss: { recipes: { playgroundError: ['*'] } as StaticCssOptions['recipes'] },
})!

export const useBambooContext = (userConfig: Config | null): Generator & { error?: unknown } => {
  const previousContext = useRef<(Generator & { error?: unknown }) | null>(null)

  const createContext = (config: UserConfig) => {
    const plugins = (config.plugins ?? []).map((plugin) =>
      plugin.name.includes('lightningcss') ? pluginLightningcssWasm() : plugin,
    )
    const resolvedConfig = { ...config, plugins }
    const result: LoadConfigResult = {
      dependencies: [],
      serialized: '',
      deserialize: () => resolvedConfig,
      path: '',
      hooks: mergeHooks(plugins),
      config: resolvedConfig,
    }

    return new Generator(result)
  }

  const getDefaultContext = () => createContext(defaultConfig)

  // userConfig reference is stable (from useState in useConfig) —
  // only changes when user edits the config tab, not on source keystrokes
  return useMemo(() => {
    let config
    let error: unknown

    try {
      config = resolveConfig({
        cwd: '',
        include: [],
        outdir: 'styled-system',
        preflight: true,
        ...userConfig,
        staticCss: merge(userConfig?.staticCss, {
          recipes: { playgroundError: ['*'] } as StaticCssOptions['recipes'],
        }),
      })
    } catch (e) {
      config = defaultConfig
      error = e
    }

    if (error) {
      // Return stable reference when there's an error to prevent cursor jumps
      const ctx = (previousContext.current ?? getDefaultContext()) as Generator & { error?: unknown }
      ctx.error = error
      return ctx
    }

    try {
      // in event of error (invalid token format), use previous generator
      const context = createContext(config!)
      previousContext.current = context
      return context
    } catch {
      if (previousContext.current) {
        return previousContext.current!
      }

      // or use default config cause we always need a context
      previousContext.current = getDefaultContext()

      return previousContext.current
    }
  }, [userConfig])
}
