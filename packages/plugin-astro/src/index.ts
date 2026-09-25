import type { BambooPlugin } from '@bamboocss/types'
import { astroToTsx } from './astro-to-tsx'

export { astroToTsx }

export function pluginAstro(): BambooPlugin {
  return {
    name: '@bamboocss/plugin-astro',
    hooks: {
      'parser:before': ({ filePath, content }) => {
        if (filePath.endsWith('.astro')) {
          return astroToTsx(content, filePath)
        }
      },
    },
  }
}
