import { readdirSync, statSync } from 'node:fs'
import { API } from '@typescript/api/unstable/sync'
import type { FileSystemDelegate, Node, ProjectOptions, SourceFile } from './types'

/** The real directory, or an empty listing when there is none — an absent directory is not an error. */
const readDirectory = (directoryName: string): { files: string[]; directories: string[] } => {
  try {
    const entries = readdirSync(directoryName, { withFileTypes: true })
    return {
      files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
      directories: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    }
  } catch {
    return { files: [], directories: [] }
  }
}

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
 * A snapshot is a point in time. Every lifecycle method below is therefore a snapshot update —
 * telling the Go process what moved, rather than reaching into a tree this process owns.
 */
export class Project {
  #api: API
  #snapshot: ReturnType<API['updateSnapshot']>
  #tsConfigFilePath: string

  /**
   * Content this project holds that is not on disk, or differs from what is.
   *
   * ts-morph could be handed a string because its filesystem lived in this process. The Go
   * compiler reads through the delegate below, so "add this source" becomes "remember this text
   * and tell TypeScript the file changed". It is also what makes the bundler path work: the
   * module Vite hands over has already had JSX lowered out of it, and a framework plugin may
   * have lifted it out of a `.vue` file, so the bytes on disk are not the bytes to parse.
   */
  #overlay = new Map<string, string>()

  constructor(options: ProjectOptions) {
    this.#tsConfigFilePath = options.tsConfigFilePath
    this.#api = new API({ cwd: options.cwd, fs: this.#delegate(options.fs) })
    this.#snapshot = this.#api.updateSnapshot({ openProjects: [this.#tsConfigFilePath] })
  }

  /** The file as the current snapshot sees it, or `undefined` when it is not in the program. */
  getSourceFile(filePath: string): SourceFile | undefined {
    return this.#project()?.program.getSourceFile(filePath) as SourceFile | undefined
  }

  /**
   * Install content for a path, whether or not anything is there.
   *
   * The persistent counterpart to `withText`: this one stays until removed, because its callers
   * are a bundler transform installing a module's real text and a test building a project out of
   * strings. Re-adding identical text is a no-op rather than a snapshot update — that is what
   * makes the transform path affordable, since it adds every module before parsing it and
   * almost every one of those is byte-identical to what the project already holds.
   */
  addSourceFile(filePath: string, content: string): SourceFile | undefined {
    if (this.#overlay.get(filePath) === content) return this.getSourceFile(filePath)

    const existed = this.#overlay.has(filePath) || this.#onDisk(filePath)
    this.#overlay.set(filePath, content)
    this.#apply(existed ? { changed: [filePath] } : { created: [filePath] })
    return this.getSourceFile(filePath)
  }

  /** A file appeared. Its content comes from the delegate or the disk, not from here. */
  createSourceFile(filePath: string): SourceFile | undefined {
    this.#apply({ created: [filePath] })
    return this.getSourceFile(filePath)
  }

  /** A file's bytes moved, so anything this project held for it is stale. */
  reloadSourceFile(filePath: string): SourceFile | undefined {
    this.#overlay.delete(filePath)
    this.#apply({ changed: [filePath] })
    return this.getSourceFile(filePath)
  }

  /** A file went away. Answers whether the project was holding it. */
  removeSourceFile(filePath: string): boolean {
    const held = this.#overlay.has(filePath) || this.getSourceFile(filePath) !== undefined
    this.#overlay.delete(filePath)
    this.#apply({ deleted: [filePath] })
    return held
  }

  /**
   * Re-read the given files, or the whole program when told nothing.
   *
   * The Go process holds its own view of the tree, so an edit bamboo already knows about is not
   * one TypeScript has seen. Naming the changed files rather than invalidating everything is
   * what keeps a watch rebuild from re-parsing a project to read one module.
   */
  refresh(changedFiles?: string[]): void {
    if (changedFiles?.length) {
      for (const file of changedFiles) this.#overlay.delete(file)
      this.#apply({ changed: changedFiles })
      return
    }
    this.#overlay.clear()
    this.#snapshot = this.#api.updateSnapshot({ fileChanges: { invalidateAll: true } })
  }

  /**
   * Read a file as if it held `text`, without writing it or advancing the snapshot.
   *
   * The scoped counterpart to `addSourceFile`, for a caller that wants one answer about text it
   * is not installing — the override is released when the callback returns, so nothing else in
   * the build observes it.
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

  /** Ends the compiler process. A project that is not closed keeps one alive. */
  dispose(): void {
    this.#api.close()
  }

  #apply(changes: { changed?: string[]; created?: string[]; deleted?: string[] }): void {
    this.#snapshot = this.#api.updateSnapshot({ fileChanges: changes })
  }

  #project() {
    return this.#snapshot.getProjects()[0]
  }

  #onDisk(filePath: string): boolean {
    try {
      return statSync(filePath).isFile()
    } catch {
      return false
    }
  }

  /**
   * The filesystem the Go process reads through: this project's overlay, then bamboo's runtime,
   * then the disk.
   *
   * The order is the point. An overlay entry is content a caller installed deliberately, and it
   * has to win over whatever is on disk under the same path — which is exactly the bundler case,
   * same filename, different bytes.
   */
  #delegate(fs: FileSystemDelegate | undefined): FileSystemDelegate {
    const overlay = this.#overlay
    return {
      ...fs,
      readFile(fileName) {
        const held = overlay.get(fileName)
        return held === undefined ? fs?.readFile?.(fileName) : held
      },
      fileExists(fileName) {
        return overlay.has(fileName) ? true : fs?.fileExists?.(fileName)
      },
      /**
       * Directory listings have to include overlay entries, or a synthesized file is readable
       * and still not in the program.
       *
       * The Go process builds its file set by enumerating what the project's `include` resolves
       * to, so a path that only answers `fileExists` is never asked for. That is the difference
       * between an override of a real module — which the enumeration already found — and an
       * auxiliary source with no file behind it, which is how a framework plugin hands over a
       * block it lifted out of a single-file component.
       */
      getAccessibleEntries(directoryName) {
        const delegated = fs?.getAccessibleEntries?.(directoryName)
        const added: string[] = []
        for (const held of overlay.keys()) {
          const at = held.lastIndexOf('/')
          if (at !== -1 && held.slice(0, at) === directoryName) added.push(held.slice(at + 1))
        }
        if (!added.length) return delegated

        const base = delegated ?? readDirectory(directoryName)
        return {
          files: [...new Set([...base.files, ...added])],
          directories: base.directories,
        }
      },
    }
  }
}

export type { Node, SourceFile }
