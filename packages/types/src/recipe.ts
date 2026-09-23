import type { RecipeRule } from './static-css'
import type { SystemStyleObject, DistributiveOmit, Pretty } from './system-types'

type StringToBoolean<T> = T extends 'true' | 'false' ? boolean : T

export type RecipeVariantRecord = Record<any, Record<any, SystemStyleObject>>

export type RecipeSelection<T extends RecipeVariantRecord> = keyof any extends keyof T
  ? {}
  : {
      [K in keyof T]?: StringToBoolean<keyof T[K]> | undefined
    }

export type RecipeVariantFn<T extends RecipeVariantRecord> = (props?: RecipeSelection<T>) => string

/**
 * Extract the variant as optional props from a `cva` function.
 * Intended to be used with a JSX component, prefer `RecipeVariant` for a more strict type.
 */
export type RecipeVariantProps<
  T extends RecipeVariantFn<RecipeVariantRecord> | SlotRecipeVariantFn<string, SlotRecipeVariantRecord<string>>,
> = Pretty<Parameters<T>[0]>

/**
 * Extract the variants from a `cva` function.
 */
export type RecipeVariant<
  T extends RecipeVariantFn<RecipeVariantRecord> | SlotRecipeVariantFn<string, SlotRecipeVariantRecord<string>>,
> = Exclude<Pretty<Required<RecipeVariantProps<T>>>, undefined>

/* -----------------------------------------------------------------------------
 * Recipe / Standard
 * -----------------------------------------------------------------------------*/

/**
 * What a compiled build lets you do with a recipe: call it, or split its variant props.
 *
 * Nothing else is declared, because nothing else compiles. The compiler rewrites a call into
 * the classes it selects and erases the recipe, so any other read of the binding — `raw`,
 * `variantMap`, `config`, `merge`, `getVariantProps` — would see a value that is no longer
 * there, and fails the build with `runtime-binding` or `raw-call`. Declaring them only let
 * that failure type-check.
 */
export interface RecipeRuntimeFn<T extends RecipeVariantRecord> extends RecipeVariantFn<T> {
  __type: RecipeSelection<T>
  splitVariantProps<Props extends RecipeSelection<T>>(
    props: Props,
  ): [RecipeSelection<T>, Pretty<DistributiveOmit<Props, keyof T>>]
}

type OneOrMore<T> = T | Array<T>

export type RecipeCompoundSelection<T> = {
  [K in keyof T]?: OneOrMore<StringToBoolean<keyof T[K]>> | undefined
}

export type RecipeCompoundVariant<T> = T & {
  css: SystemStyleObject
}

export interface RecipeDefinition<T extends RecipeVariantRecord = RecipeVariantRecord> {
  /**
   * The base styles of the recipe.
   */
  base?: SystemStyleObject
  /**
   * Semantic recipe name used by extraction-only integrations.
   *
   * Required for a recipe declared in `theme.recipes`, where it is the key it is declared
   * under. Optional for an inline `cva`.
   *
   * The Vite compiler ignores this field when allocating declaration atoms: recipe identity
   * is not style identity, so identical declarations share one class across recipes.
   */
  className?: string
  /**
   * Whether the recipe is deprecated.
   */
  deprecated?: boolean | string
  /**
   * The multi-variant styles of the recipe.
   */
  variants?: T
  /**
   * The default variants of the recipe.
   */
  defaultVariants?: RecipeSelection<T>
  /**
   * The styles to apply when a combination of variants is selected.
   */
  compoundVariants?: Pretty<RecipeCompoundVariant<RecipeCompoundSelection<T>>>[]
}

export type RecipeCreatorFn = <T extends RecipeVariantRecord>(config: RecipeDefinition<T>) => RecipeRuntimeFn<T>

interface RecipeConfigMeta {
  /**
   * The description of the recipe. This will be used in the JSDoc comment.
   */
  description?: string
  /**
   * The jsx elements to track for this recipe. Can be string or Regexp.
   *
   * @default capitalize(recipe.name)
   * @example ['Button', 'Link', /Button$/]
   */
  jsx?: Array<string | RegExp>
  /**
   * Variants to pre-generate, will be include in the final `config.staticCss`
   */
  staticCss?: RecipeRule[]
}

