import type { Context } from '@bamboocss/core'
import { outdent } from 'outdent'

/**
 * The runtime `cva` a compiled build keeps: a callable that throws, and `splitVariantProps`.
 *
 * The Vite compiler rewrites every call into the classes it selects and erases the recipe, so
 * nothing else on the returned object is reachable. It used to carry a whole engine anyway —
 * `resolve`, `raw`, `merge`/`composeRecipes`, `getCompoundVariantCss`, `variantMap`, `config` —
 * and every read of those fails the build with `runtime-binding`, so none of it could run in a
 * build that succeeded. It also kept `mergeCss` and the shorthand table alive in every bundle
 * that imported `cva`.
 *
 * `splitVariantProps` stays because it is the one member the compiler lowers rather than
 * rejects: `b.splitVariantProps(p)` becomes `splitProps(p, [...keys])`, and a call site it
 * could not lower still has a working method behind it.
 */
export function generateCvaFn(ctx: Context) {
  return {
    js: outdent`
    ${ctx.file.import('splitProps, uncompiledStyle', '../helpers')}

    export function cva(config) {
      const variantKeys = Object.keys(config?.variants ?? {})

      return Object.assign((_props) => uncompiledStyle('cva'), {
        splitVariantProps(props) {
          return splitProps(props, variantKeys)
        },
      })
    }
    `,
    dts: outdent`
    ${ctx.file.importType('RecipeCreatorFn', '../types/recipe')}

    export declare const cva: RecipeCreatorFn

    ${ctx.file.exportType('RecipeVariant, RecipeVariantProps', '../types/recipe')}
    `,
  }
}
