import { findConfig } from '@bamboocss/config'
import { logger } from '@bamboocss/logger'
import { BambooError, uniq } from '@bamboocss/shared'
import type { DiffConfigResult } from '@bamboocss/types'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, normalize, resolve } from 'node:path'
import { artifactsToRebuild, codegen } from './codegen'
import { loadConfigAndCreateContext } from './config'
import { BambooContext } from './create-context'
import { assembleExtractedSheet } from './assemble-sheet'
import { globDirname } from './glob-dirname'
import { sourceMatcher, splitPatterns } from './node-runtime'
import { createSourceScanCache, recordResolvedTokenReferences } from './token-references'

const fileModifiedMap = new Map<string, number>()

interface FileChanges {
  changes: Map<string, FileMeta>
  hasFilesChanged: boolean
}

/** Dependency → importer edges, as the native evaluator recorded them. */
type ResolutionLedger = ReadonlyArray<readonly [string, string]>

/** Binary minimum heap; callers provide the stable semantic rank used for ties/order. */
class MinPriorityQueue<T> {
  private values: T[] = []

  constructor(private compare: (left: T, right: T) => number) {}

  get size() {
    return this.values.length
  }

  push = (value: T) => {
    let index = this.values.length
    this.values.push(value)
    while (index > 0) {
      const parent = (index - 1) >> 1
      const parentValue = this.values[parent]!
      if (this.compare(value, parentValue) >= 0) break
      this.values[index] = parentValue
      index = parent
    }
    this.values[index] = value
  }

  pop = (): T | undefined => {
    if (!this.values.length) return undefined
    const first = this.values[0]!
    const last = this.values.pop()!
    if (!this.values.length) return first

    let index = 0
    while (true) {
      const left = index * 2 + 1
      if (left >= this.values.length) break
      const right = left + 1
      let next = left
      if (right < this.values.length && this.compare(this.values[right]!, this.values[left]!) < 0) next = right
      if (this.compare(last, this.values[next]!) <= 0) break
      this.values[index] = this.values[next]!
      index = next
    }
    this.values[index] = last
    return first
  }
}

/** A folder or file the glob reached through a link, by where it really is and as the glob spelled it. */
interface LinkedPath {
  directory: boolean
  real: string
  realPrefix: string
  spelled: string
  spelledPrefix: string
}

/** Files a watcher knows moved since the previous setup. Omit this to retain filesystem discovery. */
export interface BuilderSourceChanges {
  /** Absolute or cwd-relative paths. An empty list authoritatively means no source moved. */
  files: readonly string[]
  /** Additions and deletions can change glob membership, so they still reconcile the inventory. */
  needsInventoryScan?: boolean
  /** A `dependencies` glob gained or lost a member and must be expanded before config diffing. */
  needsConfigReload?: boolean
}

export interface BuilderSetupOptions {
  configPath?: string
  cwd?: string
  dev?: boolean
  /**
   * A build that rebuilds on change — `vite build --watch` — and so takes the config fast path a
   * dev server takes. Unlike `dev`, it leaves the context as a build's.
   */
  watch?: boolean
  /** Record each atom's first call site during extraction, for `getAtomOrigins`. */
  atomOrigins?: boolean
  /** A watcher-owned change journal. Without one, Builder performs its standalone filesystem scan. */
  sourceChanges?: BuilderSourceChanges
}

export class Builder {
  /**
   * The current bamboo context
   */
  context: BambooContext | undefined

  private hasEmitted = false
  private filesMeta: FileChanges | undefined
  private explicitDepsMeta: FileChanges | undefined
  private affecteds: DiffConfigResult | undefined
  private configDependencies: Set<string> = new Set()
  /** Last complete included inventory, including members which have since been deleted. */
  private sourceInventory: string[] | undefined
  /** Where the glob behind that inventory began, and what it reached through a link. */
  private sourceLinks: readonly string[] = []
  /** Existing included owners selected by the last resolution-ledger invalidation pass. */
  private affectedFiles: Set<string> | undefined
  /** Dependency-before-importer parse order for the selected owners. */
  private extractionOrder: string[] | undefined
  /** Exact cross-file semantic reads retained per included extraction owner. */
  private resolutionReadSets = new Map<string, readonly string[]>()
  /** Previously semantic paths which are absent, retained only while their owner is unchanged. */
  private pendingResolutionReadSets = new Map<string, readonly string[]>()
  /** Missing local priority candidates which can redirect a current semantic resolution. */
  private resolutionCandidateSets = new Map<string, readonly string[]>()
  /** Exact resolver configuration reads retained per included semantic owner. */
  private resolutionConfigurationSets = new Map<string, readonly string[]>()
  /** Byte snapshots for resolver configuration files, independent of filesystem mtimes. */
  private resolutionConfigurationBytes = new Map<string, string | undefined>()
  /** Previous effective tsconfig read-set, needed to classify its deletion as an option reload. */
  private tsconfigResolutionFiles: readonly string[] = []
  /** Config-graph mtimes as of the last completed setup, consulted by the dev fast path. */
  private configGraphMtimes: Map<string, number> | undefined
  /** Per-file source-scan results for `toCss`, valid while each file's mtime stands still. */
  private sourceScanCache = createSourceScanCache()
  /**
   * Dependency edges as they stood before this pass's first source mutation, and the owners
   * each changed file reached then — before re-extraction replaces the edges that found them.
   */
  private capturedLedger: ResolutionLedger | undefined
  private capturedDependents = new Map<string, string[]>()

