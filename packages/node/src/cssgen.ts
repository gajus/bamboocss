import { prunesPreflight } from '@bamboocss/core'
import { logger } from '@bamboocss/logger'
import type { CssArtifactType } from '@bamboocss/types'
import { assembleExtractedSheet } from './assemble-sheet'
import type { BambooContext } from './create-context'
import { collectRenderedElements } from './token-references'

export interface CssGenOptions {
  cwd: string
  outfile?: string
  type?: CssArtifactType
  splitting?: boolean
}

export const cssgen = async (ctx: BambooContext, options: CssGenOptions) => {
  const { outfile, type, splitting } = options

  if (type) {
    const sheet = ctx.createSheet()
    const done = logger.time.info(ctx.messages.cssArtifactComplete(type))

    ctx.appendCssOfType(type, sheet)

    // The token and keyframe passes cannot run here: both decide reachability by reading
    // the finished stylesheet, and this branch emits one artifact, so everything would look
    // unreachable. `preflight.prune` reads the source instead of the sheet, so a partial one
    // costs it nothing -- and without this the `reset.css` from `cssgen preflight` differs
    // from the one `cssgen --splitting` writes for the same project.
    //
    // Note this branch never calls `parseFiles`, which `collectRenderedElements` does not
    // need: it reads the files itself rather than anything parsing leaves behind.
    if (type === 'preflight' && prunesPreflight(ctx.config.preflight)) {
      ctx.prunePreflight(sheet, collectRenderedElements(ctx))
    }

    if (outfile) {
      const css = ctx.getCss(sheet)
      logger.info('css', ctx.runtime.path.resolve(outfile))
      await ctx.runtime.fs.writeFile(outfile, css)
    } else {
      await ctx.writeCss(sheet)
    }

    done()
  } else {
    const { files } = ctx.parseFiles()

    const done = logger.time.info(ctx.messages.buildComplete(files.length))

    const sheet = assembleExtractedSheet(ctx, { layerParams: true })

    if (splitting) {
      await ctx.writeSplitCss(sheet)
    } else if (outfile) {
      const css = ctx.getCss(sheet)
      logger.info('css', ctx.runtime.path.resolve(outfile))
      await ctx.runtime.fs.writeFile(outfile, css)
    } else {
      await ctx.writeCss(sheet)
    }

    done()
  }
}
