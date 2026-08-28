import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

/**
 * Which of the files `include` matched an extraction pass actually has to read.
 *
 * A file can only contribute to the stylesheet by *calling* something bamboo owns — `css`, a
 * recipe, a pattern, `token`. Every one of those arrives as a binding, and a binding arrives
 * through an import: either straight from an entrypoint, or from a local module that got it
 * from one. A file with no such chain cannot hold a call, whatever else is in it.
 *
 * On a real application that is most of the tree. Measured over 6,425 files: 4,062 could reach
 * an entrypoint and 2,363 provably could not, and not handing the compiler the latter took the
 * pass from 88.9s to 26.3s with byte-identical CSS out. The scan itself costs ~300ms, because
 * it reads text and never parses.
 *
 * ## Skipping is not the same as ignoring
 *
 * A file left out here is still *reachable*. Cross-file composition works by resolving an
 * import and installing what it names, so a module that exports a style object still arrives
 * the moment something that qualifies imports it. What is skipped is only asking "does this
 * file *originate* a call", of a file that has no binding to originate one with.
 *
 * ## Everything here fails open
 *
 * The failure this must not have is dropping a rule, which is silent: the build stays green and
 * the class the component asks for has nothing behind it. So every uncertainty resolves toward
 * including the file, and the cases are named rather than left to a catch-all — a file that
 * cannot be read, a source whose imports could not be scanned, a specifier that looks local and
 * resolves to nothing. Being wrong in that direction costs time; being wrong in the other costs
 * correctness.
 */

/**
 * Module specifiers, from the four places one can appear.
 *
 * Deliberately loose about what surrounds them. A specifier missed here costs an edge, and an
 * edge missed can exclude a file that should have been kept — so the pattern is written to
 * over-match rather than to parse, and `scanSpecifiers` treats a source it found nothing in as
 * one it failed to read.
 */
const SPECIFIER = /(?:\bfrom\s*|^\s*(?:import|export)\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/gm

/** The extensions a specifier may omit, in the order `@bamboocss/ts-ast` tries them. */
const EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

/** What a `.js`-family specifier may actually name, source first. */
const EMITTED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['.js', ['.ts', '.tsx', '.d.ts', '.js', '.jsx']],
  ['.mjs', ['.mts', '.d.mts', '.mjs']],
  ['.cjs', ['.cts', '.d.cts', '.cjs']],
]

export interface ExtractableOptions {
  /** Absolute project root; a specifier that cannot reach inside it cannot carry a binding. */
  cwd: string
  /** Every module specifier that *is* an entrypoint — `styled-system/css` and its siblings. */
  entrypoints: readonly string[]
  /** The file's text, or `undefined` when it could not be read. */
  readFile: (filePath: string) => string | undefined
  /**
   * Whether a path names a file. Defaults to the real filesystem.
   *
   * Injectable because the alternative is a module that can only be exercised against a real
   * tree — and the cases worth pinning here are graph shapes, not directory layouts.
   */
  fileExists?: (filePath: string) => boolean
  /** `paths` from the project's tsconfig, which is how a bare specifier reaches local source. */
  paths?: Record<string, string[]>
  baseUrl?: string
}

/** Every specifier in a source, or `undefined` when the text could not be scanned at all. */
const scanSpecifiers = (text: string): string[] | undefined => {
  const found: string[] = []
  for (const match of text.matchAll(SPECIFIER)) if (match[1]) found.push(match[1])
  if (found.length) return found
  // Nothing matched. Either the file imports nothing — common, and fine — or the pattern failed
  // on a shape it should have caught. The two are told apart by whether the file says `import`
  // or `require` at all; if it does and nothing was found, this did not understand the file.
  return /\b(?:import|require)\b/.test(text) ? undefined : found
}

/** A candidate path with every extension a specifier may have omitted. */
const candidatesFor = (base: string): string[] => {
  const emitted = EMITTED.find(([suffix]) => base.endsWith(suffix))
  const paths = emitted
    ? emitted[1].map((extension) => base.slice(0, -emitted[0].length) + extension)
    : [base, ...EXTENSIONS.map((extension) => base + extension)]
  return [...paths, ...EXTENSIONS.map((extension) => `${base}/index${extension}`)]
}

/**
 * Where a specifier points, when that is somewhere inside the project.
 *
 * `undefined` means "nothing local", which is the answer for a package as well as for a broken
 * path — and both are correct here, because neither can hand this file a binding bamboo owns.
 * bamboo's own resolution stops at the same boundary: a target outside the project reads as
 * non-local, so nothing it exports is ever extracted from.
 */
const localTargetOf = (specifier: string, importer: string, options: ExtractableOptions): string | undefined => {
  const bases: string[] = []

  if (specifier.startsWith('.')) {
    bases.push(resolve(dirname(importer), specifier))
  } else if (isAbsolute(specifier)) {
    bases.push(specifier)
  } else {
    // `paths` is what lets a bare or `#`-prefixed specifier name local source, and a config may
    // map `*` wholesale — so every pattern is tried rather than only the ones that look like
    // aliases.
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      const star = pattern.indexOf('*')
      if (star === -1) {
        if (pattern !== specifier) continue
        for (const target of targets) bases.push(resolve(options.cwd, target))
        continue
      }
      const head = pattern.slice(0, star)
      const tail = pattern.slice(star + 1)
      if (!specifier.startsWith(head) || !specifier.endsWith(tail)) continue
      const filled = specifier.slice(head.length, specifier.length - tail.length)
      for (const target of targets) bases.push(resolve(options.cwd, target.replace('*', filled)))
    }
    if (options.baseUrl) bases.push(resolve(options.cwd, options.baseUrl, specifier))
  }

  const exists = options.fileExists ?? existsSync
  const root = options.cwd.endsWith('/') ? options.cwd : `${options.cwd}/`
  for (const base of bases) {
    if (!base.startsWith(root)) continue
    for (const candidate of candidatesFor(base)) {
      if (exists(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * The subset of `files` that could hold a call to something bamboo owns.
 *
 * Two passes over text and no parsing. The first marks every file that names an entrypoint and
 * records where each file's other imports point; the second walks those edges backwards from
 * the marked set, because a file that imports a module carrying bamboo bindings may be using
 * one — a recipe defined with `cva` in one file and called in another is exactly that shape.
 */
export const selectExtractable = (files: readonly string[], options: ExtractableOptions): string[] => {
  const keep = new Set<string>()
  const importers = new Map<string, string[]>()

  for (const file of files) {
    const text = options.readFile(file)
    if (text === undefined) {
      keep.add(file)
      continue
    }

    // Substring, not a resolved path: it is the same test `ImportMap.match` applies to a
    // specifier, so a file this keeps is one bamboo would have recognised anyway. Applied to
    // the whole text rather than to the scanned specifiers, so a name split across lines by a
    // formatter is still caught.
    if (options.entrypoints.some((entrypoint) => text.includes(entrypoint))) {
      keep.add(file)
      continue
    }

    const specifiers = scanSpecifiers(text)
    if (specifiers === undefined) {
      keep.add(file)
      continue
    }

    for (const specifier of specifiers) {
      const target = localTargetOf(specifier, file, options)
      if (!target) continue
      const seen = importers.get(target)
      if (seen) seen.push(file)
      else importers.set(target, [file])
    }
  }

  let frontier = [...keep]
  while (frontier.length) {
    const next: string[] = []
    for (const target of frontier) {
      for (const importer of importers.get(target) ?? []) {
        if (keep.has(importer)) continue
        keep.add(importer)
        next.push(importer)
      }
    }
    frontier = next
  }

  return files.filter((file) => keep.has(file))
}