  /**
   * Reload one edited source, keeping the closure the next extraction pass has to select.
   *
   * An integration which shares this context has to refresh an edited module before anything
   * folds against it — a consumer is transformed before the module it imports, so the fold
   * would otherwise bake in the previous contents. Doing that through the Project directly
   * loses the graph the rebuild needs: reloading retracts the file's own forward edges, and
   * `invalidateChangedSources` reads them afterwards to find its dependents. So the mutation
   * belongs here, behind a snapshot taken before the first of them.
   *
   * Once per pass, not once per file: the first mutation is the boundary, and every later one
   * in the same event is already described by that snapshot. `refreshSourceState` consumes it.
   */
  reloadSource = (filePath: string) => {
    const ctx = this.getContextOrThrow()
    this.captureResolutionLedger(ctx, filePath)
    ctx.project.reloadSourceFile(filePath)
    ctx.forgetAuxiliarySource(filePath)
  }

  /** The deletion half of `reloadSource`, with the same snapshot obligation. */
  removeSource = (filePath: string) => {
    const ctx = this.getContextOrThrow()
    this.captureResolutionLedger(ctx, filePath)
    ctx.project.removeSourceFile(filePath)
    ctx.forgetNativeFile(filePath)
  }

  private captureResolutionLedger = (ctx: BambooContext, filePath: string) => {
    this.capturedLedger ??= ctx.getNativeDependencyLedger()
    const file = this.absOwner(ctx, filePath)
    if (!this.capturedDependents.has(file)) this.capturedDependents.set(file, ctx.getNativeDependents(file))
  }

  /** @internal Current and missing resolver paths which can change the stylesheet. */
  getResolutionReadFiles = (): readonly string[] => {
    const files = new Set<string>()
    for (const readSets of [this.resolutionReadSets, this.pendingResolutionReadSets, this.resolutionCandidateSets]) {
      for (const dependencies of readSets.values()) {
        for (const dependency of dependencies) files.add(dependency)
      }
    }
    return Object.freeze([...files].sort())
  }

  /** @internal The inventory reconciled by the most recent extraction pass. */
  getSourceFiles = (): readonly string[] => Object.freeze([...(this.sourceInventory ?? [])])

  /** The folders each context's patterns are globbed from. @see getWatchDirectories */
  private patternDirectories = new WeakMap<BambooContext, readonly string[]>()
  /** Those, and the folders the glob reached through a link, for one context and glob. @see getWatchDirectories */
  private watchDirectories: { ctx: BambooContext; links: readonly string[]; directories: readonly string[] } | undefined

  /**
   * @internal The folders `include` and `dependencies` are globbed from, absolute — and each folder
   * the last glob reached through a link — where a file appearing can change the stylesheet, and so
   * what a watcher has to watch for it to be seen. A link a pattern's wildcard reaches,
   * `node_modules/@acme/*` to a workspace package, leads somewhere no pattern names.
   */
  getWatchDirectories = (): readonly string[] => {
    const ctx = this.getContextOrThrow()
    let patterns = this.patternDirectories.get(ctx)
    if (!patterns) {
      const { cwd, dependencies, include } = ctx.config
      // A negation reads nothing, so it names no folder; `!(legacy)/**` is no negation, but a glob.
      const { positive } = splitPatterns([...(include ?? []), ...(dependencies ?? [])])
      patterns = Object.freeze(
        positive.length ? uniq(globDirname(positive).map((directory) => resolve(cwd, directory))) : [],
      )
      this.patternDirectories.set(ctx, patterns)
    }
    const cached = this.watchDirectories
    if (cached?.ctx === ctx && cached.links === this.sourceLinks) return cached.directories
    const linked = this.linkedPaths().toReal.filter((path) => path.directory)
    const directories = Object.freeze(uniq([...patterns, ...linked.map((path) => path.spelled)]))
    this.watchDirectories = { ctx, links: this.sourceLinks, directories }
    return directories
  }

  /** The compiled `include`/`exclude` matcher of each context, since the compiler asks per module. */
  private sourceMatchers = new WeakMap<BambooContext, (path: string) => boolean>()

  private sourceMatcherOf = (ctx: BambooContext) => {
    let matches = this.sourceMatchers.get(ctx)
    if (!matches) {
      matches = sourceMatcher(ctx.config.include, ctx.config.exclude, ctx.config.cwd)
      this.sourceMatchers.set(ctx, matches)
    }
    return matches
  }

  /**
   * @internal Whether this path is one `include` covers and `exclude` does not.
   *
   * What decides source membership when a file appears, and what the Vite compiler asks of
   * every module it is handed: a module outside the extraction inventory yields no rule, so
   * compiling it is wasted — and with the TypeScript 7 backend, far from free.
   */
  isPotentialSourceFile = (filePath: string): boolean => {
    const ctx = this.getContextOrThrow()
    const absolutePath = this.absOwner(ctx, filePath)
    const relativePath = this.sourcePath(ctx.runtime.path.relative(ctx.config.cwd, absolutePath))
    const isSource = this.sourceMatcherOf(ctx)
    if (isSource(relativePath)) return true
    // A bundler names a module by where it really is, which a link `include` was read through
    // spells otherwise: the module is a source if any spelling of it is. Only a spelling in a folder
    // `include` is globbed from can be, which spares the matcher every dependency of a project
    // that is itself reached through a link.
    const bases = this.includeBases(ctx)
    return this.sourcePathsOf(absolutePath).some(
      (source) =>
        bases.some((base) => source === base.path || source.startsWith(base.prefix)) &&
        isSource(this.sourcePath(ctx.runtime.path.relative(ctx.config.cwd, source))),
    )
  }

  /** The packages the inventory holds files of, by name, for one inventory. @see isSourcePackage */
  private sourcePackages: { inventory: readonly string[]; names: ReadonlySet<string> } | undefined

