import {
  BambooPlugin,
  CompositionStyles,
  Config,
  CssKeyframes,
  GlobalFontface,
  GlobalStyleObject,
  HooksApiInterface,
  Mixins,
  PatternConfig,
  PatternProperties,
  Preset,
  PropertyConfig,
  RecipeConfig,
  RecipeVariantRecord,
  SemanticTokens,
  SlotRecipeConfig,
  SlotRecipeVariantRecord,
  SystemStyleObject,
  ThemeVariant,
  Tokens,
} from '@bamboocss/types'

//#region src/index.d.ts
declare function defineConfig(config: Config): Config & {
  name: string
}
declare function defineRecipe<T extends RecipeVariantRecord>(config: RecipeConfig<T>): RecipeConfig
declare function defineSlotRecipe<S extends string, T extends SlotRecipeVariantRecord<S>>(
  config: SlotRecipeConfig<S, T>,
): SlotRecipeConfig
declare function definePattern<T extends PatternConfig>(config: T): PatternConfig
declare function definePreset(preset: Preset): Preset
declare function defineKeyframes(keyframes: CssKeyframes): CssKeyframes
declare function defineGlobalStyles(definition: GlobalStyleObject): GlobalStyleObject
declare function defineGlobalFontface(definition: GlobalFontface): GlobalFontface
declare function defineUtility(utility: PropertyConfig): PropertyConfig
declare function definePlugin(plugin: BambooPlugin): BambooPlugin
declare function defineThemeVariant<T extends ThemeVariant>(theme: T): T
declare function defineThemeContract<C extends Partial<Omit<ThemeVariant, 'selector'>>>(
  _contract: C,
): <T extends C & ThemeVariant>(theme: T) => T
type ProxyValue<T> = {
  <Value>(definition: Value extends T ? Value : T): Value
} & { [K in keyof Required<T>]: <Value>(definition: Value extends T[K] ? Value : T[K]) => Value }
declare const defineTokens: ProxyValue<Tokens>
declare const defineSemanticTokens: ProxyValue<SemanticTokens>
declare function defineMixins(definition: CompositionStyles['mixins']): Mixins
declare function defineStyles(definition: SystemStyleObject): SystemStyleObject
//#endregion
export {
  type CompositionStyles,
  type Config,
  type CssKeyframes,
  type GlobalStyleObject,
  type HooksApiInterface,
  type Mixins,
  type PatternConfig,
  type PatternProperties,
  type Preset,
  type PropertyConfig,
  type RecipeConfig,
  type RecipeVariantRecord,
  type SemanticTokens,
  type SlotRecipeConfig,
  type SlotRecipeVariantRecord,
  type SystemStyleObject,
  type Tokens,
  defineConfig,
  defineGlobalFontface,
  defineGlobalStyles,
  defineKeyframes,
  defineMixins,
  definePattern,
  definePlugin,
  definePreset,
  defineRecipe,
  defineSemanticTokens,
  defineSlotRecipe,
  defineStyles,
  defineThemeContract,
  defineThemeVariant,
  defineTokens,
  defineUtility,
}
