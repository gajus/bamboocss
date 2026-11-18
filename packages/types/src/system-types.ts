import type { ConditionalValue, Nested } from './conditions'
import type { AtRule, Globals, Properties } from './csstype'
import type { SystemProperties, CssVarProperties } from './style-props'

type String = string & {}
type Number = number & {}

export type Pretty<T> = { [K in keyof T]: T[K] } & {}

export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

export type DistributiveUnion<T, U> = {
  [K in keyof T]: K extends keyof U ? U[K] | T[K] : T[K]
} & DistributiveOmit<U, keyof T>

export type Assign<T, U> = {
  [K in keyof T]: K extends keyof U ? U[K] : T[K]
} & U

/* -----------------------------------------------------------------------------
 * Native css properties
 * -----------------------------------------------------------------------------*/

type CornerShapeValue =
  | 'round'
  | 'square'
  | 'bevel'
  | 'scoop'
  | 'notch'
  | 'squircle'
  | `superellipse(${number | 'infinity' | '-infinity'})`
type CornerShape = Globals | CornerShapeValue | String
type CornerShapePair = CornerShape | `${CornerShapeValue} ${CornerShapeValue}`

export interface ModernCssProperties {
  /**
   * Controls whether the entire element should be draggable instead of its contents.
   */
  WebkitUserDrag?: Globals | 'auto' | 'element' | 'none' | undefined

  /**
   * Specifies whether an element can be used to drag the entire app window (Electron).
   */
  WebkitAppRegion?: Globals | 'drag' | 'no-drag' | undefined

  /**
   * Sets the horizontal spacing between table borders.
   */
  WebkitBorderHorizontalSpacing?: Globals | String | Number | undefined

  /**
   * Sets the vertical spacing between table borders.
   */
  WebkitBorderVerticalSpacing?: Globals | String | Number | undefined

  /**
   * Controls the display of text content for security purposes (e.g., password fields).
   */
  WebkitTextSecurity?: Globals | 'none' | 'circle' | 'disc' | 'square' | undefined

  /** Chooses which baseline an inline box exposes for alignment. */
  baselineSource?: Globals | 'auto' | 'first' | 'last' | String | undefined

  /** Limits the peak luminance of HDR content. */
  dynamicRangeLimit?:
    | Globals
    | 'standard'
    | 'constrained'
    | 'no-limit'
    | `dynamic-range-limit-mix(${string})`
    | String
    | undefined

  /**
   * Specifies the shape of a box's corners within the area defined by the border-radius property.
   * @experimental
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/corner-shape
   */
  cornerShape?:
    | CornerShapePair
    | `${CornerShapeValue} ${CornerShapeValue} ${CornerShapeValue}`
    | `${CornerShapeValue} ${CornerShapeValue} ${CornerShapeValue} ${CornerShapeValue}`
    | undefined

  cornerTopLeftShape?: CornerShape | undefined
  cornerTopRightShape?: CornerShape | undefined
  cornerBottomLeftShape?: CornerShape | undefined
  cornerBottomRightShape?: CornerShape | undefined
  cornerStartStartShape?: CornerShape | undefined
  cornerStartEndShape?: CornerShape | undefined
  cornerEndStartShape?: CornerShape | undefined
  cornerEndEndShape?: CornerShape | undefined

  cornerTopShape?: CornerShapePair | undefined
  cornerRightShape?: CornerShapePair | undefined
  cornerBottomShape?: CornerShapePair | undefined
  cornerLeftShape?: CornerShapePair | undefined
  cornerBlockStartShape?: CornerShapePair | undefined
  cornerBlockEndShape?: CornerShapePair | undefined
  cornerInlineStartShape?: CornerShapePair | undefined
  cornerInlineEndShape?: CornerShapePair | undefined
}

export type CssProperty = keyof Properties | keyof ModernCssProperties

export interface CssProperties extends Properties<String | Number>, CssVarProperties, ModernCssProperties {}

export interface CssKeyframes {
  [name: string]: {
    [time: string]: CssProperties
  }
}

/* -----------------------------------------------------------------------------
 * Conditional css properties
 * -----------------------------------------------------------------------------*/