  /**
   * @internal Whether a package is one the inventory holds files of — a workspace package `include`
   * reaches, such as a design system imported as `@acme/ds`. `true` before an inventory exists.
   *
   * What the Vite compiler asks of a module importing a package by name. A published package ships
   * its own output, but a call into this one folds against its source, and the compiled source no
   * longer defines what a module left uncompiled would call. Named as a workspace links a package:
   * by the nearest `package.json` above each file that has a name.
   */
  isSourcePackage = (name: string): boolean => {
    const ctx = this.getContextOrThrow()
    const inventory = this.sourceInventory
    if (!inventory) return true
    if (this.sourcePackages?.inventory !== inventory) {
      const nameByDirectory = new Map<string, string | undefined>()
      const packageNameOf = (directory: string): string | undefined => {
        if (nameByDirectory.has(directory)) return nameByDirectory.get(directory)
        let packageName: string | undefined
        const manifest = resolve(directory, 'package.json')
        if (existsSync(manifest)) {
          try {
            const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
            if (typeof parsed.name === 'string') packageName = parsed.name
          } catch {
            // Not a manifest a package manager could link a name from.
          }
        }
        const parent = dirname(directory)
        if (packageName === undefined && parent !== directory) packageName = packageNameOf(parent)
        nameByDirectory.set(directory, packageName)
        return packageName
      }
      const names = new Set<string>()
      for (const file of inventory) {
        const packageName = packageNameOf(dirname(this.absOwner(ctx, file)))
        if (packageName) names.add(packageName)
      }
      this.sourcePackages = { inventory, names }
    }
    return this.sourcePackages.names.has(name)
  }

  /** The folders each context's `include` is globbed from. @see isPotentialSourceFile */
  private includeBaseCache = new WeakMap<BambooContext, ReadonlyArray<{ path: string; prefix: string }>>()

  private includeBases = (ctx: BambooContext) => {
    let bases = this.includeBaseCache.get(ctx)
    if (!bases) {
      const { positive } = splitPatterns(ctx.config.include ?? [])
      bases = (positive.length ? uniq(globDirname(positive)) : []).map((directory) => {
        const path = this.sourcePath(resolve(ctx.config.cwd, directory))
        return { path, prefix: path.endsWith('/') ? path : `${path}/` }
      })
      this.includeBaseCache.set(ctx, bases)
    }
    return bases
  }

  /** The linked paths of each glob, resolved once each. @see linkedPaths */
  private linkedPathCache = new WeakMap<readonly string[], { all: LinkedPath[]; toReal: LinkedPath[] }>()

  /**
   * Where each folder and file the glob behind the inventory reached through a link — or the folder
   * it began at, spelled through a link above it — really is, which is what a bundler resolving a
   * module there names it by. Resolved once per glob, and only when asked, so a build that never
   * asks pays nothing. Any difference in spelling counts, case too: a bundler names a module as the
   * system does, and a path the inventory spells otherwise is no member of it.
   */
  private linkedPaths = () => {
    let linked = this.linkedPathCache.get(this.sourceLinks)
    if (!linked) {
      const all: LinkedPath[] = []
      for (const link of this.sourceLinks) {
        let real: string
        let directory: boolean
        try {
          real = this.sourcePath(realpathSync.native(link))
          directory = statSync(real).isDirectory()
        } catch {
          continue
        }
        const spelled = this.sourcePath(link)
        if (real !== spelled)
          all.push({ directory, real, realPrefix: `${real}/`, spelled, spelledPrefix: `${spelled}/` })
      }
      // Deepest first, so the folder nearest a file answers for it.
      const toReal = [...all].sort((left, right) => right.spelled.length - left.spelled.length)
      linked = { all, toReal }
      this.linkedPathCache.set(this.sourceLinks, linked)
    }
    return linked
  }

  /**
   * An absolute, `/`-spelled path as the inventory spells it — each way, where two links reach one
   * folder and the inventory holds the files under both. None, where no link is in the way.
   */
  private sourcePathsOf = (path: string) => {
    const sources: string[] = []
    for (const { real, realPrefix, spelled } of this.linkedPaths().all) {
      if (path === real) sources.push(spelled)
      else if (path.startsWith(realPrefix)) sources.push(spelled + path.slice(real.length))
    }
    return sources
  }

  /**
   * @internal `filePath` as the source inventory spells it, where a bundler names it by where it
   * really is: through each folder or file a link was read at. None, where no link is in the way.
   */
  toSourcePaths = (filePath: string): readonly string[] => {
    const ctx = this.getContextOrThrow()
    return this.sourcePathsOf(this.absOwner(ctx, filePath))
  }

  /** The inventory's sources by where each really is, for one inventory and glob. @see getRealSourceFiles */
  private realSourceFiles:
    | { inventory: readonly string[]; links: readonly string[]; reals: readonly string[] }
    | undefined

  /**
   * @internal The sources the inventory reached through a link, by where each really is: the names
   * a bundler gives them, and so what it reports compiling and editing.
   */
  getRealSourceFiles = (): readonly string[] => {
    const ctx = this.getContextOrThrow()
    const inventory = this.sourceInventory
    if (!inventory) return []
    const cached = this.realSourceFiles
    if (cached?.inventory === inventory && cached.links === this.sourceLinks) return cached.reals
    const { toReal } = this.linkedPaths()
    const reals: string[] = []
    if (toReal.length) {
      for (const file of inventory) {
        const path = this.absOwner(ctx, file)
        for (const { real, spelled, spelledPrefix } of toReal) {
          if (path === spelled) reals.push(real)
          else if (path.startsWith(spelledPrefix)) reals.push(real + path.slice(spelled.length))
          else continue
          break
        }
      }
    }
    this.realSourceFiles = { inventory, links: this.sourceLinks, reals: Object.freeze(reals) }
    return this.realSourceFiles.reals
  }

  /** @internal Whether creating or deleting this path can change a `dependencies` glob. */
  isPotentialConfigDependency = (filePath: string): boolean => {
    const ctx = this.getContextOrThrow()
    const absolutePath = this.absOwner(ctx, filePath)
    const relativePath = this.sourcePath(ctx.runtime.path.relative(ctx.config.cwd, absolutePath))
    let matcher = this.dependencyMatchers.get(ctx)
    if (!matcher) {
      // As the glob that expands `dependencies` reads them.
      matcher = sourceMatcher(ctx.config.dependencies, undefined, ctx.config.cwd)
      this.dependencyMatchers.set(ctx, matcher)
    }
    return matcher(relativePath)
  }

