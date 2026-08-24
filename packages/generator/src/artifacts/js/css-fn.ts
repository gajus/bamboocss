import type { Context } from '@bamboocss/core'
import { outdent } from 'outdent'

export function generateCssFn(ctx: Context) {
  return {
    dts: outdent`
    ${ctx.file.importType('SystemStyleObject, ViewTransitionFn', '../types/index')}

    type Styles = SystemStyleObject | undefined | null | false

    interface CssFunction {
      /** Spread a list you built — \`css(...styles)\`. An array argument is an error. */
      (...styles: Styles[]): string

      raw: (...styles: Styles[]) => SystemStyleObject
    }

    export declare const css: CssFunction;

    /**
     * Build a fallback value: a list of candidates, most-preferred first, emitted as repeated
     * declarations so the browser keeps the last one it understands.
     *
     * Sugar for the string form — \`fallback('100dvh', '100vh')\` is \`'fallback(100dvh, 100vh)'\`.
     * The candidates are not individually type-checked, the same trade the \`[...]\` escape
     * hatch makes.
     *
     * @example
     * css({ height: fallback('calc(100dvh - 100px)', 'calc(100vh - 100px)') })
     *
     * @see https://bamboocss.com/docs/concepts/writing-styles#fallback-values
     */
    export declare function fallback(preferred: string | number, ...rest: Array<string | number>): \`fallback(\${string})\`;

    /**
     * Style the View Transitions API and get back one stable class for the bag.
     *
     * The class is applied through \`view-transition-class\`, so the same transition can be
     * shared by any number of elements. You still set \`view-transition-name\` yourself —
     * it has to be unique per element, so bamboo cannot share it for you.
     *
     * @example
     * const slide = viewTransition({
     *   group: { animationDuration: '0.4s' },
     *   old: { animationName: 'slide-out' },
     *   new: { animationName: 'slide-in' },
     * })
     *
     * @see https://bamboocss.com/docs/concepts/view-transitions
     */
    export declare const viewTransition: ViewTransitionFn;

    `,
    js: outdent`
    ${ctx.file.import('cloneStyles, uncompiledStyle', '../helpers')}
    ${ctx.file.import('mergeCss', './merge-css')}

    export const css = (..._styles) => uncompiledStyle('css')
    // \`raw\` is a style object, not a class string. The compiler leaves it; \`css(css.raw(...))\`
    // is what has to fold.
    css.raw = (...styles) => cloneStyles(mergeCss(...styles))

    // Sugar for the string form, so the feature has an import to discover, a signature to
    // hover and a name the editor can complete. The extractor evaluates the call, so the
    // value reaching \`css()\` is the same literal either way.
    export const fallback = (...values) => \`fallback($\{values.join(', ')})\`

    export const viewTransition = (_options) => uncompiledStyle('viewTransition')

`,
  }
}
