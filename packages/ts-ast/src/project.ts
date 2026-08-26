import { API } from '@typescript/api/unstable/sync'
import type { Node, ProjectOptions, SourceFile } from './types'

/**
 * A program, over TypeScript 7's Go compiler.
 *
 * The shape ts-morph's `Project` had, minus everything bamboo never called. The differences
 * that matter are two, and both come from the compiler living in another process:
 *
 * There is no standalone parse. TypeScript 6 offered `ts.createSourceFile(text)` and ts-morph
 * offered an in-memory filesystem; TypeScript 7 offers neither, because the tree is produced by
 * the Go process and handed back as views over a buffer. Everything therefore goes through a
 * project rooted at a `tsconfig.json`, and a file's *content* is supplied by delegating the
 * filesystem — which bamboo already does, since its runtime has always read through
 * `runtime.fs` rather than `node:fs`.
 *
 * A snapshot is a point in time. Reading a file that an edit has changed means taking a new
 * snapshot, and reading text that is not on disk at all — a module Vite has transformed, a
 * `<script>` block lifted from a `.vue` file — means `withText`, which layers one file's
 * content over a snapshot for the duration of a callback and then drops it.
 */
export class Project {
  #api: API
  #snapshot: ReturnType<API['updateSnapshot']>
  #tsConfigFilePath: string

  constructor(options: ProjectOptions) {
    this.#tsConfigFilePath = options.tsConfigFilePath
    this.#api = new API({ cwd: options.cwd, fs: options.fs })
    this.#snapshot = this.#api.updateSnapshot({ openProjects: [this.#tsConfigFilePath] })
  }

  /** The file as the current snapshot sees it, or `undefined` when it is not in the program. */
  getSourceFile(filePath: string): SourceFile | undefined {
    return this.#project()?.program.getSourceFile(filePath) as SourceFile | undefined
  }

  /**
   * Re-read the given files, or the whole program when told nothing.
   *
   * The Go process holds its own view of the tree, so an edit bamboo already knows about is not
   * one TypeScript has seen. Naming the changed files rather than invalidating everything is
   * what keeps a watch rebuild from re-parsing a project to read one module.
   */
  refresh(changedFiles?: string[]): void {
    this.#snapshot = this.#api.updateSnapshot(
      changedFiles?.length ? { fileChanges: { changed: changedFiles } } : { fileChanges: { invalidateAll: true } },
    )
  }

  /**
   * Read a file as if it held `text`, without writing it or advancing the snapshot.
   *
   * This is the bundler path. A Vite `transform` hook is handed a module's *current* text, which
   * is not what is on disk once JSX has been lowered or a framework plugin has lifted a block
   * out of a single-file component. The override lives for the callback and is released after
   * it, so nothing else in the build observes it.
   */
  withText<T>(filePath: string, text: string, read: (sourceFile: SourceFile | undefined) => T): T {
    let result!: T
    // `DocumentIdentifier` is the path itself, not a wrapper around one.
    this.#api.runWithTemporaryFileUpdate(this.#snapshot, filePath, text, (snapshot) => {
      const project = snapshot.getProjects()[0]
      result = read(project?.program.getSourceFile(filePath) as SourceFile | undefined)
    })
    return result
  }

  /** Every file in the program, which is what the project's `include` resolved to. */
  getSourceFiles(): SourceFile[] {
    return (this.#project()?.program.getSourceFiles() ?? []) as SourceFile[]
  }

  /** Ends the compiler process. A project that is not closed keeps one alive. */
  dispose(): void {
    this.#api.close()
  }

  #project() {
    return this.#snapshot.getProjects()[0]
  }
}

export type { Node, SourceFile }