  /** The compiled `dependencies` matcher of each context, since a watcher asks per event. */
  private dependencyMatchers = new WeakMap<BambooContext, (path: string) => boolean>()

  /** @internal Exact local package/tsconfig files which can change semantic resolution. */
  getResolutionConfigurationFiles = (): readonly string[] => {
    const files = new Set<string>()
    for (const configurations of this.resolutionConfigurationSets.values()) {
      for (const configuration of configurations) files.add(configuration)
    }
    return Object.freeze([...files].sort())
  }

  private readResolutionConfiguration = (file: string): string | undefined => {
    try {
      return readFileSync(file).toString('base64')
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
      throw error
    }
  }

  private changedResolutionConfigurations = (knownChanges?: ReadonlySet<string>): string[] =>
    this.getResolutionConfigurationFiles().filter(
      (file) =>
        (!knownChanges || knownChanges.has(this.sourcePath(file))) &&
        this.resolutionConfigurationBytes.get(file) !== this.readResolutionConfiguration(file),
    )

  private snapshotResolutionConfigurations = () => {
    const current = new Set(this.getResolutionConfigurationFiles())
    for (const file of current) this.resolutionConfigurationBytes.set(file, this.readResolutionConfiguration(file))
    for (const file of this.resolutionConfigurationBytes.keys()) {
      if (!current.has(file)) this.resolutionConfigurationBytes.delete(file)
    }
  }

  private recordConfigDependencies = (ctx: BambooContext, cwd?: string) => {
    const root = cwd ?? ctx.config.cwd
    for (const file of uniq([...ctx.conf.dependencies, ...ctx.explicitDeps])) {
      this.configDependencies.add(resolve(root, file))
    }
  }

  setup = async (options: BuilderSetupOptions = {}) => {
    logger.debug('builder', '🚧 Setup')

    const configPath = options.configPath ?? findConfig({ cwd: options.cwd })

    if (!this.context) {
      return this.setupContext({ configPath, cwd: options.cwd, dev: options.dev, atomOrigins: options.atomOrigins })
    }

    const ctx = this.getContextOrThrow()
    const previousExplicitDeps = [...ctx.explicitDeps]
    const previousTsconfigFiles = this.tsconfigResolutionFiles.length
      ? this.tsconfigResolutionFiles
      : ctx.diff.getResolutionConfigFiles()

    /**
     * Dev fast path: skip the config reload when nothing that can change the resolved config
     * has moved on disk.
     *
     * `reloadConfigAndRefreshContext` re-bundles and re-evaluates the config file and the
     * tsconfig chain on every call, and a dev server reaches `setup` on every stylesheet
     * rebuild — that is 10–18ms paid per source edit for a config that cannot have changed,
     * since editing the config restarts the dev server outside this method's control anyway.
     * The guard set is exactly what the reload would re-read: the config file, its bundled
     * import graph, the explicit `dependencies`, and the tsconfig files behind resolution. Any
     * of them moving — including appearing or disappearing, which `getFileMeta` reports as a
     * changed mtime — takes the full reload below, as does a file the last snapshot never saw.
     *
     * Dev and watch only, because the reload is also the recovery for edits this guard cannot
     * see — a preset external to the config bundle — and a one-shot build keeps paying the
     * reload rather than trading that recovery for a latency only watch mode feels. A watching
     * build takes it as a dev server does for a second reason: an ES module config is imported
     * anew on every reload, and Node keeps every version it imported, so a reload per rebuild
     * held one more copy of the config per rebuild for as long as the build watched.
     */
    // A watching build has no journal of the files that came and went, as a dev server's watcher
    // keeps (`sourceChanges`), so it globs `dependencies` again: a member gained or lost is a
    // config input like any other, and the reload below reads it.
    const membersMoved = Boolean(options.watch && !options.sourceChanges && this.dependencyMembersMoved(ctx))
    const needsConfigReload = Boolean(options.sourceChanges?.needsConfigReload) || membersMoved
    if (
      (options.dev || options.watch) &&
      !membersMoved &&
      this.configGraphUnchanged(configPath, options.sourceChanges)
    ) {
      this.affecteds = { artifacts: new Set(), hasConfigChanged: false, diffs: [] }
      this.explicitDepsMeta = this.checkFilesChanged(this.context.explicitDeps)
      this.refreshSourceState(ctx, previousTsconfigFiles, options.sourceChanges)
      return
    }

    this.affecteds = await ctx.diff.reloadConfigAndRefreshContext((conf) => {
      this.context = new BambooContext(conf)
    })
    const nextContext = this.getContextOrThrow()
    nextContext.encoder.recordOrigins = Boolean(options.atomOrigins)
    if (needsConfigReload) {
      const { cwd: configCwd, dependencies } = nextContext.config
      nextContext.explicitDeps = dependencies
        ? nextContext.runtime.fs.glob({ include: dependencies, cwd: configCwd })
        : []
    }
    this.recordConfigDependencies(nextContext, options.cwd)
    this.tsconfigResolutionFiles = nextContext.diff.getResolutionConfigFiles()

    logger.debug('builder', this.affecteds)

    // explicit config dependencies change
    const explicitDeps = needsConfigReload
      ? uniq([...previousExplicitDeps, ...this.context.explicitDeps])
      : this.context.explicitDeps
    const knownChanges = options.sourceChanges
      ? new Set(options.sourceChanges.files.map((file) => this.absOwner(this.context!, file)))
      : undefined
    this.explicitDepsMeta = this.checkFilesChanged(explicitDeps, knownChanges)

    if (this.explicitDepsMeta.hasFilesChanged) {
      this.explicitDepsMeta.changes.forEach((meta, file) => {
        fileModifiedMap.set(file, meta.mtime)
      })

      logger.debug('builder', '⚙️ Explicit config dependencies changed')
      this.affecteds.hasConfigChanged = true
    }

    // config change
    if (this.affecteds.hasConfigChanged) {
      logger.debug('builder', '⚙️ Config changed, reloading')
      this.filesMeta = undefined
      this.affectedFiles = undefined
      this.extractionOrder = undefined
      this.sourceInventory = undefined
      this.resolutionReadSets.clear()
      this.pendingResolutionReadSets.clear()
      this.resolutionCandidateSets.clear()
      this.resolutionConfigurationSets.clear()
      this.resolutionConfigurationBytes.clear()
      this.sourceScanCache.entries.clear()
      this.sourceScanCache.resolvedTokenReferences.clear()
      // Nothing selective survives a config change, and a snapshot from before it describes a
      // graph this pass is about to re-read in full.
      this.capturedLedger = undefined
      this.capturedDependents.clear()
      // The context the reload built, as the CLI hands it: `ctx` is the one from before the edit,
      // and its plugins were handed the config the edit replaced.
      const current = this.getContextOrThrow()
      await current.hooks['config:change']?.({ config: current.config, changes: this.affecteds })
      this.snapshotConfigGraphMtimes(configPath)
      return
    }

    this.refreshSourceState(ctx, previousTsconfigFiles, options.sourceChanges)
    this.snapshotConfigGraphMtimes(configPath)
  }

