import { setLogStream } from '@bamboocss/node'
import { createRequire } from 'module'
import path from 'path'
import type { PluginCreator, Result } from 'postcss'

const customRequire = createRequire(__dirname)

const PLUGIN_NAME = 'bamboocss'

export interface PluginOptions {
  configPath?: string
  cwd?: string
  logfile?: string
  allow?: RegExp[]
}

const interopDefault = (obj: any) => (obj && obj.__esModule ? obj.default : obj)

export const loadConfig = () => interopDefault(customRequire('@bamboocss/postcss'))

let stream: ReturnType<typeof setLogStream> | undefined

const REMOVED = (from?: string) =>
  `bamboocss: @bamboocss/postcss is not a styling integration` +
  (from ? ` (processing ${from})` : '') +
  '. Add `@bamboocss/vite` to your Vite config and import `virtual:bamboo.css`. ' +
  'See https://bamboocss.com/docs/installation/vite'

export const bamboocss: PluginCreator<PluginOptions> = (options = {}) => {
  const { logfile, allow } = options

  if (!stream && logfile) {
    stream = setLogStream({ cwd: options.cwd, logfile })
  }

  const postcssProcess = (root: { toString(): string }, helper: { result: Result }) => {
    const fileName = helper.result.opts.from
    if (shouldSkip(fileName, allow)) return
    if (!isLayerRoot(root)) return
    throw new Error(REMOVED(fileName))
  }

  return {
    postcssPlugin: PLUGIN_NAME,
    Once: postcssProcess,
  }
}

bamboocss.postcss = true

export default bamboocss

const isLayerRoot = (root: { toString(): string }) =>
  /@layer\s+[^;]*\b(reset|base|tokens|recipes|utilities)\b/.test(root.toString())

const nodeModulesRegex = /node_modules/

function isValidCss(file: string) {
  const [filePath] = file.split('?')
  return path.extname(filePath) === '.css'
}

const shouldSkip = (fileName: string | undefined, allow: PluginOptions['allow']) => {
  if (!fileName) return true
  if (!isValidCss(fileName)) return true
  if (allow?.some((p) => p.test(fileName))) return false
  return nodeModulesRegex.test(fileName)
}
