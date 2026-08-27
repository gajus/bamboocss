import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { API } from '@typescript/api/unstable/sync'
import { compilerPathOf } from './node'
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
 * Compiler processes still open, and the reclaim that closes them.
 *
 * Every `Project` owns a Go process — `new API()` spawns one, there is no pool — and a process
 * that is never closed lives as long as this one does. bamboo builds projects freely: a
 * config reload replaces one, a rebuild materializes a candidate, and a test suite makes
 * hundreds. Nothing had been closing them, so a run held every compiler it had ever started.
 *
 * `dispose()` is the answer wherever a caller knows the project is finished. This is the
 * answer everywhere else: once nothing can reach the `Project`, nothing can reach its trees
 * either, and the process behind it is pure cost. Registration is keyed on the project so
 * `dispose()` can unregister and the close happens exactly once.
 *
 * The exit hook is the last resort, for a process that ends while projects are still live.
 */
const liveApis = new Set<{ close(): void }>()

const closeQuietly = (api: { close(): void }): void => {
  liveApis.delete(api)
  try {
    api.close()
  } catch {
    // A compiler that has already gone is the outcome this wanted.
  }
}

const reclaim = new FinalizationRegistry<{ close(): void }>(closeQuietly)

let exitHookInstalled = false
const installExitHook = () => {
  if (exitHookInstalled || typeof process?.once !== 'function') return
  exitHookInstalled = true
  process.once('exit', () => {
    for (const api of [...liveApis]) closeQuietly(api)
  })
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

  /**
   * Content this project's *filesystem* holds that the real one does not.
   *
   * ts-morph's in-memory filesystem, which several callers use as a disk with nothing behind
   * it: a module written here exists, resolves and can be read, and is not part of the project
   * until something loads it. Kept apart from the overlay because the two answer different
   * questions — the overlay is the text bamboo is *acting on*, and `reloadSourceFile` drops it
   * precisely so the file reads from here again.
   */
  #disk = new Map<string, string>()

  #cwd: string
  #fs: FileSystemDelegate | undefined

  /** Where the synthesized config lives on the virtual disk — see `#writeConfig`. */
  #configPath: string

  /** Paths this project has asked the compiler to hold open, so each is opened once. */
  #opened = new Set<string>()

  /** Options supplied by the caller, which outrank the compiler's own reading — see below. */
  #compilerOptions: Record<string, unknown> | undefined

  /** Changes announced but not yet sent, and whether they move the project's membership. */
  #pending: { changed: Set<string>; created: Set<string>; deleted: Set<string> } | undefined
  #membershipMoved = false

  constructor(options: ProjectOptions) {
    // Absolute, always. A caller may hold a relative working directory — the fixtures use `''`
    // — and the compiler rejects a relative path outright: `vfs: path … is not absolute` is a
    // panic, not a resolution failure. Resolving here also leaves `#abs` answering exactly as
    // it did, since `resolve('', x)` and `resolve(process.cwd(), x)` are the same path.
    this.#cwd = resolve(options.cwd ?? process.cwd())
    this.#fs = options.fs
    this.#compilerOptions = (options as { compilerOptions?: Record<string, unknown> }).compilerOptions
    this.#configPath = resolve(this.#cwd, 'tsconfig.bamboo-compiler.json')

    this.#api = new API({ cwd: this.#cwd, fs: this.#delegate(options.fs) })
    liveApis.add(this.#api)
    reclaim.register(this, this.#api, this)
    installExitHook()
    this.#writeConfig()
    this.#snapshot = this.#api.updateSnapshot({ openProjects: [this.#configPath] })
  }

  /**
   * The config the compiler is opened on: bamboo's, not the user's.
   *
   * The user's `tsconfig.json` describes a program to *typecheck* — every file its `include`
   * reaches, every `@types` package, the standard library, and the transitive closure of every
   * import. bamboo needs none of that. It never asks a type question (`no-language-service`
   * pins that), and it resolves modules itself, so the only thing the compiler is here to do is
   * parse the exact files bamboo hands it.
   *
   * Opening the user's config instead costs about **2 GB per project** on this repository, and
   * one is paid per `Project` — which is what turned a test run into tens of gigabytes. The
   * three options below are what remove it:
   *
   * - `files` names the installed set explicitly, so nothing is discovered by globbing.
   * - `noResolve` stops the compiler following imports out of that set; bamboo already knows
   *   every file it wants, because it resolved them.
   * - `noLib` and `types: []` drop the standard library and the ambient type packages, which
   *   only a checker would read.
   *
   * Measured on one file inside this checkout: 2023 MB opening the repository's config against
   * **19 MB** here, with the same tree parsed either way.
   *
   * It is written to the virtual disk rather than to the user's, so nothing appears in their
   * checkout and no watcher sees it.
   */
  #writeConfig(): void {
    this.#disk.set(
      this.#configPath,
      JSON.stringify({
        compilerOptions: {
          allowJs: true,
          jsx: 'preserve',
          module: 'esnext',
          moduleResolution: 'bundler',
          noEmit: true,
          noLib: true,
          noResolve: true,
          target: 'esnext',
          types: [],
        },
        files: [...this.#opened],
      }),
    )
  }

  /** The file as the current snapshot sees it, or `undefined` when no project holds it. */
  getSourceFile(filePath: string): SourceFile | undefined {
    this.#flush()
    return this.#find(this.#snapshot, this.#abs(filePath))
  }

  /**
   * Whether this project was *given* the file, as opposed to the compiler having found it.
   *
   * A TypeScript 7 program contains everything its config matches plus the transitive closure
   * of every import, so `getSourceFile` answers for files nobody installed. ts-morph's project
   * was exactly the set put into it — constructed with `skipAddingFilesFromTsConfig` and
   * `skipFileDependencyResolution` — and bamboo's laziness is built on that distinction: a
   * source outside the declared inventory has to read as absent until something resolves to it,
   * or nothing is ever recorded as having been demanded.
   */
  has(filePath: string): boolean {
    return this.#opened.has(this.#abs(filePath))
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
   *
   * It is also where an extension the compiler will not parse is aliased to one it will, so a
   * `.vue` or `.svelte` module — whose text a `parser:before` hook has already turned into TSX —
   * is admitted to the program at all. `pathOf` is the inverse, for anything recording a path.
   */
  #abs(filePath: string): string {
    return compilerPathOf(isAbsolute(filePath) ? filePath : resolve(this.#cwd, filePath))
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
    // Identical text is a no-op only if the project already *holds* the file. Content written
    // through the filesystem shim sits in the overlay unopened, waiting to be demanded, and
    // returning early on it would leave it there for good.
    if (this.#overlay.get(path) === content && this.#opened.has(path)) return this.getSourceFile(path)

    const existed = this.#overlay.has(path) || this.#onDisk(path)
    this.#overlay.set(path, content)
    this.#apply(existed ? { changed: [path] } : { created: [path] })
    return this.getSourceFile(path)
  }

  /**
   * Install many sources, and tell the compiler once.
   *
   * The bulk counterpart to `addSourceFile`, and the shape a cold pass actually has: the parser
   * hands over its whole inventory before reading any of it. Doing that one file at a time is
   * what `#flush` describes — a round trip each, carrying a `files` list one entry longer than
   * the last — and it measured **65x slower than ts-morph** on 2,000 files. Batched, the same
   * work is a single update.
   *
   * Returns nothing on purpose. Handing back the installed trees would mean reading the
   * snapshot, and reading is exactly what defers no longer.
   */
  addSourceFiles(entries: Iterable<readonly [string, string]>): void {
    const created: string[] = []
    const changed: string[] = []

    for (const [filePath, content] of entries) {
      const path = this.#abs(filePath)
      if (this.#overlay.get(path) === content && this.#opened.has(path)) continue
      const existed = this.#opened.has(path) || this.#overlay.has(path) || this.#onDisk(path)
      this.#overlay.set(path, content)
      ;(existed ? changed : created).push(path)
    }

    if (created.length || changed.length) this.#apply({ created, changed })
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
    // The overlay goes; the *membership* does not. Invalidating everything means "re-read what
    // you hold", not "you hold nothing" — dropping the opened set would make every file this
    // project was given read as absent until something added it back.
    this.#overlay.clear()
    // Everything queued is about to be re-read anyway.
    this.#pending = undefined
    this.#snapshot = this.#api.updateSnapshot({ fileChanges: { invalidateAll: true } })
  }

  /**
   * How many syntax errors the parse of this file produced.
   *
   * ts-morph exposed TypeScript's internal `parseDiagnostics` array directly on the source
   * file. TypeScript 7's nodes are views over a buffer the Go process owns and carry no such
   * property, so reading it answers `undefined` — which coerces to "no errors" and quietly
   * retires whatever safety net was built on it.
   *
   * `getSyntacticDiagnostics` is the question actually being asked, and scoped to one file it
   * stays a syntax check: no checker is instantiated, so this does not drag in the cost that
   * `getPreEmitDiagnostics` would.
   */
  getSyntacticDiagnosticCount(filePath: string): number {
    this.#flush()
    const path = this.#abs(filePath)
    for (const project of this.#snapshot.getProjects()) {
      if (!project.program.getSourceFile(path)) continue
      return project.program.getSyntacticDiagnostics(path).length
    }
    return 0
  }

  /**
   * The sources this project was given, in the order they were installed.
   *
   * Deliberately not the program's file list. ts-morph's project *was* the set of files put
   * into it — constructed with `skipLoadingLibFiles` and asked not to follow dependencies — so
   * this answered "what does bamboo hold". A TypeScript 7 program is a different quantity: it
   * carries `lib.*.d.ts`, every `@types` package it resolves, and the transitive closure of
   * every import, which on a project rooted in this repository is some 1,700 files and not one
   * of them a source bamboo asked about.
   */
  getSourceFiles(): SourceFile[] {
    this.#flush()
    const found: SourceFile[] = []
    for (const path of this.#opened) {
      const source = this.#find(this.#snapshot, path)
      if (source) found.push(source)
    }
    return found
  }

  /**
   * The project's `compilerOptions` — what it was configured with, over what the compiler
   * resolved.
   *
   * ts-morph was *constructed* from these options, so asking a project for them returned the
   * caller's own values. TypeScript 7 takes its options from a `tsconfig.json` and reports what
   * it parsed, which means options supplied directly — as bamboo does, having resolved the
   * tsconfig itself, and as a caller with no config file on disk must — would otherwise be
   * invisible here. The compiler's answer still fills in everything not spoken for.
   */
  getCompilerOptions() {
    this.#flush()
    const reported = this.#project()?.program.getCompilerOptions()
    if (!this.#compilerOptions) return reported
    return { ...reported, ...this.#compilerOptions }
  }

  /**
   * Replace the options this project was configured with.
   *
   * A config reload does not build a new compiler process — the program is incremental and the
   * whole point of the reload path is to keep it — but it does change what bamboo believes
   * about `paths` and `baseUrl`. Without this the project keeps reporting the aliases it was
   * constructed with, so a retargeted alias resolves to what it used to name and a deleted
   * tsconfig resolves at all.
   */
  setCompilerOptions(compilerOptions: Record<string, unknown> | undefined): void {
    this.#compilerOptions = compilerOptions
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
    return this.#fileSystem.readFileSync(filePath) || this.#readFile(filePath)
  }

  #readFile(filePath: string): string | undefined {
    const path = this.#abs(filePath)
    const held = this.#overlay.get(path) ?? this.#disk.get(path)
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

  /**
   * Whether this project can read a file at that path.
   *
   * Same order as `readFile` and for the same reason: a module installed as text has no file
   * behind it, so anything that decides existence from the disk alone reports it missing. That
   * is what a resolver asks, and answering "no" there makes an import of a synthesized module
   * unresolvable — the styles it names are then silently absent rather than reported.
   *
   * Separate from `readFile` so the answer costs a lookup rather than a file's contents;
   * resolution asks this of many candidates and reads none of them.
   */
  fileExists(filePath: string): boolean {
    const path = this.#abs(filePath)
    if (this.#overlay.has(path) || this.#disk.has(path)) return true

    try {
      const answered = this.#fs?.fileExists?.(filePath)
      if (answered !== undefined) return answered
    } catch {
      return false
    }

    return this.#onDisk(filePath)
  }

  /** The real path behind a symlink, or the path itself when it does not resolve. */
  realpath(filePath: string): string {
    return this.#fileSystem.realpathSync(filePath)
  }

  #realpath(filePath: string): string {
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
   * One object, created once and returned by every call. That is not tidiness: ts-morph's
   * filesystem was owned by the project, so a caller could replace a method on it — the watch
   * and resolution tests spy on `realpathSync` to simulate a candidate that cannot be
   * canonicalised — and handing back a fresh object each time would make such a spy take effect
   * on nothing.
   *
   * `writeFileSync` is the other half. It puts content where the *resolver* will find it
   * without making the file a member of the project, which is what an in-memory filesystem gave
   * ts-morph for free: a module that exists on disk, outside the declared inventory, waiting to
   * be demanded. `has()` stays false for it until something actually loads it.
   */
  getFileSystem() {
    return this.#fileSystem
  }

  #fileSystem = {
    getCurrentDirectory: () => this.#cwd,
    readFileSync: (filePath: string) => this.#readFile(filePath) ?? '',
    realpathSync: (filePath: string) => this.#realpath(filePath),
    fileExists: (filePath: string) => this.#readFile(filePath) !== undefined,
    writeFileSync: (filePath: string, content: string) => {
      // Written, not installed — and deliberately without advancing the snapshot. Bytes moving
      // on disk is not the same event as a project being told about them, which is why the
      // callers that write here go on to call `reloadSourceFile`.
      this.#disk.set(this.#abs(filePath), content)
    },
    deleteSync: (filePath: string) => {
      this.#disk.delete(this.#abs(filePath))
    },
    mkdirSync: () => undefined,
  }

  /** The resolved compiler options, under the property spelling ts-morph exposed. */
  get compilerOptions() {
    return this.getCompilerOptions()
  }

  /** Ends the compiler process. A project that is not closed keeps one alive. */
  dispose(): void {
    this.#pending = undefined
    reclaim.unregister(this)
    closeQuietly(this.#api)
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
    let membershipMoved = false
    for (const path of [...(changes.created ?? []), ...(changes.changed ?? [])]) {
      if (this.#opened.has(path)) continue
      this.#opened.add(path)
      membershipMoved = true
    }
    for (const path of changes.deleted ?? []) membershipMoved = this.#opened.delete(path) || membershipMoved

    // Membership is the config's `files` list, so a file joining or leaving the project is an
    // edit to the config — announced alongside the file's own event so one round trip carries
    // both.
    //
    // Deliberately not `openFiles`. That is the LSP's way in, and it searches ancestor
    // directories for a tsconfig containing the file: inside any real checkout it finds the
    // user's, loads that entire project, and the cost is the 2 GB `#writeConfig` describes.
    // Naming the file here instead keeps the program exactly what bamboo installed.
    // A path may not sit in two categories at once, and the batch is a set per category — so a
    // path arriving under a different heading than it already holds ends the batch. That is
    // rare (a file created and then deleted before anything read it) and keeps the merge from
    // having to decide which event wins.
    for (const [category, paths] of [
      ['created', changes.created],
      ['changed', changes.changed],
      ['deleted', changes.deleted],
    ] as const) {
      for (const path of paths ?? []) {
        const elsewhere = (['created', 'changed', 'deleted'] as const).some(
          (other) => other !== category && this.#pending?.[other].has(path),
        )
        if (elsewhere) this.#flush()
        const batch = (this.#pending ??= { changed: new Set(), created: new Set(), deleted: new Set() })
        batch[category].add(path)
      }
    }

    if (membershipMoved) this.#membershipMoved = true
  }

  /**
   * Send everything announced since the last read, in one round trip.
   *
   * bamboo installs its inventory a file at a time — the parser loops over `getFiles()` and
   * calls `createSourceFile` for each — and every one of those is a change the compiler has to
   * be told about. Told one at a time, a 2,000-file project is 2,000 round trips, each carrying
   * a `files` list one entry longer than the last: quadratic in the size of the project, and
   * paid on every cold build.
   *
   * Nothing can observe a snapshot until something reads from it, so the announcements can wait
   * until then. Every reader flushes first, which makes a bulk install a single update and
   * leaves one edit exactly as immediate as it was.
   */
  #flush(): void {
    const pending = this.#pending
    if (!pending) return
    this.#pending = undefined

    // Membership is the config's `files` list, so a file joining or leaving the project is an
    // edit to the config — announced alongside the files' own events so one round trip carries
    // both.
    //
    // Deliberately not `openFiles`. That is the LSP's way in, and it searches ancestor
    // directories for a tsconfig containing the file: inside any real checkout it finds the
    // user's, loads that entire project, and the cost is the 2 GB `#writeConfig` describes.
    // Naming the files here instead keeps the program exactly what bamboo installed.
    const membershipMoved = this.#membershipMoved
    this.#membershipMoved = false
    if (membershipMoved) this.#writeConfig()

    this.#snapshot = this.#api.updateSnapshot({
      fileChanges: {
        ...(pending.created.size ? { created: [...pending.created] } : {}),
        changed: [...pending.changed, ...(membershipMoved ? [this.#configPath] : [])],
        ...(pending.deleted.size ? { deleted: [...pending.deleted] } : {}),
      },
    })
  }

  #project() {
    return this.#snapshot.getProjects()[0]
  }

  #onDisk(filePath: string): boolean {
    if (this.#disk.has(this.#abs(filePath))) return true
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
    const disk = this.#disk
    /** Both stores, overlay first: installed text outranks the bytes it was installed over. */
    const held = (fileName: string) => overlay.get(fileName) ?? disk.get(fileName)
    /** `undefined` rather than a thrown ENOENT/EISDIR — see above. */
    const attempt = <T>(read: () => T): T | undefined => {
      try {
        return read()
      } catch {
        return undefined
      }
    }
    return {
      /**
       * The spelling bamboo used, not the one the filesystem canonicalises to.
       *
       * The compiler resolves symlinks by default, so on macOS a project under `/var/folders`
       * comes back as `/private/var/folders` — a different string for the same file. Every
       * record bamboo keeps is keyed by path: the resolution ledger, dependency edges, the
       * watcher's ids and the bundler's module ids, none of which canonicalise. ts-morph did
       * not either, so the two agreed by default and now have to be made to.
       *
       * A caller that genuinely wants canonicalisation supplies its own `realpath` below.
       */
      realpath: (fileName: string) => fileName,
      ...fs,
      readFile(fileName) {
        const known = held(fileName)
        return known === undefined ? attempt(() => fs?.readFile?.(fileName)) : known
      },
      fileExists(fileName) {
        // `undefined` is not `false` here. The delegate's contract is that declining to answer
        // falls through to the real filesystem, so collapsing "no delegate" into "no such file"
        // tells the compiler every file on disk is missing — and a project constructed without
        // an `fs` at all, which is the ordinary case, then has an empty program.
        return held(fileName) !== undefined ? true : attempt(() => fs?.fileExists?.(fileName))
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
        for (const known of [...overlay.keys(), ...disk.keys()]) {
          if (!known.startsWith(prefix)) continue
          const rest = known.slice(prefix.length)
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