  /** Whether `dependencies` matches other files now than the context was built with. */
  private dependencyMembersMoved = (ctx: BambooContext) => {
    const { cwd, dependencies } = ctx.config
    if (!dependencies?.length) return false
    const members = new Set(ctx.runtime.fs.glob({ include: dependencies, cwd }))
    return members.size !== ctx.explicitDeps.length || ctx.explicitDeps.some((file) => !members.has(file))
  }

  /** Every file whose content participates in the resolved config, for the dev fast path. */
  private configGraphFiles = (configPath: string | undefined): string[] =>
    uniq(
      [
        ...(configPath ? [configPath] : []),
        ...this.configDependencies,
        ...this.tsconfigResolutionFiles,
        ...(this.context?.explicitDeps ?? []),
      ].map(normalize),
    )

  private configGraphUnchanged = (configPath: string | undefined, sourceChanges?: BuilderSourceChanges): boolean => {
    const snapshot = this.configGraphMtimes
    if (!snapshot) return false
    if (sourceChanges?.needsConfigReload) return false
    const changed = sourceChanges
      ? new Set(sourceChanges.files.map((file) => this.sourcePath(resolve(this.context?.config.cwd ?? '', file))))
      : undefined
    for (const file of this.configGraphFiles(configPath)) {
      if (changed?.has(this.sourcePath(resolve(this.context?.config.cwd ?? '', file)))) return false
      const recorded = snapshot.get(file)
      if (recorded === undefined || recorded !== this.getFileMeta(file).mtime) return false
    }
    return true
  }

  private snapshotConfigGraphMtimes = (configPath: string | undefined) => {
    const snapshot = new Map<string, number>()
    for (const file of this.configGraphFiles(configPath)) snapshot.set(file, this.getFileMeta(file).mtime)
    this.configGraphMtimes = snapshot
  }

  /** The per-pass source bookkeeping every setup ends with, config reload or not. */
  private refreshSourceState = (
    ctx: BambooContext,
    previousTsconfigFiles: readonly string[],
    sourceChanges?: BuilderSourceChanges,
  ) => {
    const knownChanges = sourceChanges
      ? new Set(sourceChanges.files.map((file) => this.absOwner(ctx, file)))
      : undefined
    const changedResolutionConfigurations = this.changedResolutionConfigurations(knownChanges)
    const changedResolutionSet = new Set(changedResolutionConfigurations)
    const resolutionAffected = new Set<string>()
    // The snapshot wins where there is one: it predates whatever an integration reloaded, and
    // the live ledger no longer holds those importers' forward edges.
    const resolutionLedger =
      this.capturedLedger ?? (changedResolutionConfigurations.length ? ctx.getNativeDependencyLedger() : undefined)
    const capturedDependents = this.capturedDependents
    this.capturedLedger = undefined
    this.capturedDependents = new Map()
    for (const [owner, configurations] of this.resolutionConfigurationSets) {
      if (configurations.some((file) => changedResolutionSet.has(file))) resolutionAffected.add(owner)
    }

    if (changedResolutionConfigurations.length) {
      const tsconfigCandidates = new Set([...previousTsconfigFiles, ...this.tsconfigResolutionFiles])
      const replaceCompilerOptions = changedResolutionConfigurations.some((file) => tsconfigCandidates.has(file))
      if (replaceCompilerOptions) {
        ctx.project.refreshResolutionConfiguration(
          ctx.conf.tsconfig?.compilerOptions as Parameters<
            BambooContext['project']['refreshResolutionConfiguration']
          >[0],
        )
      }
    }

    // Source edits are invalidated from the Project's exact resolution read-set. `include`
    // alone misses a plain-object helper outside the glob; the previous inventory alone misses
    // a newly added member; the current inventory alone misses a deletion.
    const needsInventoryScan = !sourceChanges || sourceChanges.needsInventoryScan || this.sourceInventory === undefined
    const linked: string[] = []
    const inventory = needsInventoryScan ? ctx.getFiles(linked) : [...this.sourceInventory!]
    const previousInventory = this.sourceInventory ?? inventory
    const allTracked = uniq([...previousInventory, ...inventory, ...this.getResolutionReadFiles()])
    const trackedPaths = new Set(allTracked.map((file) => this.absOwner(ctx, file)))
    const tracked =
      knownChanges && !needsInventoryScan ? [...knownChanges].filter((file) => trackedPaths.has(file)) : allTracked
    this.filesMeta = tracked.length
      ? this.checkFilesChanged(tracked, knownChanges)
      : changedResolutionConfigurations.length
        ? { changes: new Map(), hasFilesChanged: false }
        : undefined
    for (const [file, meta] of this.filesMeta?.changes ?? []) {
      if (!meta.isUnchanged) this.sourceScanCache.entries.delete(this.absOwner(ctx, file))
    }
    if (this.filesMeta?.hasFilesChanged) {
      logger.debug('builder', 'Files changed, invalidating them')
      this.invalidateChangedSources(ctx, inventory, resolutionAffected, resolutionLedger, capturedDependents)
    } else if (changedResolutionConfigurations.length) {
      ctx.encoder?.reconcileFileOwnerOrder('extract', inventory)
      this.extractionOrder = this.orderAffectedFiles(inventory, resolutionAffected, resolutionLedger ?? [])
      this.affectedFiles = new Set(this.extractionOrder.map(this.sourcePath))
    } else {
      this.affectedFiles = new Set()
      this.extractionOrder = []
    }
    // The same array where nothing was globbed, so what is derived from it is not derived again.
    if (needsInventoryScan) {
      this.sourceInventory = [...inventory]
      this.sourceLinks = linked
    }
  }