export interface RecipeConfig<T extends RecipeVariantRecord = RecipeVariantRecord>
  extends RecipeDefinition<T>, RecipeConfigMeta {
  /**
   * Required extraction metadata for a configured recipe: the key under which it is
   * declared in `theme.recipes`. The Vite compiler does not use it as style identity.
   */
  className: string
}

/* -----------------------------------------------------------------------------
 * Recipe / Slot
 * -----------------------------------------------------------------------------*/

type SlotRecord<S extends string, T> = Partial<Record<S, T>>

export type SlotRecipeVariantRecord<S extends string> = Record<any, Record<any, SlotRecord<S, SystemStyleObject>>>

export type SlotRecipeVariantFn<S extends string, T extends RecipeVariantRecord> = (
  props?: RecipeSelection<T>,
) => SlotRecord<S, string>

/**
 * A slot recipe as a compiled build allows it: call it, or split its variant props. See
 * `RecipeRuntimeFn` for why nothing else is declared.
 */
export interface SlotRecipeRuntimeFn<
  S extends string,
  T extends SlotRecipeVariantRecord<S>,
> extends SlotRecipeVariantFn<S, T> {
  splitVariantProps<Props extends RecipeSelection<T>>(
    props: Props,
  ): [RecipeSelection<T>, Pretty<DistributiveOmit<Props, keyof T>>]
}

export type SlotRecipeCompoundVariant<S extends string, T> = T & {
  css: SlotRecord<S, SystemStyleObject>
}

export interface SlotRecipeDefinition<
  S extends string = string,
  T extends SlotRecipeVariantRecord<S> = SlotRecipeVariantRecord<S>,
> {
  /**
   * Semantic recipe name used by extraction-only integrations.
   *
   * Required for a recipe declared in `theme.slotRecipes`, where it is the key it is
   * declared under. Optional for an inline `sva`.
   *
   * The Vite compiler ignores this field when allocating declaration atoms: recipe and slot
   * identity do not enter generated class names.
   */
  className?: string
  /**
   * Whether the recipe is deprecated.
   */
  deprecated?: boolean | string
  /**
   * The parts/slots of the recipe.
   */
  slots: S[] | Readonly<S[]>
  /**
   * Accepted and ignored.
   *
   * Older extraction-only releases scoped a slot's variant styles with `@scope` rules anchored
   * at the slots named here. The Vite compiler returns complete atoms for every selected slot
   * and emits no `@scope`, so this has no effect on output; it is still accepted so existing
   * configs keep loading.
   *
   * @deprecated Has no effect on compiled output.
   */
  scopeRoots?: S[] | Readonly<S[]>
  /**
   * The base styles of the recipe.
   */
  base?: SlotRecord<S, SystemStyleObject>
  /**
   * The multi-variant styles of the recipe.
   */
  variants?: T
  /**
   * The default variants of the recipe.
   */
  defaultVariants?: RecipeSelection<T>
  /**
   * The styles to apply when a combination of variants is selected.
   */
  compoundVariants?: Pretty<SlotRecipeCompoundVariant<S, RecipeCompoundSelection<T>>>[]
}

export type SlotRecipeCreatorFn = <S extends string, T extends SlotRecipeVariantRecord<S>>(
  config: SlotRecipeDefinition<S, T>,
) => SlotRecipeRuntimeFn<S, T>

export type SlotRecipeConfig<
  S extends string = string,
  T extends SlotRecipeVariantRecord<S> = SlotRecipeVariantRecord<S>,
> = SlotRecipeDefinition<S, T> &
  RecipeConfigMeta & {
    /**
     * Required extraction metadata for a configured recipe: the key under which it is
     * declared in `theme.slotRecipes`. The Vite compiler does not use it as style identity.
     */
    className: string
  }
