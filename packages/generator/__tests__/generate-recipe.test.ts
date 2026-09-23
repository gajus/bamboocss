import type { LoadConfigResult } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { Generator } from '../src'
import { generateRecipes } from '../src/artifacts/js/recipe'
import { fixtureDefaults } from '@bamboocss/fixture'

const recipeJs = (config: LoadConfigResult) => {
  const generator = new Generator(config)
  return generateRecipes(generator)
}

describe('generate recipes', () => {
  test('should ', () => {
    expect(recipeJs(fixtureDefaults)).toMatchInlineSnapshot(`
      [
        {
          "dts": "import type { ConditionalValue } from '../types/index';
      import type { DistributiveOmit, Pretty } from '../types/system-types';

      interface TextStyleVariant {
        size: "h1" | "h2"
      }



      export type TextStyleVariantProps = {
        [key in keyof TextStyleVariant]?: ConditionalValue<TextStyleVariant[key]> | undefined
      }

      export interface TextStyleRecipe {
        
        __type: TextStyleVariantProps
        (props?: TextStyleVariantProps): string
        splitVariantProps<Props extends TextStyleVariantProps>(props: Props): [TextStyleVariantProps, Pretty<DistributiveOmit<Props, keyof TextStyleVariantProps>>]
      }


      export declare const textStyle: TextStyleRecipe",
          "js": "import { splitProps, uncompiledStyle } from '../helpers.mjs';

      const textStyleVariantKeys = ["size"]

      export const textStyle = /* @__PURE__ */ Object.assign((_props) => uncompiledStyle("textStyle"), {
        splitVariantProps(props) {
          return splitProps(props, textStyleVariantKeys)
        },
      })",
          "name": "text-style",
        },
        {
          "dts": "import type { ConditionalValue } from '../types/index';
      import type { DistributiveOmit, Pretty } from '../types/system-types';

      interface TooltipStyleVariant {
        
      }



      export type TooltipStyleVariantProps = {
        [key in keyof TooltipStyleVariant]?: ConditionalValue<TooltipStyleVariant[key]> | undefined
      }

      export interface TooltipStyleRecipe {
        
        __type: TooltipStyleVariantProps
        (props?: TooltipStyleVariantProps): string
        splitVariantProps<Props extends TooltipStyleVariantProps>(props: Props): [TooltipStyleVariantProps, Pretty<DistributiveOmit<Props, keyof TooltipStyleVariantProps>>]
      }


      export declare const tooltipStyle: TooltipStyleRecipe",
          "js": "import { splitProps, uncompiledStyle } from '../helpers.mjs';

      const tooltipStyleVariantKeys = []

      export const tooltipStyle = /* @__PURE__ */ Object.assign((_props) => uncompiledStyle("tooltipStyle"), {
        splitVariantProps(props) {
          return splitProps(props, tooltipStyleVariantKeys)
        },
      })",
          "name": "tooltip-style",
        },
        {
          "dts": "import type { ConditionalValue } from '../types/index';
      import type { DistributiveOmit, Pretty } from '../types/system-types';

      interface CardStyleVariant {
        rounded: boolean
      }



      export type CardStyleVariantProps = {
        [key in keyof CardStyleVariant]?: ConditionalValue<CardStyleVariant[key]> | undefined
      }

      export interface CardStyleRecipe {
        
        __type: CardStyleVariantProps
        (props?: CardStyleVariantProps): string
        splitVariantProps<Props extends CardStyleVariantProps>(props: Props): [CardStyleVariantProps, Pretty<DistributiveOmit<Props, keyof CardStyleVariantProps>>]
      }


      export declare const cardStyle: CardStyleRecipe",
          "js": "import { splitProps, uncompiledStyle } from '../helpers.mjs';

      const cardStyleVariantKeys = ["rounded"]

      export const cardStyle = /* @__PURE__ */ Object.assign((_props) => uncompiledStyle("card"), {
        splitVariantProps(props) {
          return splitProps(props, cardStyleVariantKeys)
        },
      })",
          "name": "card-style",
        },
        {
          "dts": "import type { ConditionalValue } from '../types/index';
      import type { DistributiveOmit, Pretty } from '../types/system-types';

      interface ButtonStyleVariant {
        /**
       * @default "md"
       */
      size: "sm" | "md"
      /**
       * @default "solid"
       */
      variant: "solid" | "outline"
      }



      export type ButtonStyleVariantProps = {
        [key in keyof ButtonStyleVariant]?: ConditionalValue<ButtonStyleVariant[key]> | undefined
      }

      export interface ButtonStyleRecipe {
        
        __type: ButtonStyleVariantProps
        (props?: ButtonStyleVariantProps): string
        splitVariantProps<Props extends ButtonStyleVariantProps>(props: Props): [ButtonStyleVariantProps, Pretty<DistributiveOmit<Props, keyof ButtonStyleVariantProps>>]
      }


      export declare const buttonStyle: ButtonStyleRecipe",
          "js": "import { splitProps, uncompiledStyle } from '../helpers.mjs';

      const buttonStyleVariantKeys = ["size","variant"]

      export const buttonStyle = /* @__PURE__ */ Object.assign((_props) => uncompiledStyle("buttonStyle"), {
        splitVariantProps(props) {
          return splitProps(props, buttonStyleVariantKeys)
        },
      })",
          "name": "button-style",
        },
        {
          "dts": "import type { ConditionalValue } from '../types/index';
      import type { DistributiveOmit, Pretty } from '../types/system-types';

      interface CheckboxVariant {
        /**
       * @default "sm"
       */
      size: "sm" | "md" | "lg"
      }

      type CheckboxSlot = "root" | "control" | "label"

      export type CheckboxVariantProps = {
        [key in keyof CheckboxVariant]?: ConditionalValue<CheckboxVariant[key]> | undefined
      }

      export interface CheckboxRecipe {
        __slot: CheckboxSlot
        __type: CheckboxVariantProps
        (props?: CheckboxVariantProps): Pretty<Record<CheckboxSlot, string>>
        splitVariantProps<Props extends CheckboxVariantProps>(props: Props): [CheckboxVariantProps, Pretty<DistributiveOmit<Props, keyof CheckboxVariantProps>>]
      }


      export declare const checkbox: CheckboxRecipe",
          "js": "import { splitProps, uncompiledStyle } from '../helpers.mjs';

      const checkboxVariantKeys = ["size"]

      export const checkbox = /* @__PURE__ */ Object.assign((_props) => uncompiledStyle("checkbox"), {
        splitVariantProps(props) {
          return splitProps(props, checkboxVariantKeys)
        },
      })",
          "name": "checkbox",
        },
        {
          "dts": "import type { ConditionalValue } from '../types/index';
      import type { DistributiveOmit, Pretty } from '../types/system-types';

      interface BadgeVariant {
        size: "sm"
      raised: boolean
      }

      type BadgeSlot = "title" | "body"

      export type BadgeVariantProps = {
        [key in keyof BadgeVariant]?: BadgeVariant[key] | undefined
      }

      export interface BadgeRecipe {
        __slot: BadgeSlot
        __type: BadgeVariantProps
        (props?: BadgeVariantProps): Pretty<Record<BadgeSlot, string>>
        splitVariantProps<Props extends BadgeVariantProps>(props: Props): [BadgeVariantProps, Pretty<DistributiveOmit<Props, keyof BadgeVariantProps>>]
      }


      export declare const badge: BadgeRecipe",
          "js": "import { splitProps, uncompiledStyle } from '../helpers.mjs';

      const badgeVariantKeys = ["size","raised"]

      export const badge = /* @__PURE__ */ Object.assign((_props) => uncompiledStyle("badge"), {
        splitVariantProps(props) {
          return splitProps(props, badgeVariantKeys)
        },
      })",
          "name": "badge",
        },
      ]
    `)
  })
})