  /** Normalize the path identity shared by the Project ledger and file-owner keys. */
  private sourcePath = (file: string) => file.replaceAll('\\', '/')

  /**
   * Refresh changed sources, then select them and their transitive included consumers.
   *
   * Consumers come from the native evaluator's read graph, which includes paths a consumer
   * probed and did not find — so a file appearing reaches the importers that were waiting for
   * it. The graph is read before anything is re-extracted: re-extraction replaces an owner's
   * edges, and waiting would lose the very closure the rebuild needs. An integration that
   * mutated sources earlier in the pass captured it then (`reloadSource`, `removeSource`).
   */
  private invalidateChangedSources = (
    ctx: BambooContext,
    inventory: string[],
    seededAffected: ReadonlySet<string> = new Set(),
    previousLedger?: ResolutionLedger,
    capturedDependents: ReadonlyMap<string, readonly string[]> = new Map(),
  ) => {
    const current = new Set(inventory.map(this.sourcePath))
    const changed = [...(this.filesMeta?.changes ?? [])]
      .filter(([, meta]) => !meta.isUnchanged)
      .map(([file]) => this.sourcePath(file))
    const ledger = previousLedger ?? ctx.getNativeDependencyLedger()
    const affected = new Set<string>(seededAffected)

    for (const file of changed) {
      if (current.has(file)) affected.add(file)
      for (const dependent of capturedDependents.get(file) ?? []) affected.add(this.sourcePath(dependent))
      for (const dependent of ctx.getNativeDependents(file)) affected.add(this.sourcePath(dependent))
    }

    for (const file of changed) {
      if (!existsSync(file)) {
        ctx.project.removeSourceFile(file)
        ctx.forgetNativeFile(file)
        fileModifiedMap.set(file, -Infinity)
      } else {
        ctx.project.reloadSourceFile(file)
        ctx.forgetAuxiliarySource(file)
      }
    }

    // Rank all current owners before committing any newly added contribution. This separates
    // semantic output order from discovery/parse completion order.
    ctx.encoder?.reconcileFileOwnerOrder('extract', inventory)

    this.extractionOrder = this.orderAffectedFiles(inventory, affected, ledger)
    this.affectedFiles = new Set(this.extractionOrder.map(this.sourcePath))
  }

  /** Deterministic topological order, with current inventory order as the stable tie-break. */
  private orderAffectedFiles = (inventory: string[], affected: ReadonlySet<string>, ledger: ResolutionLedger) => {
    const files = inventory.filter((file) => affected.has(this.sourcePath(file)))
    const byPath = new Map(files.map((file) => [this.sourcePath(file), file]))
    const inventoryRank = new Map(files.map((file, index) => [this.sourcePath(file), index]))
    const outgoing = new Map<string, Set<string>>()
    const indegree = new Map(files.map((file) => [this.sourcePath(file), 0]))

    const addEdge = (rawTarget: string | null, rawImporter: string) => {
      if (!rawTarget) return
      const target = this.sourcePath(rawTarget)
      const importer = this.sourcePath(rawImporter)
      if (target === importer || !byPath.has(target) || !byPath.has(importer)) return
      const importers = outgoing.get(target) ?? new Set<string>()
      if (importers.has(importer)) return
      importers.add(importer)
      outgoing.set(target, importers)
      indegree.set(importer, (indegree.get(importer) ?? 0) + 1)
    }

    for (const [target, importer] of ledger) addEdge(target, importer)
    for (const [target, importer] of this.getContextOrThrow().getNativeDependencyLedger()) addEdge(target, importer)

    const compare = (left: string, right: string) => (inventoryRank.get(left) ?? 0) - (inventoryRank.get(right) ?? 0)
    const ready = new MinPriorityQueue(compare)
    for (const [file, degree] of indegree) if (degree === 0) ready.push(file)
    const ordered: string[] = []
    const emitted = new Set<string>()
    while (ready.size) {
      const file = ready.pop()!
      ordered.push(file)
      emitted.add(file)
      for (const importer of outgoing.get(file) ?? []) {
        const next = (indegree.get(importer) ?? 0) - 1
        indegree.set(importer, next)
        if (next === 0) ready.push(importer)
      }
    }

    // Cycles retain inventory order. Resolution/evaluation already handles their semantics;
    // this is only a deterministic staging order, not a second graph architecture.
    for (const file of byPath.keys()) if (!emitted.has(file)) ordered.push(file)
    return ordered.map((file) => byPath.get(file)!)
  }

