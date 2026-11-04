import type {
  FoldAnalysis,
  NativeAnalysis,
  NativeEntrypoint,
  NativeFileAnalysis,
  NativeFoldOptions,
  NativePathMapping,
  NativeProjectOptions,
  NativeSource,
  NativeTokenAccounting,
} from '@bamboocss/native-extractor'
import { BambooError } from '@bamboocss/shared'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type NativeExtractor = {
  analyze(filename: string, source: string, entrypoints: NativeEntrypoint[]): NativeAnalysis
  analyzeMany(
    sources: NativeSource[],
    entrypoints: NativeEntrypoint[],
    options?: NativeProjectOptions,
  ): NativeFileAnalysis[]
  accountTokens(
    filename: string,
    source: string,
    tokenModules: string[],
    pathMappings?: NativePathMapping[],
  ): NativeTokenAccounting
  compileModules(sources: NativeSource[], auxiliary: NativeSource[], options: NativeFoldOptions): FoldAnalysis[]
}

/**
 * The binaries the release workflow builds into `dist/native`, by platform and architecture and,
 * on Linux, the C library Node runs on. `__tests__/native-binaries.test.ts` holds the workflow to
 * building and shipping every one.
 */
export const NATIVE_BINARIES: Readonly<Record<string, string>> = {
  'darwin-arm64': 'darwin-arm64.node',
  'darwin-x64': 'darwin-x64.node',
  'linux-arm64-gnu': 'linux-arm64-gnu.node',
  'linux-arm64-musl': 'linux-arm64-musl.node',
  'linux-x64-gnu': 'linux-x64-gnu.node',
  'linux-x64-musl': 'linux-x64-musl.node',
  'win32-arm64': 'win32-arm64-msvc.node',
  'win32-x64': 'win32-x64-msvc.node',
}

let musl: boolean | undefined

/**
 * Whether Node runs on musl, as on Alpine. A gnu binary fails there on x64, naming glibc's dynamic
 * loader, and loads on arm64 only because musl's does not check the glibc versions it asks for.
 *
 * Alpine's `ldd` is musl's own loader and glibc's is a script naming glibc, so reading it answers
 * without starting anything. Without one, as in a distroless image, the report Node writes names
 * the glibc it runs on, and has none to name under musl.
 */
const isMusl = () => {
  if (musl !== undefined) return musl
  try {
    musl = readFileSync('/usr/bin/ldd', 'utf8').includes('musl')
  } catch {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    musl = report?.header !== undefined && !report.header.glibcVersionRuntime
  }
  return musl
}

/** This machine's binary in `dist/native`, or undefined where the release builds none. */
export const nativeBinaryName = () =>
  NATIVE_BINARIES[
    process.platform === 'linux'
      ? `linux-${process.arch}-${isMusl() ? 'musl' : 'gnu'}`
      : `${process.platform}-${process.arch}`
  ]

/** Load the required Rust extractor from the workspace or the published prebuild directory. */
export const loadNativeExtractor = (): NativeExtractor => {
  const nativeRequire = createRequire(import.meta.url)
  try {
    return nativeRequire('@bamboocss/native-extractor') as NativeExtractor
  } catch (workspaceError) {
    const binary = nativeBinaryName()
    if (!binary) {
      throw new BambooError(
        'NATIVE_EXTRACTION',
        `Native extraction is not available for ${process.platform}-${process.arch}.`,
        { cause: workspaceError },
      )
    }
    try {
      return nativeRequire(join(dirname(fileURLToPath(import.meta.url)), 'native', binary)) as NativeExtractor
    } catch (publishedError) {
      throw new BambooError('NATIVE_EXTRACTION', `Failed to load the native extractor binary ${binary}.`, {
        cause: publishedError,
      })
    }
  }
}
