/**
 * What a node is, from bamboo's side of the boundary.
 *
 * TypeScript 7 returns lazy views over a binary buffer the Go compiler owns. Their shape is
 * described by `@typescript/api/unstable/ast`, but that surface is `unstable/*` by name and
 * moves between dev builds, so the extractor is typed against what it actually reads instead of
 * against whatever the current build happens to export. Anything absent here is a thing bamboo
 * does not use, not a thing TypeScript does not have.
 *
 * The index signature is load-bearing: named child accessors — `expression`, `properties`,
 * `arguments`, `declarations` and around a hundred more — are generated per node kind, and
 * enumerating them here would be transcribing a table that already exists.
 */
export interface Node {
  readonly kind: number
  readonly pos: number
  readonly end: number
  readonly parent?: Node
  readonly text?: string
  readonly statements?: Node[]
  readonly moduleSpecifier?: Node
  getText(): string
  getFullText(): string
  getStart(): number
  getEnd(): number
  getSourceFile(): SourceFile
  forEachChild(visit: (child: Node) => void): void
  [member: string]: unknown
}

export interface SourceFile extends Node {
  /** The file's whole text. Slicing it by a node's `pos`/`end` is how a range is read. */
  readonly text: string
  readonly fileName: string
}

/**
 * The filesystem TypeScript 7 reads through.
 *
 * The Go process would otherwise read the real disk, which is wrong for every source bamboo
 * hands it that is not a file on disk as written: a module Vite has already transformed, a
 * `<script>` block lifted out of a `.vue` or `.svelte` file, a virtual module. `readFile`
 * returning `null` means "no such file" and `undefined` means "fall through to the real disk",
 * which is the distinction that lets a project mix synthesized and on-disk sources.
 */
export interface FileSystemDelegate {
  readFile?: (fileName: string) => string | null | undefined
  fileExists?: (fileName: string) => boolean | undefined
  directoryExists?: (directoryName: string) => boolean | undefined
  getAccessibleEntries?: (directoryName: string) => { files: string[]; directories: string[] } | undefined
  realpath?: (path: string) => string | undefined
}

export interface ProjectOptions {
  /** Directory the project is rooted at. */
  cwd: string
  /** The `tsconfig.json` whose `include` decides the program's files. */
  tsConfigFilePath: string
  /** Reads delegated to bamboo's runtime rather than to the disk. */
  fs?: FileSystemDelegate
}
