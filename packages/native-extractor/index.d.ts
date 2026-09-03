export interface NativeEntrypoint {
  kind: 'css' | 'pattern' | 'recipe' | 'token'
  modules: string[]
  /** Configured callable exports for this entrypoint. */
  names: string[]
}

export interface NativeLoss {
  prop?: string
  reason: 'unresolvable-value' | 'missing-property' | 'unenumerable-keys' | 'unresolved-raw'
}

export interface NativeCall {
  /** Binding spelling at the call site, including supported namespace/member access. */
  name: string
  importedName: string
  kind: NativeEntrypoint['kind'] | 'tokenValue' | 'dead' | 'jsx'
  module: string
  start: number
  end: number
  /** UTF-16 source range of the root imported binding, used by token accounting. */
  calleeStart: number
  calleeEnd: number
  /** One-based source location of the call. */
  line: number
  column: number
  /** Encoder-ready static fragments, including both enumerable conditional branches. */
  arguments: unknown[]
  /** False when dynamic input was intentionally omitted from the static fragments. */
  complete: boolean
  losses: NativeLoss[]
}

export interface NativeAnalysis {
  calls: NativeCall[]
  errors: string[]
  /** Local source modules whose values contributed to this file's extraction. */
  dependencies: string[]
  /** Missing local candidates whose appearance can redirect extraction. */
  pendingCandidates: string[]
  /** package.json/tsconfig files which selected semantic imports. */
  configurationFiles: string[]
}

export interface NativeSource {
  filename: string
  source: string
}

export interface NativePathMapping {
  pattern: string
  paths: string[]
}

export interface NativeToken {
  path: string
  value?: unknown
  variable?: string
}

export interface NativeProjectOptions {
  cwd?: string
  baseUrl?: string
  paths: NativePathMapping[]
  tokens: NativeToken[]
  jsx: boolean
}

export interface NativeFileAnalysis extends NativeAnalysis {
  filename: string
}

export function analyze(filename: string, source: string, entrypoints: NativeEntrypoint[]): NativeAnalysis
export function analyzeMany(
  sources: NativeSource[],
  entrypoints: NativeEntrypoint[],
  options?: NativeProjectOptions,
): NativeFileAnalysis[]
