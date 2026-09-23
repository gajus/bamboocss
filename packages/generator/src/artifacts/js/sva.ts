import type { Context } from '@bamboocss/core'
import { outdent } from 'outdent'

/**
 * The runtime `sva` a compiled build keeps: a callable that throws, and `splitVariantProps`.
 *
 * See `generateCvaFn`. The slot recipe carried the same unreachable engine, plus
 * `classNameMap`, `slotsAffectedBy` and `scopeRoots` for `auditSlotScopes` — which took the
 * recipe object as an argument, and passing it is itself a `runtime-binding`, so the audit
 * could not be called from any build that compiled. It is removed with them. The Vite compiler
 * returns complete atom strings for every slot and emits no `@scope` rules, so there is no
 * unreachable-slot failure left for it to report.
 */
export function generateSvaFn(ctx: Context) {
  return {
    js: outdent`
    ${ctx.file.import('splitProps, uncompiledStyle', '../helpers')}

    export function sva(config) {
      const variantKeys = Object.keys(config?.variants ?? {})

      return Object.assign((_props) => uncompiledStyle('sva'), {
        splitVariantProps(props) {
          return splitProps(props, variantKeys)
        },
      })
    }
    `,
    dts: outdent`
    ${ctx.file.importType('SlotRecipeCreatorFn', '../types/recipe')}

    export declare const sva: SlotRecipeCreatorFn
    `,
  }
}
