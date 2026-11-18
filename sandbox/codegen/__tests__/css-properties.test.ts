import { expect, test } from 'vitest'
import { css } from '../styled-system/css'

/**
 * Enforced by `pnpm codegen typecheck`: an unused `@ts-expect-error` is itself an error.
 *
 * `SystemProperties` takes its members from the css properties mdn-data lists. The list was
 * generated from an older mdn-data than the one installed, so `textAutospace` and `objectViewBox`
 * were TS2353 here though csstype typed both.
 */
test('takes the css properties mdn-data lists, whether csstype types them yet or not', () => {
  const styles = css.raw({
    textAutospace: 'normal',
    objectViewBox: 'none',
    fontWidth: '75%',
    speakAs: 'spell-out',
    viewTransitionClass: 'card',
    // Not in csstype yet, so any value; the build's grammar check judges it.
    readingFlow: 'grid-rows',
  })

  expect(styles).toEqual({
    textAutospace: 'normal',
    objectViewBox: 'none',
    fontWidth: '75%',
    speakAs: 'spell-out',
    viewTransitionClass: 'card',
    readingFlow: 'grid-rows',
  })
})

test('types baseline, HDR and corner shape values in generated styles', () => {
  const styles = {
    baselineSource: 'last',
    dynamicRangeLimit: 'dynamic-range-limit-mix(standard 60%, no-limit 40%)',
    cornerShape: 'round bevel round bevel',
    cornerTopLeftShape: 'squircle',
    cornerEndStartShape: 'superellipse(-infinity)',
    cornerBlockEndShape: 'round scoop',
  }
  expect(css.raw(styles)).toEqual(styles)

  // @ts-expect-error baseline-source takes a keyword or string expression
  expect(css.raw({ baselineSource: 2 })).toEqual({ baselineSource: 2 })
  // @ts-expect-error dynamic-range-limit takes a keyword or string expression
  expect(css.raw({ dynamicRangeLimit: 2 })).toEqual({ dynamicRangeLimit: 2 })
  // @ts-expect-error corner-top-left-shape takes a keyword or string expression
  expect(css.raw({ cornerTopLeftShape: 2 })).toEqual({ cornerTopLeftShape: 2 })
})

test('still checks the value of one csstype types', () => {
  // @ts-expect-error `textAutospace` takes keywords, not a number
  expect(css.raw({ textAutospace: 1 })).toEqual({ textAutospace: 1 })
})