  /**
   * Write the generated `styled-system`, so an integration can be a project's only codegen.
   *
   * The first call writes everything. That looks like the redundant half — a project that ran
   * `bamboo codegen` already has the files — but it is the only call that ever mattered, and it
   * used to do nothing: the guard below read `hasEmitted` before it was ever set, so the first
   * call fell straight through to setting the flag and the artifacts were written only after a
   * *subsequent* config change. A clone with no `styled-system/` on disk therefore got none from
   * `vite dev` or `vite build` either, which is what the callers exist to guarantee — the dev
   * server answered with an error overlay, and the build failed to resolve `styled-system/css`
   * from the first module that imports it. Every project has had to run the CLI first and pass
   * for a build step, which on one react-router app is 585 ms of a 2,242 ms build, ~97% of it
   * spent loading modules to do 21 ms of work.
   *
   * Later calls stay narrow, which is what the guard was reaching for. A watch rebuild re-emits
   * only the artifacts a config change affected, and a rebuild that changed no config writes
   * nothing at all.
   *
   * Unless the output directory is gone: the flag says this builder wrote the artifacts once, not
   * that they are still there. A process running several builds with the same plugin instances,
   * and cleaning `styled-system/` between them, failed every build after the first on
   * `Could not load styled-system/css`.
   */
  async emit() {
    const ctx = this.context
    const gone = this.hasEmitted && ctx !== undefined && !existsSync(ctx.runtime.path.join(...ctx.paths.root))

    if (!this.hasEmitted || gone) {
      logger.debug('builder', gone ? 'Emit artifacts, the output directory having been removed' : 'Emit artifacts')
      await codegen(this.getContextOrThrow())
    } else if (this.affecteds?.hasConfigChanged) {
      logger.debug('builder', 'Emit artifacts after config change')
      await codegen(this.getContextOrThrow(), artifactsToRebuild(this.affecteds))
    }

    this.hasEmitted = true
  }

  setupContext = async (options: SetupContextOptions) => {
    const { configPath, cwd, dev } = options

    const ctx = await loadConfigAndCreateContext({ configPath, cwd, dev })
    ctx.encoder.recordOrigins = Boolean(options.atomOrigins)

    this.recordConfigDependencies(ctx, cwd)

    this.context = ctx
    this.tsconfigResolutionFiles = ctx.diff.getResolutionConfigFiles()
    return ctx
  }

  getContextOrThrow = (): BambooContext => {
    if (!this.context) {
      throw new BambooError('NO_CONTEXT', 'context not loaded')
    }
    return this.context
  }

  /** One canonical spelling for verification keys: absolute, forward slashes. */
  private absOwner = (ctx: BambooContext, file: string) =>
    this.sourcePath(ctx.runtime?.path?.abs ? ctx.runtime.path.abs(ctx.config.cwd, file) : file)

  getFileMeta = (file: string) => {
    const mtime = existsSync(file) ? statSync(file).mtimeMs : -Infinity
    const isUnchanged = fileModifiedMap.has(file) && mtime === fileModifiedMap.get(file)
    return { mtime, isUnchanged }
  }

  checkFilesChanged(files: readonly string[], knownChanges?: ReadonlySet<string>) {
    const changes = new Map<string, FileMeta>()

    let hasFilesChanged = false

    for (const file of files) {
      const meta = this.getFileMeta(file)
      if (knownChanges?.has(this.sourcePath(file))) meta.isUnchanged = false
      changes.set(file, meta)
      if (!meta.isUnchanged) {
        hasFilesChanged = true
      }
    }

    return { changes, hasFilesChanged }
  }

  extractFile = (ctx: BambooContext, file: string) => {
    const meta = this.filesMeta?.changes.get(file) ?? this.getFileMeta(file)

    const hasConfigChanged = this.affecteds ? this.affecteds.hasConfigChanged : true
    if (meta.isUnchanged && !hasConfigChanged && !this.affectedFiles?.has(this.sourcePath(file))) return

    const owner = this.sourcePath(file)
    const previousReads = this.resolutionReadSets.get(owner) ?? []
    const previousPending = this.pendingResolutionReadSets.get(owner) ?? []
    const previousCandidates = this.resolutionCandidateSets.get(owner) ?? []
    const previousConfigurations = this.resolutionConfigurationSets.get(owner) ?? []
    const parserResult = ctx.parseFile(file)
    recordResolvedTokenReferences(this.sourceScanCache, this.absOwner(ctx, file), parserResult)
    fileModifiedMap.set(file, meta.mtime)

    if (parserResult) {
      const dependencies = parserResult.getDependencies()
      const readSet = {
        dependencies: uniq(dependencies).sort(),
        pendingCandidates: uniq([...parserResult.nativePendingCandidates]).sort(),
      }
      const currentReads = readSet.dependencies
      const currentConfigurations = uniq([
        ...(currentReads.length || readSet.pendingCandidates.length ? this.tsconfigResolutionFiles : []),
        ...parserResult.nativeConfigurationFiles,
      ]).sort()
      this.resolutionReadSets.set(owner, currentReads)
      if (readSet.pendingCandidates.length) {
        this.resolutionCandidateSets.set(owner, readSet.pendingCandidates)
      } else {
        this.resolutionCandidateSets.delete(owner)
      }

      // A dependency which disappeared cannot occur in the fresh ParserResult: there is no
      // declaration node to carry its path. It is nevertheless still the exact semantic read
      // which selected this unchanged owner on the unlink pass. Keep polling only those prior
      // reads while they are absent. A source edit to the owner recomputes intent from scratch,
      // so removing or making that import runtime-only releases the pending path immediately.
      // Keeping this separate from `resolutionReadSets` preserves the meaning of the live set
      // and never promotes arbitrary unresolved/runtime ledger branches into watch inputs.
      const pending = meta.isUnchanged
        ? uniq([...previousPending, ...previousReads])
            .filter(
              (dependency) =>
                !existsSync(dependency) &&
                !currentReads.includes(dependency) &&
                (!previousCandidates.includes(dependency) || readSet.pendingCandidates.includes(dependency)),
            )
            .sort()
        : []
      if (pending.length) this.pendingResolutionReadSets.set(owner, pending)
      else this.pendingResolutionReadSets.delete(owner)

      // A config edit can make a formerly semantic alias unresolved, leaving no current
      // dependency node from which to rediscover its tsconfig/package manifest. Retain that
      // exact prior config read only while the owner itself is unchanged; an owner edit which
      // removes or makes the import runtime-only releases it immediately.
      const configurations =
        currentConfigurations.length || !meta.isUnchanged ? currentConfigurations : previousConfigurations
      if (configurations.length) this.resolutionConfigurationSets.set(owner, configurations)
      else this.resolutionConfigurationSets.delete(owner)
    }

    return parserResult
  }

