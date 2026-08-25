import type { Context } from '@bamboocss/core'
import type { Stylesheet } from '@bamboocss/core'

export const generateStaticCss = (ctx: Context, sheet?: Stylesheet, options?: { atomizeRecipes?: boolean }) => {
  const { config, staticCss } = ctx
  const engine = staticCss.process(ctx.config.staticCss ?? {}, sheet, options)

  if (!sheet) {
    const { minify } = config
    let css = engine.sheet.toCss({ minify })

    if (ctx.hooks['cssgen:done']) {
      css = ctx.hooks['cssgen:done']({ artifact: 'static', content: css }) ?? css
    }

    return css
  }
}
