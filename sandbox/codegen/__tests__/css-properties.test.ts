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
    cornerTopLeftShape: 'squircle',
  })

  expect(styles).toEqual({
    textAutospace: 'normal',
    objectViewBox: 'none',
    fontWidth: '75%',
    speakAs: 'spell-out',
    viewTransitionClass: 'card',
    readingFlow: 'grid-rows',
    cornerTopLeftShape: 'squircle',
  })
})

test('still checks the value of one csstype types', () => {
  // @ts-expect-error `textAutospace` takes keywords, not a number
  expect(css.raw({ textAutospace: 1 })).toEqual({ textAutospace: 1 })
})
