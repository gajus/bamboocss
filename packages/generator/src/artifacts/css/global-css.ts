import type { Context, Stylesheet } from '@bamboocss/core'

export const generateGlobalCss = (ctx: Context, sheet: Stylesheet) => {
  const globalCss = ctx.config.global?.css ?? {}

  sheet.processGlobalCss({
    ':root': { '--made-with-bamboo': ctx.config.watermark === false ? `''` : `'🎋'` },
  })

  sheet.processGlobalCss(globalCss)
}
