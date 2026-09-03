import { getExportDeclarations } from '@bamboocss/ts-ast'
import { findConfig } from '@bamboocss/config'
import { logger } from '@bamboocss/logger'
import { BambooError, uniq } from '@bamboocss/shared'
import type { DiffConfigResult } from '@bamboocss/types'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { normalize, resolve } from 'path'
import picomatch from 'picomatch'
import { codegen } from './codegen'
import { loadConfigAndCreateContext } from './config'
import { BambooContext } from './create-context'
import { assembleExtractedSheet } from './assemble-sheet'
import { globIgnore } from './node-runtime'
import { createSourceScanCache, recordResolvedTokenReferences } from './token-references'

const fileModifiedMap = new Map<string, number>()

interface FileChanges {
  changes: Map<string, FileMeta>
  hasFilesChanged: boolean
}

type ResolutionLedger = ReturnType<BambooContext['project']['getResolutionLedger']>

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
  /** Cross-file value reads each owner's last extraction performed, with parse-time digests. */
  private extractionReadsByOwner = new Map<
    string,
    ReadonlyArray<{ file: string; name: string; digest: string | undefined }>
  >()
  /** Each owner's recipe surface — declared cva/sva configs plus export-statement texts. */
  private recipeSurfaceByOwner = new Map<string, string | undefined>()
  /** Whether each file changed this pass kept its recipe surface; consulted by dependents. */
  private recipeSurfaceStable = new Map<string, boolean>()
  /** Files this pass re-extracts because their bytes moved, as `sourcePath` spellings. */
  private changedThisPass = new Set<string>()
  /** Whether this pass selected any owner through resolution-configuration changes. */
  private resolutionAffectedThisPass = false
  /** Per-pass digests of re-read values, so N dependents of one edit digest each value once. */
  private readDigestMemo = new Map<string, string | undefined>()
  /** Resolution ledger as it stood before this pass's first physical source mutation. */
  private capturedLedger: ResolutionLedger | undefined

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
    this.captureResolutionLedger(ctx)
    return ctx.project.reloadSourceFile(filePath)
  }

  /** The deletion half of `reloadSource`, with the same snapshot obligation. */
  removeSource = (filePath: string) => {
    const ctx = this.getContextOrThrow()
    this.captureResolutionLedger(ctx)
    ctx.forgetNativeFile(filePath)
    return ctx.project.removeSourceFile(filePath)
  }

  private captureResolutionLedger = (ctx: BambooContext) => {
    this.capturedLedger ??= ctx.project.getResolutionLedger()
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

  /** The compiled `include`/`exclude` matcher of each context, since the compiler asks per module. */
  private sourceMatchers = new WeakMap<BambooContext, ((path: string) => boolean) | undefined>()

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
    if (!this.sourceMatchers.has(ctx)) {
      const sourcePatterns = ctx.config.include ?? []
      this.sourceMatchers.set(
        ctx,
        sourcePatterns.length ? picomatch(sourcePatterns, { ignore: globIgnore(ctx.config.exclude) }) : undefined,
      )
    }
    const sourceMatcher = this.sourceMatchers.get(ctx)
    return sourceMatcher?.(relativePath) || sourceMatcher?.(absolutePath) || false
  }

  /** @internal Whether creating or deleting this path can change a `dependencies` glob. */
  isPotentialConfigDependency = (filePath: string): boolean => {
    const ctx = this.getContextOrThrow()
    const absolutePath = this.absOwner(ctx, filePath)
    const relativePath = this.sourcePath(ctx.runtime.path.relative(ctx.config.cwd, absolutePath))
    const patterns = ctx.config.dependencies ?? []
    const matcher = patterns.length ? picomatch(patterns) : undefined
    return matcher?.(relativePath) || matcher?.(absolutePath) || false
  }

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
     * Dev-only because the reload is also the recovery for edits this guard cannot see — a
     * preset external to the config bundle — and a one-shot build keeps paying the reload
     * rather than trading that recovery for a latency only watch mode feels.
     */
    if (options.dev && this.configGraphUnchanged(configPath, options.sourceChanges)) {
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
    if (options.sourceChanges?.needsConfigReload) {
      const { cwd: configCwd, dependencies } = nextContext.config
      nextContext.explicitDeps = dependencies
        ? nextContext.runtime.fs.glob({ include: dependencies, cwd: configCwd })
        : []
    }
    this.recordConfigDependencies(nextContext, options.cwd)
    this.tsconfigResolutionFiles = nextContext.diff.getResolutionConfigFiles()

    logger.debug('builder', this.affecteds)

    // explicit config dependencies change
    const explicitDeps = options.sourceChanges?.needsConfigReload
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
      this.extractionReadsByOwner.clear()
      this.recipeSurfaceByOwner.clear()
      // Nothing selective survives a config change, and a snapshot from before it describes a
      // graph this pass is about to re-read in full.
      this.capturedLedger = undefined
      await ctx.hooks['config:change']?.({ config: ctx.config, changes: this.affecteds })
      this.snapshotConfigGraphMtimes(configPath)
      return
    }

    this.refreshSourceState(ctx, previousTsconfigFiles, options.sourceChanges)
    this.snapshotConfigGraphMtimes(configPath)
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
      this.capturedLedger ?? (changedResolutionConfigurations.length ? ctx.project.getResolutionLedger() : undefined)
    this.capturedLedger = undefined
    for (const [owner, configurations] of this.resolutionConfigurationSets) {
      if (configurations.some((file) => changedResolutionSet.has(file))) resolutionAffected.add(owner)
    }
    this.resolutionAffectedThisPass = resolutionAffected.size > 0

    if (changedResolutionConfigurations.length) {
      const tsconfigCandidates = new Set([...previousTsconfigFiles, ...this.tsconfigResolutionFiles])
      const replaceCompilerOptions = changedResolutionConfigurations.some((file) => tsconfigCandidates.has(file))
      ctx.project.refreshResolutionConfiguration(
        ctx.conf.tsconfig?.compilerOptions,
        this.tsconfigResolutionFiles,
        replaceCompilerOptions,
      )
    }

    // Source edits are invalidated from the Project's exact resolution read-set. `include`
    // alone misses a plain-object helper outside the glob; the previous inventory alone misses
    // a newly added member; the current inventory alone misses a deletion.
    const needsInventoryScan = !sourceChanges || sourceChanges.needsInventoryScan || this.sourceInventory === undefined
    const inventory = needsInventoryScan ? ctx.getFiles() : [...this.sourceInventory!]
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
      this.invalidateChangedSources(ctx, inventory, resolutionAffected, resolutionLedger)
    } else if (changedResolutionConfigurations.length) {
      ctx.encoder?.reconcileFileOwnerOrder('extract', inventory)
      this.extractionOrder = this.orderAffectedFiles(inventory, resolutionAffected, resolutionLedger ?? [], [])
      this.affectedFiles = new Set(this.extractionOrder.map(this.sourcePath))
    } else {
      this.affectedFiles = new Set()
      this.extractionOrder = []
    }
    this.sourceInventory = [...inventory]
  }

  /** Normalize the path identity shared by the Project ledger and file-owner keys. */
  private sourcePath = (file: string) => file.replaceAll('\\', '/')

  /**
   * Reload only changed ledger members, then select their transitive included consumers.
   *
   * The dependency graph is snapshotted before mutation: reloading an importer retracts its
   * old forward edges, while deletion removes the target. Waiting until afterwards loses the
   * very closure the rebuild needs. New targets also select every pending importer and each
   * pending importer's dependent closure, because no edge to the new path existed yet.
   */
  private invalidateChangedSources = (
    ctx: BambooContext,
    inventory: string[],
    seededAffected: ReadonlySet<string> = new Set(),
    previousLedger?: ReturnType<BambooContext['project']['getResolutionLedger']>,
  ) => {
    const project = ctx.project
    const current = new Set(inventory.map(this.sourcePath))
    const changed = [...(this.filesMeta?.changes ?? [])]
      .filter(([, meta]) => !meta.isUnchanged)
      .map(([file]) => this.sourcePath(file))
    const ledger = previousLedger ?? project.getResolutionLedger()
    const pending = project.getUnresolvedImporters().map(this.sourcePath)
    const affected = new Set<string>(seededAffected)
    const added: string[] = []

    for (const file of changed) {
      if (current.has(file)) affected.add(file)
      for (const dependent of project.getDependents(file)) affected.add(this.sourcePath(dependent))
      for (const dependent of ctx.getNativeDependents(file)) affected.add(this.sourcePath(dependent))

      if (existsSync(file) && !project.getSourceFile(file)) added.push(file)
    }

    // Snapshot this before createSourceFile reparses resolution candidates and clears the
    // pending bit. Every pending importer can have consumers of its own.
    if (added.length) {
      for (const importer of pending) {
        affected.add(importer)
        for (const dependent of project.getDependents(importer)) affected.add(this.sourcePath(dependent))
      }
    }

    for (const file of changed) {
      if (!existsSync(file)) {
        project.removeSourceFile(file)
        fileModifiedMap.set(file, -Infinity)
      } else if (project.getSourceFile(file)) {
        project.reloadSourceFile(file)
      } else {
        project.createSourceFile(file)
      }
    }

    // Rank all current owners before committing any newly added contribution. This separates
    // semantic output order from discovery/parse completion order.
    ctx.encoder?.reconcileFileOwnerOrder('extract', inventory)

    const syntheticEdges = added.flatMap((target) => pending.map((importer) => [target, importer] as const))
    this.extractionOrder = this.orderAffectedFiles(inventory, affected, ledger, syntheticEdges)
    this.affectedFiles = new Set(this.extractionOrder.map(this.sourcePath))
  }

  /** Deterministic topological order, with current inventory order as the stable tie-break. */
  private orderAffectedFiles = (
    inventory: string[],
    affected: ReadonlySet<string>,
    ledger: ReturnType<BambooContext['project']['getResolutionLedger']>,
    syntheticEdges: readonly (readonly [string, string])[],
  ) => {
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

    for (const fact of ledger) addEdge(fact.target, fact.importer)
    for (const [target, importer] of this.getContextOrThrow().getNativeDependencyLedger()) addEdge(target, importer)
    for (const [target, importer] of syntheticEdges) addEdge(target, importer)

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
   */
  async emit() {
    if (!this.hasEmitted) {
      logger.debug('builder', 'Emit artifacts')
      await codegen(this.getContextOrThrow())
    } else if (this.affecteds?.hasConfigChanged) {
      logger.debug('builder', 'Emit artifacts after config change')
      await codegen(this.getContextOrThrow(), Array.from(this.affecteds.artifacts))
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

  /**
   * The changed file's recipe surface: every declared `cva`/`sva` config, in declaration
   * order, plus the text of every export statement. A value edit inside a `css()` call moves
   * neither; a recipe config edit moves the first; an export alias or re-export edit — which
   * can re-route what a consumer's call resolves to without any declaration changing — moves
   * the second. `undefined` when any part cannot be pinned down, which disables skipping.
   */
  private digestRecipeSurface = (
    ctx: BambooContext,
    file: string,
    parserResult: ReturnType<BambooContext['parseFile']>,
  ): string | undefined => {
    try {
      const recipes: Array<[string, unknown]> = []
      for (const set of [parserResult?.cva, parserResult?.sva]) {
        for (const item of set ?? []) recipes.push([item.name ?? '', item.data])
      }
      const sourceFile = ctx.project?.getSourceFile?.(file)
      const exports = sourceFile ? getExportDeclarations(sourceFile).map((declaration) => declaration.getText()) : []
      const json = JSON.stringify([recipes, exports], (_key, value) =>
        value === undefined ? 'bamboo:undefined' : value,
      )
      if (json === undefined) return undefined
      return createHash('sha256').update(json).digest('base64')
    } catch {
      return undefined
    }
  }

  /** One canonical spelling for verification keys: absolute, forward slashes. */
  private absOwner = (ctx: BambooContext, file: string) =>
    this.sourcePath(ctx.runtime?.path?.abs ? ctx.runtime.path.abs(ctx.config.cwd, file) : file)

  /** Whether every changed file this dependent reads kept both its values and its surface. */
  private dependentUnchangedByReads = (ctx: BambooContext, owner: string): boolean => {
    // A dependent can be selected without any tracked source changing at all — an import-map
    // or tsconfig edit retargets what its specifiers resolve to — and nothing these records
    // witness can vouch for resolution. Any such selection this pass disables skipping, as
    // does an empty changed set, which means the selection came from that machinery.
    if (this.resolutionAffectedThisPass || this.changedThisPass.size === 0) return false

    const reads = this.extractionReadsByOwner.get(owner)
    if (reads === undefined) return false

    for (const changed of this.changedThisPass) {
      if (this.recipeSurfaceStable.get(changed) !== true) return false
    }

    for (const read of reads) {
      const readOwner = this.sourcePath(ctx.runtime.path.abs(ctx.config.cwd, read.file))
      if (!this.changedThisPass.has(readOwner)) continue
      if (read.digest === undefined) return false
      const key = `${read.file}\u0000${read.name}`
      if (!this.readDigestMemo.has(key)) {
        this.readDigestMemo.set(key, ctx.project.digestExportRead(read.file, read.name))
      }
      const current = this.readDigestMemo.get(key)
      if (current === undefined || current !== read.digest) return false
    }
    return true
  }

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

    /**
     * A dependent selected only because a file it reads changed can be verified instead of
     * re-extracted: its own bytes did not move, so its extraction output moves only if a
     * value it read moved, or if the changed file's recipe surface — which decides how its
     * calls classify — moved. Both are checked against digests recorded when this owner was
     * last extracted; the changed file itself was re-extracted earlier in this same ordered
     * pass, which is what makes the surface comparison current. Any gap — a read that could
     * not be digested, a surface this pass has no verdict for, a JSX-component config whose
     * classification these records do not witness — falls through to the re-extraction this
     * replaces.
     */
    if (
      meta.isUnchanged &&
      !hasConfigChanged &&
      !this.changedThisPass.has(this.absOwner(ctx, file)) &&
      // Conservative when the answer is unknowable: JSX component classification can hinge on
      // cross-file resolution these records do not witness, so its presence disables skipping.
      !((ctx as unknown as { jsx?: { isEnabled?: boolean } }).jsx?.isEnabled ?? true) &&
      this.dependentUnchangedByReads(ctx, this.absOwner(ctx, file))
    ) {
      return
    }

    const owner = this.sourcePath(file)
    const previousReads = this.resolutionReadSets.get(owner) ?? []
    const previousPending = this.pendingResolutionReadSets.get(owner) ?? []
    const previousCandidates = this.resolutionCandidateSets.get(owner) ?? []
    const previousConfigurations = this.resolutionConfigurationSets.get(owner) ?? []
    const parserResult = ctx.parseFile(file)
    recordResolvedTokenReferences(this.sourceScanCache, this.absOwner(ctx, file), parserResult)
    fileModifiedMap.set(file, meta.mtime)

    {
      // What this owner read, and what its recipe surface is now — the two records dependent
      // verification compares against on the next pass. The surface verdict for a *changed*
      // file is decided here, against the digest its previous extraction recorded. Every key
      // is the absolute spelling, which is the one the parser's read records carry.
      const owner = this.absOwner(ctx, file)
      const reads =
        (
          parserResult as
            | { getExportReads?: () => ReadonlyArray<{ file: string; name: string; digest: string | undefined }> }
            | undefined
        )?.getExportReads?.() ?? []
      const parsedNatively = Boolean((parserResult as { native?: boolean } | undefined)?.native)
      if (parsedNatively) {
        // The Rust evaluator records dependency paths rather than TypeScript export-node
        // digests. An unchanged native owner selected by one of those paths must therefore be
        // re-extracted; an empty digest set would incorrectly certify stale output as stable.
        this.extractionReadsByOwner.delete(owner)
      } else {
        this.extractionReadsByOwner.set(owner, reads)
      }
      // Asking for export declarations materializes a TypeScript tree. Native extraction
      // deliberately trades this skip optimization for staying compiler-free.
      const surface = !parsedNatively && ctx.project ? this.digestRecipeSurface(ctx, file, parserResult) : undefined
      if (this.changedThisPass.has(owner)) {
        const previous = this.recipeSurfaceByOwner.get(owner)
        this.recipeSurfaceStable.set(owner, previous !== undefined && surface !== undefined && previous === surface)
      }
      this.recipeSurfaceByOwner.set(owner, surface)
    }

    if (parserResult) {
      const previousReadSet = meta.isUnchanged
        ? {
            dependencies: uniq([...previousReads, ...previousPending]).sort(),
            pendingCandidates: previousCandidates,
          }
        : undefined
      const nativeResult = parserResult as {
        native?: boolean
        nativePendingCandidates?: readonly string[]
        nativeConfigurationFiles?: readonly string[]
      }
      const native = Boolean(nativeResult.native)
      const dependencies = parserResult.getDependencies()
      const readSet = native
        ? {
            dependencies: uniq(dependencies).sort(),
            pendingCandidates: uniq([...(nativeResult.nativePendingCandidates ?? [])]).sort(),
          }
        : ctx.project.getResolutionReadSet(file, dependencies, previousReadSet)
      const currentReads = readSet.dependencies
      const currentConfigurations = native
        ? uniq([
            ...(currentReads.length || readSet.pendingCandidates.length ? this.tsconfigResolutionFiles : []),
            ...(nativeResult.nativeConfigurationFiles ?? []),
          ]).sort()
        : ctx.project.getResolutionConfigurationFiles(
            file,
            dependencies,
            meta.isUnchanged ? previousConfigurations : [],
          )
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
    const files = !hasConfigChanged && this.sourceInventory ? [...this.sourceInventory] : ctx.getFiles()
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
    const filesToExtract = hasConfigChanged ? ctx.extractableFiles(files) : (this.extractionOrder ?? files)

    // The set this pass genuinely re-reads, and a fresh digest memo for it. Dependents whose
    // bytes did not move consult both: `extractionOrder` puts every changed file before its
    // dependents, so by the time a dependent is visited, each changed file's fresh recipe
    // surface has been recorded and its values are one memoized digest away.
    this.changedThisPass = new Set(
      [...(this.filesMeta?.changes ?? [])]
        .filter(([, fileMeta]) => !fileMeta.isUnchanged)
        .map(([changed]) => this.sourcePath(ctx.runtime.path.abs(ctx.config.cwd, changed))),
    )
    this.recipeSurfaceStable.clear()
    this.readDigestMemo.clear()

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

    this.sourceInventory = [...files]
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
