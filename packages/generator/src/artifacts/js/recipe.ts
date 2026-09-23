import type { Context } from '@bamboocss/core'
import { Recipes } from '@bamboocss/core'
import { isBoolean, unionType } from '@bamboocss/shared'
import type { ArtifactFilters } from '@bamboocss/types'
import { outdent } from 'outdent'
import { isBooleanValue } from '../../shared'

const hasOwn = (obj: any | undefined, key: string): obj is Record<string, any> => {
  if (!obj) return false
  return Object.prototype.hasOwnProperty.call(obj, key)
}

export function generateRecipes(ctx: Context, filters?: ArtifactFilters) {
  const { recipes } = ctx

  if (recipes.isEmpty()) return

  const details = ctx.recipes.filterDetails(filters)

  return details.map((recipe) => {
    const { baseName, config, upperName, variantKeyMap, dashName } = recipe
    const { description, defaultVariants, compoundVariants, deprecated } = config

    const getDefaultValueJsDoc = (key: string) => {
      if (!hasOwn(defaultVariants, key)) return
      let defaultValue = defaultVariants[key]

      if (isBoolean(defaultValue)) {
        defaultValue = defaultValue ? `true` : `false`
      } else {
        defaultValue = JSON.stringify(defaultValue)
      }

      return ctx.file.jsDocComment('', { default: defaultValue })
    }

    /**
     * A config recipe as a compiled build keeps it: a callable that throws, and
     * `splitVariantProps`. See `generateCvaFn` for why nothing else survives.
     *
     * The slot accessors went with the rest. `recipe.root(props)` and `recipe.icon` read the
     * binding rather than calling it, so both fail the build with `runtime-binding`; the
     * compiled spelling is `recipe(props).root`, which folds to the slot's atoms. They were
     * also what the retired `@scope` model needed — anchors took variants, other slots were
     * constants — and the Vite compiler emits no `@scope` rules.
     */
    const jsCode = outdent`
        ${ctx.file.import('splitProps, uncompiledStyle', '../helpers')}

        const ${baseName}VariantKeys = ${JSON.stringify(Object.keys(variantKeyMap))}

        export const ${baseName} = /* @__PURE__ */ Object.assign((_props) => uncompiledStyle(${JSON.stringify(config.className)}), {
          splitVariantProps(props) {
            return splitProps(props, ${baseName}VariantKeys)
          },
        })
        `

    return {
      name: dashName,

      js: jsCode,

      dts: outdent`
        ${ctx.file.importType('ConditionalValue', '../types/index')}
        ${ctx.file.importType('DistributiveOmit, Pretty', '../types/system-types')}

        interface ${upperName}Variant {
          ${Object.keys(variantKeyMap)
            .map((key) => {
              const values = variantKeyMap[key]
              const valueStr = values.every(isBooleanValue) ? `${key}: boolean` : `${key}: ${unionType(values)}`
              return [getDefaultValueJsDoc(key), valueStr].filter(Boolean).join('\n')
            })
            .join('\n')}
        }

        ${Recipes.isSlotRecipeConfig(config) ? `type ${upperName}Slot = ${unionType(config.slots)}` : ''}

        export type ${upperName}VariantProps = {
          [key in keyof ${upperName}Variant]?: ${
            compoundVariants?.length ? `${upperName}Variant[key]` : `ConditionalValue<${upperName}Variant[key]>`
          } | undefined
        }

        export interface ${upperName}Recipe {
          ${Recipes.isSlotRecipeConfig(config) ? `__slot: ${upperName}Slot` : ''}
          __type: ${upperName}VariantProps
          (props?: ${upperName}VariantProps): ${
            Recipes.isSlotRecipeConfig(config) ? `Pretty<Record<${upperName}Slot, string>>` : 'string'
          }
          splitVariantProps<Props extends ${upperName}VariantProps>(props: Props): [${upperName}VariantProps, Pretty<DistributiveOmit<Props, keyof ${upperName}VariantProps>>]
        }

        ${ctx.file.jsDocComment(description, { deprecated })}
        export declare const ${baseName}: ${upperName}Recipe
        `,
    }
  })
}
