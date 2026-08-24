import { prunesPreflight } from '@bamboocss/core'
import type { Stylesheet } from '@bamboocss/core'
import type { BambooContext } from './create-context'
import { collectSourceScans, keyframeNames, pruneTokensForBuild, type SourceScanCache } from './token-references'

export interface AssembleExtractedSheetOptions {
  layerParams?: boolean
  /**
   * Named recipe rules. The compiled path (`false`) interns every observed recipe as shared
   * utility atoms and omits the recipe layer, which is what the Vite compiler emits.
   */
  includeRecipes?: boolean
  sourceScanCache?: SourceScanCache
  mtimeOf?: (filePath: string) => number | undefined
  sourceInventory?: readonly string[]
}

/**
 * One stylesheet from an already-extracted encoder.
 *
 * Vite, `bamboo cssgen`, and the CLI `bamboo` command all finish here so a recipe lowered to
 * atoms cannot have a different sheet depending on which integration asked for it.
 */
export const assembleExtractedSheet = (
  ctx: BambooContext,
  {
    layerParams = false,
    includeRecipes = false,
    sourceScanCache,
    mtimeOf,
    sourceInventory,
  }: AssembleExtractedSheetOptions = {},
): Stylesheet => {
  if (!includeRecipes) {
    ctx.encoder.atomizeObservedRecipes()
  }

  const sheet = ctx.createSheet()
  if (layerParams) {
    if (includeRecipes) {
      ctx.appendLayerParams(sheet)
    } else {
      const recipeLayer = ctx.config.layers?.recipes ?? 'recipes'
      sheet.layers.root.prepend(`@layer ${sheet.layers.layerNames.filter((name) => name !== recipeLayer).join(', ')};`)
    }
  }

  ctx.appendBaselineCss(sheet)

  // Extraction is already in the shared encoder. `appendBaselineCss` dumps that encoder
  // through static CSS generation, so a second `appendParserCss` would duplicate every rule.
  if (!includeRecipes) {
    sheet.layers.recipes.removeAll()
    sheet.layers.recipes_base.removeAll()
    sheet.layers.recipes_slots.removeAll()
    sheet.layers.recipes_slots_base.removeAll()
  }

  const collectElements = prunesPreflight(ctx.config.preflight)
  const pruneKeyframes = Boolean(ctx.config.prune?.keyframes)
  const declaredKeyframes = pruneKeyframes ? keyframeNames(ctx) : []
  const needsScans = ctx.config.prune?.tokens !== false || collectElements || pruneKeyframes
  const scans = needsScans
    ? collectSourceScans(
        ctx,
        { keyframeNames: declaredKeyframes, elements: collectElements },
        sourceScanCache,
        mtimeOf,
        sourceInventory,
      )
    : undefined
  const reachableVars = pruneTokensForBuild(ctx, sheet, [], scans)

  if (collectElements && scans) {
    ctx.prunePreflight(sheet, scans.elements)
  }

  if (pruneKeyframes && scans) {
    ctx.pruneKeyframes(sheet, scans.keyframeHits, reachableVars)
  }

  return sheet
}
