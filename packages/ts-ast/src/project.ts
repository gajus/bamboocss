import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
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

  #cwd: string
  #fs: FileSystemDelegate | undefined

  /** Paths this project has asked the compiler to hold open, so each is opened once. */
  #opened = new Set<string>()

  constructor(options: ProjectOptions) {
    this.#tsConfigFilePath = options.tsConfigFilePath
    this.#cwd = options.cwd
    this.#fs = options.fs
    this.#api = new API({ cwd: options.cwd, fs: this.#delegate(options.fs) })
    this.#snapshot = this.#api.updateSnapshot({ openProjects: [this.#tsConfigFilePath] })
  }

  /** The file as the current snapshot sees it, or `undefined` when no project holds it. */
  getSourceFile(filePath: string): SourceFile | undefined {
    return this.#find(this.#snapshot, this.#abs(filePath))
  }

  /**
   * The first project in a snapshot holding this file.
   *
   * Not `getProjects()[0]`. A file opened from outside the tsconfig's `include` is loaded into
   * an *inferred* project, which is a separate entry — so asking only the configured project
   * answers `undefined` for exactly the files that needed opening in the first place.
   */
  #find(snapshot: ReturnType<API['updateSnapshot']>, path: string): SourceFile | undefined {
    for (const project of snapshot.getProjects()) {
      const found = project.program.getSourceFile(path)
      if (found) return found as SourceFile
    }
    return undefined
  }

  /**
   * The path the compiler knows a file by.
   *
   * The Go process addresses files absolutely, while callers pass whatever spelling they hold —
   * a relative path from a config's `include`, an absolute one from a resolver. Normalising at
   * the boundary is what keeps the overlay's keys and the program's keys the same strings;
   * without it an installed source is readable under one spelling and absent under the other.
   */
  #abs(filePath: string): string {
    return isAbsolute(filePath) ? filePath : resolve(this.#cwd, filePath)
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
    const path = this.#abs(filePath)
    if (this.#overlay.get(path) === content) return this.getSourceFile(path)

    const existed = this.#overlay.has(path) || this.#onDisk(path)
    this.#overlay.set(path, content)
    this.#apply(existed ? { changed: [path] } : { created: [path] })
    return this.getSourceFile(path)
  }

  /**
   * A file appeared, optionally with content this process is supplying.
   *
   * Keeps ts-morph's `(path, content?, options?)` shape. The options it took — `overwrite`,
   * `scriptKind` — described a program built here; the Go compiler decides both from the path
   * and from what the snapshot already holds, so they are accepted and ignored.
   */
  createSourceFile(filePath: string, content?: string, _options?: unknown): SourceFile | undefined {
    if (content !== undefined) return this.addSourceFile(filePath, content)
    this.#apply({ created: [this.#abs(filePath)] })
    return this.getSourceFile(filePath)
  }

  /** A file's bytes moved, so anything this project held for it is stale. */
  reloadSourceFile(filePath: string): SourceFile | undefined {
    const path = this.#abs(filePath)
    this.#overlay.delete(path)
    this.#apply({ changed: [path] })
    return this.getSourceFile(path)
  }

  /** A file went away. Answers whether the project was holding it. */
  removeSourceFile(filePath: string): boolean {
    const path = this.#abs(filePath)
    const held = this.#overlay.has(path) || this.getSourceFile(path) !== undefined
    this.#overlay.delete(path)
    this.#apply({ deleted: [path] })
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
    this.#opened.clear()
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
    const path = this.#abs(filePath)
    this.#api.runWithTemporaryFileUpdate(this.#snapshot, path, text, (snapshot) => {
      result = read(this.#find(snapshot, path))
    })
    return result
  }

  /** The project's resolved `compilerOptions`, as the Go compiler parsed them. */
  getCompilerOptions() {
    return this.#project()?.program.getCompilerOptions()
  }

  /** The directory the project is rooted at. */
  getCurrentDirectory(): string {
    return this.#cwd
  }

  /**
   * A file's bytes, through the same order the compiler reads them: overlay, delegate, disk.
   *
   * Callers that want the text bamboo is *acting on* have to ask through here rather than the
   * disk, or they read past an installed override and see a module as written instead of as
   * transformed.
   */
  readFile(filePath: string): string | undefined {
    const held = this.#overlay.get(this.#abs(filePath))
    if (held !== undefined) return held

    // Contained for the same reason the compiler's delegate is: bamboo's runtime `fs` throws
    // for a missing path, and every caller here is asking whether there is anything to read.
    try {
      const delegated = this.#fs?.readFile?.(filePath)
      if (delegated !== undefined) return delegated ?? undefined
    } catch {
      return undefined
    }

    try {
      return readFileSync(filePath, 'utf8')
    } catch {
      return undefined
    }
  }

  /** The real path behind a symlink, or the path itself when it does not resolve. */
  realpath(filePath: string): string {
    const delegated = this.#fs?.realpath?.(filePath)
    if (delegated !== undefined) return delegated

    try {
      return realpathSync(filePath)
    } catch {
      return filePath
    }
  }

  /**
   * The filesystem, in the shape ts-morph's `getFileSystem()` returned.
   *
   * A compatibility surface rather than an object this owns: every answer routes through the
   * same overlay-then-delegate-then-disk order the compiler reads by, so a caller asking the
   * "filesystem" for a file it has installed gets what it installed.
   */
  getFileSystem() {
    return {
      getCurrentDirectory: () => this.#cwd,
      readFileSync: (filePath: string) => this.readFile(filePath) ?? '',
      realpathSync: (filePath: string) => this.realpath(filePath),
      fileExists: (filePath: string) => this.readFile(filePath) !== undefined,
    }
  }

  /** The resolved compiler options, under the property spelling ts-morph exposed. */
  get compilerOptions() {
    return this.getCompilerOptions()
  }

  /** Ends the compiler process. A project that is not closed keeps one alive. */
  dispose(): void {
    this.#api.close()
  }

  /**
   * Tell the Go process what moved, and open anything it has not been asked to hold before.
   *
   * A tsconfig defines a program, so a file outside its `include` is not in one however
   * plainly it exists — and bamboo installs such files routinely: a bundler hands over a
   * module from anywhere in the graph, and a test builds a project out of string paths that
   * were never on disk. ts-morph had no such notion, since its project was a bag of files.
   *
   * `openFiles` is that bag, and is what an editor uses for the same reason: it loads a file
   * into the containing project when there is one and an inferred project otherwise. Opens are
   * ref-counted and persist, so each path is sent once.
   */
  #apply(changes: { changed?: string[]; created?: string[]; deleted?: string[] }): void {
    const opening: string[] = []
    for (const path of [...(changes.created ?? []), ...(changes.changed ?? [])]) {
      if (this.#opened.has(path)) continue
      this.#opened.add(path)
      opening.push(path)
    }
    for (const path of changes.deleted ?? []) this.#opened.delete(path)

    this.#snapshot = this.#api.updateSnapshot({
      fileChanges: changes,
      ...(opening.length ? { openFiles: opening } : {}),
      ...(changes.deleted?.length ? { closeFiles: changes.deleted } : {}),
    })
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
  /**
   * The filesystem the Go process reads through.
   *
   * Every method here has to be *total*. An exception thrown in a callback does not propagate
   * to the caller that provoked it — it crosses a process boundary and comes back as
   * ``Error calling callback `readFile` `` attached to whatever request happened to be in
   * flight, which fails the whole snapshot rather than the one lookup.
   *
   * That matters because the compiler probes speculatively: module resolution asks about paths
   * that do not exist and about directories as though they were files, and expects "no" for an
   * answer. bamboo's own runtime `fs` throws for both, being written for callers that only ask
   * about files they believe in. So each delegated call is contained, and a failure to answer
   * is reported as absence — which is what it means.
   */
  #delegate(fs: FileSystemDelegate | undefined): FileSystemDelegate {
    const overlay = this.#overlay
    /** `undefined` rather than a thrown ENOENT/EISDIR — see above. */
    const attempt = <T>(read: () => T): T | undefined => {
      try {
        return read()
      } catch {
        return undefined
      }
    }
    return {
      ...fs,
      readFile(fileName) {
        const held = overlay.get(fileName)
        return held === undefined ? attempt(() => fs?.readFile?.(fileName)) : held
      },
      fileExists(fileName) {
        return overlay.has(fileName) ? true : (attempt(() => fs?.fileExists?.(fileName)) ?? false)
      },
      /**
       * What the compiler is allowed to see in a directory, overlay included.
       *
       * Both halves are load-bearing. A synthesized file has to appear among `files` or it is
       * readable by path yet absent from the program — the compiler walks the tree to decide
       * membership rather than asking about paths it has not been shown.
       *
       * And the *directories* leading to it have to appear too. Overlay content is routinely
       * installed under paths with nothing behind them — a test that builds a project out of
       * strings writes `src/a.tsx` into a directory that was never created. Reporting the file
       * without its parent leaves the compiler with no reason to descend, so it never asks
       * about the directory that would have contained it, and the file is silently not in the
       * program. That reads downstream as a parse that found no styles, not as a missing file.
       */
      getAccessibleEntries(directoryName) {
        const delegated = attempt(() => fs?.getAccessibleEntries?.(directoryName))
        const prefix = directoryName.endsWith('/') ? directoryName : `${directoryName}/`
        const addedFiles: string[] = []
        const addedDirectories: string[] = []
        for (const held of overlay.keys()) {
          if (!held.startsWith(prefix)) continue
          const rest = held.slice(prefix.length)
          const at = rest.indexOf('/')
          if (at === -1) addedFiles.push(rest)
          else addedDirectories.push(rest.slice(0, at))
        }
        if (!addedFiles.length && !addedDirectories.length) return delegated

        const base = delegated ?? readDirectory(directoryName)
        return {
          files: [...new Set([...base.files, ...addedFiles])],
          directories: [...new Set([...base.directories, ...addedDirectories])],
        }
      },
    }
  }
}

export type { Node, SourceFile }
