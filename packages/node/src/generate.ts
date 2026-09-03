import { logger } from '@bamboocss/logger'
import type { ArtifactId, Config } from '@bamboocss/types'
import { assembleExtractedSheet } from './assemble-sheet'
import { codegen } from './codegen'
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

export async function generate(config: Config, configPath?: string) {
  let ctx = await loadConfigAndCreateContext({ config, configPath })
  const sourceScanCache = createSourceScanCache()
  const { cwd, watch, poll } = ctx.config
  await build(ctx, watch ? sourceScanCache : undefined)

  if (watch) {
    //
    ctx.watchConfig(
      async () => {
        const affecteds = await ctx.diff.reloadConfigAndRefreshContext((conf) => {
          ctx = new BambooContext(conf)
        })
        sourceScanCache.entries.clear()
        sourceScanCache.resolvedTokenReferences.clear()

        logger.info('ctx:updated', 'config rebuilt ✅')
        await ctx.hooks['config:change']?.({ config: ctx.config, changes: affecteds })
        return build(ctx, sourceScanCache, Array.from(affecteds.artifacts))
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
      await ctx.runtime.fs.writeFile(outfile, css)

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
        ctx.project.createSourceFile(filePath)
        await bundleStyles(ctx, [...new Set([filePath, ...dependents])])
      }
    })
  }
}
