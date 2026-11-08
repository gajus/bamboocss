import type { BambooPlugin } from '@bamboocss/types'
import { tsrxToTsx } from './tsrx-to-tsx'

export { tsrxToTsx }

export function pluginTsrx(): BambooPlugin {
  return {
    name: '@bamboocss/plugin-tsrx',
    hooks: {
      'parser:before': ({ filePath, content }) => {
        if (filePath.endsWith('.tsrx')) {
          return tsrxToTsx(content, filePath)
        }
      },
    },
  }
}