interface GenericProperties {
  [key: string]: ConditionalValue<String | Number | boolean>
}

/* -----------------------------------------------------------------------------
 * Native css props
 * -----------------------------------------------------------------------------*/

export type NestedCssProperties = Nested<CssProperties>

export type SystemStyleObject = Nested<(SystemProperties | GenericProperties) & CssVarProperties>

/**
 * A style object with these properties alone, in every condition and selector too: what a component
 * takes when it lets its caller style part of it. `SystemStyleObjectWith<'width' | 'margin'>` takes
 * those two; a shorthand, `mt`, is a property of its own and listed as one. It is a
 * `SystemStyleObject`, so it goes into `css()` as one.
 */
export type SystemStyleObjectWith<K extends keyof SystemProperties> = Omit<Nested<Pick<SystemProperties, K>>, 'base'>

/** A style object with every property but these, in every condition and selector too. @see SystemStyleObjectWith */
export type SystemStyleObjectWithout<K extends keyof SystemProperties> = Omit<Nested<Omit<SystemProperties, K>>, 'base'>

/**
 * The four `::view-transition-*` pseudo-elements a `viewTransition()` bag can style.
 *
 * `imagePair` is camelCase here and emitted as `::view-transition-image-pair`, matching
 * how every other property in a style object is authored.
 */
export interface ViewTransitionStyleObject {
  group?: SystemStyleObject | undefined
  imagePair?: SystemStyleObject | undefined
  old?: SystemStyleObject | undefined
  new?: SystemStyleObject | undefined
}

export type ViewTransitionFn = (options: ViewTransitionStyleObject) => string

/**
 * The stops of one `@keyframes` block: `from`, `to` or a percentage, each the declarations at that
 * point, as a theme keyframe takes them.
 */
export interface KeyframeStops {
  [stop: string]: CssProperties
}

export type KeyframesFn = (stops: KeyframeStops) => string

export interface GlobalStyleObject {
  [selector: string]: SystemStyleObject
}
export interface ExtendableGlobalStyleObject {
  [selector: string]: SystemStyleObject | undefined
  extend?: GlobalStyleObject | undefined
}

/* -----------------------------------------------------------------------------
 * Composition (text styles, layer styles)
 * -----------------------------------------------------------------------------*/

type FilterStyleObject<P extends string> = {
  [K in P]?: (K extends keyof SystemStyleObject ? SystemStyleObject[K] : unknown) | undefined
}

export type CompositionStyleObject<Property extends string> = Nested<FilterStyleObject<Property> & CssVarProperties>

/* -----------------------------------------------------------------------------
 * Font face
 * -----------------------------------------------------------------------------*/

export type GlobalFontfaceRule = Omit<AtRule.FontFaceFallback, 'src'> & Required<Pick<AtRule.FontFaceFallback, 'src'>>

export type FontfaceRule = Omit<GlobalFontfaceRule, 'fontFamily'>

export interface GlobalFontface {
  [name: string]: FontfaceRule | FontfaceRule[]
}

export interface ExtendableGlobalFontface {
  [name: string]: FontfaceRule | FontfaceRule[] | GlobalFontface | undefined
  extend?: GlobalFontface | undefined
}

/* -----------------------------------------------------------------------------
 * Jsx style props
 * -----------------------------------------------------------------------------*/
interface WithCss {
  css?: SystemStyleObject | SystemStyleObject[] | undefined
}

export type JsxStyleProps = SystemStyleObject & WithCss

export interface PatchedHTMLProps {
  htmlWidth?: string | number | undefined
  htmlHeight?: string | number | undefined
  htmlTranslate?: 'yes' | 'no' | undefined
  htmlContent?: string | undefined
}

export type OmittedHTMLProps = 'color' | 'translate' | 'transition' | 'width' | 'height' | 'content'

type WithHTMLProps<T> = DistributiveOmit<T, OmittedHTMLProps> & PatchedHTMLProps

export type JsxHTMLProps<T extends Record<string, any>, P extends Record<string, any> = {}> = Assign<
  WithHTMLProps<T>,
  P
>
