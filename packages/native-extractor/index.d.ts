export interface NativeEntrypoint {
  kind: 'css' | 'pattern' | 'recipe' | 'token'
  modules: string[]
  /** Configured callable exports for this entrypoint. */
  names: string[]
}

export interface NativeCall {
  /** Local binding at the call site. */
  name: string
  importedName: string
  kind: NativeEntrypoint['kind']
  start: number
  end: number
  /** One-based source location of the call. */
  line: number
  column: number
  arguments: unknown[]
  /** False when at least one argument requires the JavaScript/TypeScript fallback. */
  complete: boolean
}

export interface NativeAnalysis {
  calls: NativeCall[]
  errors: string[]
  /** True only when this file can bypass the TypeScript extractor without losing semantics. */
  safe: boolean
  fallbackReason?: 'diagnostic' | 'unknown-entrypoint-call' | 'non-call-binding-use' | 'unsupported-call'
}

export interface NativeSource {
  filename: string
  source: string
}

export interface NativeFileAnalysis extends NativeAnalysis {
  filename: string
}

export function analyze(filename: string, source: string, entrypoints: NativeEntrypoint[]): NativeAnalysis
export function analyzeMany(sources: NativeSource[], entrypoints: NativeEntrypoint[]): NativeFileAnalysis[]
