import type { ParserOptions, StyleEncoder } from '@bamboocss/core'
import { isAbsolute, join } from 'node:path'
import { ParserResult } from './parser-result'

export interface SourceProjectOptions {
  /** Where source bytes come from when no overlay supplies them. */
  readFile: (filePath: string) => string
  fileExists: (filePath: string) => boolean
  /** What a relative path is relative to. */
  cwd?: string
  /** The tsconfig `compilerOptions` whose `baseUrl` and `paths` resolution reads. */
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }
  parserOptions: ParserOptions
}

/**
 * The source view every engine reads: disk, with caller-supplied bytes layered over it.
 *
 * Extraction and the Vite compiler run in Rust, and the Rust resolver reads ordinary files
 * itself. What it cannot see is bytes that exist nowhere on disk — a single-file component's
 * compiled script, a test's in-memory module — so those are held here, as overlays, and handed
 * across the native boundary with every analysis. Nothing here parses anything.
 */
export class SourceProject {
  /** Bytes explicitly supplied by a caller rather than read from disk, by normalized path. */
  private overlays = new Map<string, string>()
  /** Bumped whenever an overlay is set or removed, so a reader can tell its copy is current. */
  overlayRevision = 0
  private compilerOptions: { baseUrl?: string; paths?: Record<string, string[]> }

  constructor(private readonly options: SourceProjectOptions) {
    this.compilerOptions = { ...options.compilerOptions }
  }

  private normalizePath = (filePath: string) => filePath.replaceAll('\\', '/')

  /** The `baseUrl` and `paths` module resolution reads. */
  get resolutionOptions(): { baseUrl?: string; paths?: Record<string, string[]> } {
    return { baseUrl: this.compilerOptions.baseUrl, paths: this.compilerOptions.paths }
  }

  /** A tsconfig reload replaced the options resolution reads. */
  refreshResolutionConfiguration = (compilerOptions: { baseUrl?: string; paths?: Record<string, string[]> } = {}) => {
    this.compilerOptions = { ...compilerOptions }
  }

  /** Source bytes from an overlay, else from disk; `undefined` when neither can be read. */
  getSourceText = (filePath: string): string | undefined => {
    const overlay = this.overlays.get(this.normalizePath(filePath))
    if (overlay !== undefined) return overlay
    try {
      return this.options.readFile(filePath)
    } catch {
      return undefined
    }
  }

  /** Whether that same source view can read a path. */
  sourceExists = (filePath: string): boolean =>
    this.overlays.has(this.normalizePath(filePath)) || this.options.fileExists(filePath)

  /** Whether a caller supplied bytes that can differ from the path on disk. */
  sourceIsOverridden = (filePath: string): boolean => this.overlays.has(this.normalizePath(filePath))

  /** Every path a caller supplied bytes for. */
  getOverriddenSources = (): string[] => [...this.overlays.keys()]

  /** Supply the bytes for a path. */
  overlaySource = (filePath: string, content: string): void => {
    const key = this.normalizePath(filePath)
    if (this.overlays.get(key) === content) return
    this.overlays.set(key, content)
    this.overlayRevision++
  }

  /**
   * Supply the bytes for a module, under the path extraction will ask for.
   *
   * A relative path resolves against the project's working directory, as `parseFile` resolves
   * it — so a module added as `src/a.tsx` is the one `parseFile('src/a.tsx')` reads.
   */
  addSourceFile = (filePath: string, content: string): void => {
    this.overlaySource(this.absolute(filePath), content)
  }

  private absolute = (filePath: string) =>
    isAbsolute(filePath) ? filePath : join(this.options.cwd ?? process.cwd(), filePath)

  /** Forget bytes supplied through `overlaySource`. Returns whether there were any. */
  removeOverlay = (filePath: string): boolean => {
    const removed = this.overlays.delete(this.normalizePath(filePath))
    if (removed) this.overlayRevision++
    return removed
  }

  /**
   * A watched file changed on disk. Disk is now the truth for it, so an overlay that
   * stood in for it goes.
   */
  reloadSourceFile = (filePath: string): void => {
    this.removeOverlay(this.absolute(filePath))
  }

  /**
   * A watched file was deleted. Its styles go with it — nothing re-parses a file that is gone,
   * so they would otherwise outlive it for as long as the context does.
   */
  removeSourceFile = (filePath: string, encoder: StyleEncoder = this.options.parserOptions.encoder): void => {
    encoder.releaseFile(this.absolute(filePath))
    this.removeOverlay(this.absolute(filePath))
  }

  /**
   * Restore an encoder dump from a `.json` file in `include` — the output of `bamboo ship`,
   * or a library's shipped extraction — and report it as an empty result for that file.
   */
  parseJson = (filePath: string, encoder: StyleEncoder = this.options.parserOptions.encoder) => {
    const content = this.getSourceText(filePath)
    if (content === undefined) throw new Error(`bamboo: could not read ${filePath}`)
    encoder.fromJSON(JSON.parse(content))
    return new ParserResult(this.options.parserOptions, encoder).setFilePath(filePath)
  }
}
