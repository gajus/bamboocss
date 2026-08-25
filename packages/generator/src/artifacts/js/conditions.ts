import type { Context } from '@bamboocss/core'
import type { ConditionQuery } from '@bamboocss/types'
import outdent from 'outdent'

function formatConditionJsDoc(raw: ConditionQuery | undefined): string {
  if (!raw) return ''
  if (typeof raw === 'string') return `/** \`${raw}\` */\n`
  if (Array.isArray(raw)) return `/** \`${raw.join(' ')}\` */\n`
  // Object condition (multi-block) - display a compact representation
  return `/** Multi-block condition */\n`
}

export function generateConditions(ctx: Context) {
  const keys = Object.keys(ctx.conditions.values).concat('base')
  return {
    dts: outdent`
    ${ctx.file.importType('AnySelector, Selectors', './selectors')}

    export interface Conditions {
    ${keys
      .map(
        (key) =>
          `\t${
            key === 'base'
              ? `/** The base (=no conditions) styles to apply  */\n`
              : formatConditionJsDoc(ctx.conditions.get(key))
          }\t${JSON.stringify(key)}: string`,
      )
      .join('\n')}
    }

    export type ConditionalValue<V> =
      | V
      | Array<V | null>
      | {
          [K in keyof Conditions]?: ConditionalValue<V>
        }

    export type Nested<P> = P & {
      [K in Selectors]?: Nested<P>
    } & {
      [K in AnySelector]?: Nested<P>
    } & {
      [K in keyof Conditions]?: Nested<P>
    }

  `,
  }
}
