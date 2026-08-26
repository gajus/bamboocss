import type { Node as CompilerNode, SourceFile as CompilerSourceFile } from '@typescript/api/unstable/ast'

/**
 * What a node is, from bamboo's side of the boundary.
 *
 * Aliased from the compiler rather than restated. Writing an interface of the members bamboo
 * happens to read looked tempting — it would document the surface, and it would not move when
 * an `unstable/*` dev build did — but the predicates in `unstable/ast/is` are typed against the
 * compiler's own `Node`, and that interface is not satisfied structurally. A parallel
 * declaration therefore fails to be assignable to it, and every `is.isX(node)` call stops
 * compiling. The dependency is real; naming it is better than shadowing it.
 *
 * What bamboo actually reads: `kind`, `pos`, `end`, `parent`, `text`, `getText()`, `getStart()`,
 * `getEnd()`, `getSourceFile()`, `forEachChild()`, and the named child accessors generated per
 * node kind — `expression`, `initializer`, `name`, `properties`, `arguments`, `statements`,
 * `moduleSpecifier`, `declarations`.
 */
export type Node = CompilerNode

export type SourceFile = CompilerSourceFile

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
  /**
   * Options that were ts-morph's and are the Go compiler's own business now.
   *
   * `skipAddingFilesFromTsConfig`, `skipLoadingLibFiles`, `compilerOptions` and friends
   * configured a program this process built. TypeScript 7 builds its program from the
   * `tsconfig.json` it is pointed at, so these are accepted and ignored rather than rejected —
   * the call sites that pass them are describing an intent the new backend already has, and
   * failing on them would be failing on agreement.
   */
  [ignored: string]: unknown
}
