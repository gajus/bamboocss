import { logger } from '@bamboocss/logger'
import { Features, transform, browserslistToTargets } from 'lightningcss'
import browserslist from 'browserslist'

interface OptimizeOptions {
  minify?: boolean
  browserslist?: string[]
}

const decoder = new TextDecoder()

export function optimizeLightCss(code: string, options: OptimizeOptions = {}) {
  const { minify = false, browserslist: targets } = options

  const result = transform({
    // https://stackoverflow.com/questions/78790943/in-typescript-5-6-buffer-is-not-assignable-to-arraybufferview-or-uint8arr
    code: Buffer.from(code) as any as Uint8Array,
    minify,
    sourceMap: false,
    filename: 'styles.css',
    include: Features.Nesting | Features.MediaRangeSyntax,
    // `light-dark()` stays as written. Lowered, each token folded into it becomes
    // `var(--lightningcss-light, …) var(--lightningcss-dark, …)`, which a custom property
    // substitutes where it is declared, so a subtree's `color-scheme: dark` — the documented
    // toggle — changed no token at all. The baseline already requires `light-dark()`, and the
    // PostCSS path never lowered it.
    exclude: Features.LightDark,
    targets: browserslistToTargets(browserslist(targets)),
    errorRecovery: true,
  })

  if (result.warnings.length) {
    const split = code.split('\n')
    logger.warn(
      'css',
      result.warnings.map((w) => ({ ...w, line: split[w.loc.line - 1] })),
    )
  }

  return decoder.decode(result.code)
}
