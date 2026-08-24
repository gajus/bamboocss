import { createContext, createGeneratorContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { generateCssFn } from '../src/artifacts/js/css-fn'

describe('generate css-fn', () => {
  test('basic', () => {
    expect(generateCssFn(createContext())).toMatchInlineSnapshot(`
      {
        "dts": "import type { SystemStyleObject, ViewTransitionFn } from '../types/index';

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
      ",
        "js": "import { cloneStyles, uncompiledStyle } from '../helpers.mjs';
      import { mergeCss } from './merge-css.mjs';

      export const css = (..._styles) => uncompiledStyle('css')
      // \`raw\` is a style object, not a class string. The compiler leaves it; \`css(css.raw(...))\`
      // is what has to fold.
      css.raw = (...styles) => cloneStyles(mergeCss(...styles))

      // Sugar for the string form, so the feature has an import to discover, a signature to
      // hover and a name the editor can complete. The extractor evaluates the call, so the
      // value reaching \`css()\` is the same literal either way.
      export const fallback = (...values) => \`fallback(\${values.join(', ')})\`

      export const viewTransition = (_options) => uncompiledStyle('viewTransition')
      ",
      }
    `)
  })

  test('basic', () => {
    expect(
      generateCssFn(
        createContext({
          plugins: [
            {
              name: 'test',
              hooks: {
                'utility:created': ({ configure }) => {
                  configure({
                    toHash(paths, toHash) {
                      const stringConds = paths.join(':')
                      const splitConds = stringConds.split('_')
                      const hashConds = splitConds.map(toHash)
                      return hashConds.join('_')
                    },
                  })
                },
              },
            },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      {
        "dts": "import type { SystemStyleObject, ViewTransitionFn } from '../types/index';

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
      ",
        "js": "import { cloneStyles, uncompiledStyle } from '../helpers.mjs';
      import { mergeCss } from './merge-css.mjs';

      export const css = (..._styles) => uncompiledStyle('css')
      // \`raw\` is a style object, not a class string. The compiler leaves it; \`css(css.raw(...))\`
      // is what has to fold.
      css.raw = (...styles) => cloneStyles(mergeCss(...styles))

      // Sugar for the string form, so the feature has an import to discover, a signature to
      // hover and a name the editor can complete. The extractor evaluates the call, so the
      // value reaching \`css()\` is the same literal either way.
      export const fallback = (...values) => \`fallback(\${values.join(', ')})\`

      export const viewTransition = (_options) => uncompiledStyle('viewTransition')
      ",
      }
    `)
  })
})

describe('generate css-fn — the recipe seam', () => {
  /**
   * There is no longer a seam to keep.
   *
   * Recipes used to be extracted atomically while `css()` calls were grouped, because which
   * variant combination a caller selects is not knowable at build time and grouping would
   * have needed a rule per combination. That forced a second `createCss`, exported as
   * `__atomicCss`, purely so the recipe runtimes could name classes the way the stylesheet
   * did.
   *
   * A recipe now names its classes semantically — `btn--size_sm`, from the config — which is
   * knowable at build time. So no second instance.
   */
  test('no second css instance', () => {
    const js = generateCssFn(createGeneratorContext({}) as any).js
    expect(js).not.toContain('__atomicCss')
    expect(js).not.toContain('grouped: false')
  })

  test('does not emit a runtime leaf fallback', () => {
    const generated = generateCssFn(createGeneratorContext({}) as any)
    expect(generated.js).not.toContain('cssLeaf')
    expect(generated.dts).not.toContain('cssLeaf')
  })
})
