import dynamic, { RULE_NAME as DYNAMIC } from '../src/rules/no-dynamic-styling'
import renaming, { RULE_NAME as RENAMING } from '../src/rules/no-property-renaming'
import recipeName, { RULE_NAME as RECIPE_NAME } from '../src/rules/require-recipe-class-name'
import { eslintTester } from '../test-utils'

/**
 * A name `keyframes()` returns, read by a style.
 *
 * The build evaluates the call and writes the name in its place, so `css({ animationName: fadeIn })`
 * is as static as the name written out. The rules took the binding for a runtime value: a dynamic
 * style, a renamed prop, and a recipe config the build might not read.
 */
const file = (body: string, imports = `import { css, cva, keyframes } from './bamboo/css';`) =>
  [imports, `const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })`, body].join('\n')

/** The same file, with a `fadeIn` that is not a keyframes name. */
const notKeyframes = (body: string) =>
  [`import { css, cva } from './bamboo/css';`, `const fadeIn = makeName()`, body].join('\n')

eslintTester.run(DYNAMIC, dynamic, {
  valid: [
    { code: file('const a = css({ animation: `${fadeIn} 0.2s ease-out` })') },
    { code: file('const a = css({ animationName: fadeIn })') },
    { code: file('const a = css({ animationName: keyframes({ from: { opacity: 0 } }) })') },
    {
      code: file(
        'const a = css({ animationName: fadeIn })',
        `import { css, keyframes as kf } from './bamboo/css';`,
      ).replace('= keyframes(', '= kf('),
    },
  ],
  invalid: [
    // Somebody else's `keyframes`, which the build does not evaluate.
    {
      code: file(
        'const a = css({ animationName: fadeIn })',
        `import { css } from './bamboo/css';\nimport { keyframes } from 'other-lib';`,
      ),
      errors: [{ messageId: 'dynamic' }],
    },
    { code: notKeyframes('const a = css({ animationName: fadeIn })'), errors: [{ messageId: 'dynamic' }] },
    {
      code: file('const duration = getDuration()\nconst a = css({ animation: `${fadeIn} ${duration}` })'),
      errors: [{ messageId: 'dynamic' }],
    },
  ],
})

eslintTester.run(RENAMING, renaming, {
  valid: [{ code: file('const a = css({ animationName: fadeIn })') }],
  invalid: [{ code: notKeyframes('const a = css({ animationName: fadeIn })'), errors: [{ messageId: 'noRenaming' }] }],
})

eslintTester.run(RECIPE_NAME, recipeName, {
  valid: [
    { code: file('const r = cva({ base: { animationName: fadeIn } })'), options: [{ mode: 'dynamic-only' }] },
    { code: file('const r = cva({ base: { animation: `${fadeIn} 0.2s` } })'), options: [{ mode: 'dynamic-only' }] },
  ],
  invalid: [
    {
      code: notKeyframes('const r = cva({ base: { animationName: fadeIn } })'),
      options: [{ mode: 'dynamic-only' }],
      errors: [{ messageId: 'requireRecipeClassName' }],
    },
  ],
})