  extract = () => {
    const ctx = this.getContextOrThrow()

    const hasConfigChanged = this.affecteds ? this.affecteds.hasConfigChanged : true
    if (!this.filesMeta && !hasConfigChanged) {
      logger.debug('builder', 'No files or config changed, skipping extract')
      // Still asserted. A file that failed to extract on an earlier pass is not re-parsed by
      // one that skips it, so the failure has to outlive the pass that recorded it or a
      // no-op rebuild would launder a broken build into a green one. No file list to hand it:
      // this branch globbed nothing, and `assertExtracted` only reaches for one when there is
      // a failure to place.
      ctx.assertExtracted()
      return ctx.assertNoDeadCalls()
    }

    // The list `refreshSourceState` globbed moments ago in this same pass. Re-globbing here
    // costs a directory walk per rebuild and can only disagree with `filesMeta` — which was
    // computed from that inventory — about files that appeared in between, and those are the
    // next watcher event's to handle either way.
    const linked: string[] = []
    const files = !hasConfigChanged && this.sourceInventory ? [...this.sourceInventory] : ctx.getFiles(linked)
    const inventory = new Set(files.map(this.sourcePath))
    if (hasConfigChanged) {
      this.resolutionReadSets.clear()
      this.pendingResolutionReadSets.clear()
      this.resolutionCandidateSets.clear()
      this.resolutionConfigurationSets.clear()
    } else {
      for (const owner of this.resolutionReadSets.keys()) {
        if (!inventory.has(owner)) this.resolutionReadSets.delete(owner)
      }
      for (const owner of this.pendingResolutionReadSets.keys()) {
        if (!inventory.has(owner)) this.pendingResolutionReadSets.delete(owner)
      }
      for (const owner of this.resolutionCandidateSets.keys()) {
        if (!inventory.has(owner)) this.resolutionCandidateSets.delete(owner)
      }
      for (const owner of this.resolutionConfigurationSets.keys()) {
        if (!inventory.has(owner)) this.resolutionConfigurationSets.delete(owner)
      }
    }
    ctx.encoder?.reconcileFileOwnerOrder('extract', files)
    // A cold Builder pass is Vite's path into extraction. Use the same cheap source scan as
    // `parseFiles`; otherwise Vite parses every included file while the CLI skips non-authors.
    const filesToExtract = hasConfigChanged ? ctx.extractableFiles(files, linked) : (this.extractionOrder ?? files)

    const done = logger.time.info('Extracted in')

    ctx.prepareNativeExtraction(filesToExtract)

    // `for…of` rather than `.map`, whose result is discarded. `.map` also builds an array
    // holding every `ParserResult` until the statement ends, keeping the whole set reachable
    // across the pass for nothing — what each result carries is in the encoder by then.
    //
    // Measured neutral, and recorded as such so nobody re-derives it: on a 2,000-file build,
    // median extract 1,724ms against 1,712ms, with a control repeat of the original at
    // 1,697ms — the three within 1.6%, and peak RSS flat. The retention is real and the
    // collector does not care. Kept because a `.map` for its side effects reads as a bug.
    for (const file of filesToExtract) {
      this.extractFile(ctx, file)
    }

    done()

    if (hasConfigChanged || !this.sourceInventory) {
      this.sourceInventory = [...files]
      this.sourceLinks = linked
    }
    // Resolver-discovered modules can sit outside `include`. Their bytes were semantically
    // read by this pass, so remember the same mtimes as included owners and detect their next
    // edit without globbing the checkout.
    for (const file of uniq([...files, ...this.getResolutionReadFiles()])) {
      const mtime =
        this.filesMeta?.changes.get(file)?.mtime ?? fileModifiedMap.get(file) ?? this.getFileMeta(file).mtime
      fileModifiedMap.set(file, mtime)
    }
    this.snapshotResolutionConfigurations()
    this.affectedFiles = undefined
    this.extractionOrder = undefined

    // After `done()`, so the timing line still reports the pass that just ran rather than
    // being swallowed by the throw. Handed the list this pass walked, so it does not glob
    // a second time to ask which files still exist.
    ctx.forgetUnresolvedTokenCallsOutside(files)
    ctx.assertExtracted(files)
    ctx.assertNoDeadCalls(files)
  }

  /**
   * The finished stylesheet, as a string.
   *
   * `layerParams` controls the `@layer a, b, c;` statement that fixes layer order. CSS layers
   * are ordered by first appearance otherwise.
   *
   * `extract` has to have run first: this reads the encoder rather than filling it.
   */
  toCss = ({ layerParams = false }: { layerParams?: boolean } = {}) => {
    const ctx = this.getContextOrThrow()
    const sheet = assembleExtractedSheet(ctx, {
      layerParams,
      sourceScanCache: this.sourceScanCache,
      mtimeOf: (filePath) => this.filesMeta?.changes.get(filePath)?.mtime ?? fileModifiedMap.get(filePath),
      sourceInventory: this.sourceInventory,
    })
    return ctx.getCss(sheet)
  }

  /**
   * Each atom's first call site, by class name, as recorded by the last `extract`.
   *
   * Empty unless `setup` was asked for `atomOrigins`.
   */
  getAtomOrigins = () => this.getContextOrThrow().getAtomOrigins()
}

interface FileMeta {
  mtime: number
  isUnchanged: boolean
}

interface SetupContextOptions {
  configPath: string
  cwd?: string
  /** @see `BuilderSetupOptions.atomOrigins` */
  atomOrigins?: boolean
  /** Set by the integration; only a dev server knows it is one. @see `hash: 'auto'` */
  dev?: boolean
}
