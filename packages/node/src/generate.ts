import { logger } from '@bamboocss/logger'
import { BambooError } from '@bamboocss/shared'
import type { ArtifactId, Config } from '@bamboocss/types'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { assembleExtractedSheet } from './assemble-sheet'
import { artifactsToRebuild, codegen } from './codegen'
import { loadConfigAndCreateContext } from './config'
import { BambooContext } from './create-context'
import { createSourceScanCache, recordResolvedTokenReferences, type SourceScanCache } from './token-references'

async function build(ctx: BambooContext, sourceScanCache?: SourceScanCache, artifactIds?: ArtifactId[]) {
  await codegen(ctx, artifactIds)

  if (ctx.config.emitTokensOnly) {
    return logger.info('css:emit', 'Successfully rebuilt the css variables and js function to query your tokens ✨')
  }

  const done = logger.time.info('')

  const parsed = ctx.parseFiles()
  if (sourceScanCache) {
    for (const result of parsed.results) {
      if (result.filePath) {
        recordResolvedTokenReferences(sourceScanCache, ctx.runtime.path.abs(ctx.config.cwd, result.filePath), result)
      }
    }
  }
  const sheet = assembleExtractedSheet(
    ctx,
    sourceScanCache
      ? { layerParams: true, sourceScanCache, sourceInventory: parsed.files }
      : { layerParams: true, parserResults: parsed.results },
  )

  await ctx.writeCss(sheet)
  done(ctx.messages.buildComplete(parsed.files.length))
}

export interface GenerateOptions {
  /**
   * Refuse to build when `include` matches no files, instead of writing an empty stylesheet over
   * the one already there.
   *
   * For globs a person just typed, where matching nothing is a mistake — `bamboo ./codgen`,
   * `bamboo 'src/*.tsxx'` — and not a config's own, which a new project has nothing under yet.
   * Watching, where the files may be about to appear, only a directory is refused: a glob matches
   * files, so nothing appearing under it ever matches it.
   */
  requireFiles?: boolean
}

/** Refuse an `include` matching no files — see `GenerateOptions.requireFiles`. */
function assertFilesMatched(ctx: BambooContext) {
  const { include, exclude, cwd, watch } = ctx.config
  // `bamboo src` reads as building from the directory.
  const directory = include.find((glob) => statSync(resolve(cwd, glob), { throwIfNoEntry: false })?.isDirectory())
  if ((watch && directory === undefined) || ctx.getFiles().length) return

  const name = directory?.replace(/(.)[\\/]+$/, '$1')
  throw new BambooError(
    'NOT_FOUND',
    `${include.map((glob) => `\`${glob}\``).join(', ')} match${include.length === 1 ? 'es' : ''} no files, so ` +
      `nothing was built, and the stylesheet was left as it was.`,
    {
      hint:
        name !== undefined
          ? `\`${name}\` is a directory, and a glob matches files: write one for the files in it, like \`${name}/**/*.tsx\`.`
          : `Globs are read from ${cwd}${exclude?.length ? ', less what `exclude` takes out' : ''}. Run ` +
            `\`bamboo --help\` if you meant a command.`,
    },
  )
}

export async function generate(config: Config, configPath?: string, options: GenerateOptions = {}) {
  let ctx = await loadConfigAndCreateContext({ config, configPath })
  const sourceScanCache = createSourceScanCache()
  const { cwd, watch, poll } = ctx.config

  if (options.requireFiles && !ctx.config.emitTokensOnly) assertFilesMatched(ctx)

  await build(ctx, watch ? sourceScanCache : undefined)

  if (watch) {
    //
    ctx.watchConfig(
      async (_file, reloaded) => {
        const affecteds = await ctx.diff.reloadConfigAndRefreshContext((conf) => {
          ctx = new BambooContext(conf)
        })
        reloaded(ctx)
        sourceScanCache.entries.clear()
        sourceScanCache.resolvedTokenReferences.clear()

        logger.info('ctx:updated', 'config rebuilt ✅')
        await ctx.hooks['config:change']?.({ config: ctx.config, changes: affecteds })
        await build(ctx, sourceScanCache, artifactsToRebuild(affecteds))
        return ctx
      },
      { cwd, poll },
    )

    /**
     * Re-parses every affected file, then builds and writes the stylesheet once.
     *
     * One edit can affect many files — a shared style file is folded into all of
     * its importers — and the sheet is rebuilt from the whole parser result, not
     * per file. Writing per file would run the optimize pipeline and hit the disk
     * once per importer for a single keystroke.
     */
    const bundleStyles = async (ctx: BambooContext, changedFilePaths: string[], inventoryChanged = false) => {
      let parsed = 0
      ctx.prepareNativeExtraction(changedFilePaths)
      for (const filePath of changedFilePaths) {
        // The initial `build` and watch rebuilds share the native extraction owner, so a
        // replacement retracts its previous atoms instead of adding a second reading.
        const result = ctx.parseFile(filePath)
        recordResolvedTokenReferences(sourceScanCache, filePath, result)
        if (result) parsed++
      }

      if (parsed === 0 && !inventoryChanged) return

      const outfile = ctx.runtime.path.join(...ctx.paths.root, 'styles.css')
      const done = logger.time.info(ctx.messages.buildComplete(parsed))
      const sheet = assembleExtractedSheet(ctx, { layerParams: true, sourceScanCache })
      const css = ctx.getCss(sheet)
      await ctx.output.writeFile(outfile, css)

      done()
    }

    ctx.watchFiles(async (event, file) => {
      const filePath = ctx.runtime.path.abs(cwd, file)
      if (event === 'unlink') {
        // Snapshot before removing the native edges: consumers folded this file's values into
        // their own output and have to be rebuilt to stop emitting them.
        const dependents = ctx.getNativeDependents(filePath)
        ctx.project.removeSourceFile(filePath)
        ctx.forgetNativeFile(filePath)
        sourceScanCache.entries.delete(filePath)
        sourceScanCache.resolvedTokenReferences.delete(filePath)
        await bundleStyles(ctx, dependents, true)
      } else if (event === 'change') {
        const dependents = ctx.getNativeDependents(filePath)
        ctx.project.reloadSourceFile(filePath)
        await bundleStyles(ctx, [...new Set([filePath, ...dependents])])
      } else if (event === 'add') {
        // Missing higher-priority candidates are part of the native read graph, so ask before
        // replacing those pending edges with the newly resolved ones.
        const dependents = ctx.getNativeDependents(filePath)
        await bundleStyles(ctx, [...new Set([filePath, ...dependents])])
      }
    })
  }
}
