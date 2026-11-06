import { describe, expect, test } from 'vitest'
import bamboo from '../src'
import { recommendedRules } from '../src/configs/recommended'
import rule, { RULE_NAME } from '../src/rules/no-overridden-by-mixin'
import { eslintTester } from '../test-utils'

/**
 * Deprecated. A mixin is the base of the style it is applied in, so a property written before it
 * that it sets too is the one that applies, and the rule has nothing left to report. It stays so
 * that a config naming it still loads.
 */
eslintTester.run(RULE_NAME, rule, {
  valid: [
    // What it reported: the property is the one that applies now.
    { code: `import { css } from './bamboo/css';\n\nconst a = css({ fontWeight: 'light', mixin: 'headline.h1' })` },
  ],
  invalid: [],
})

describe(RULE_NAME, () => {
  test('is deprecated, and in no config', () => {
    expect(rule.meta.deprecated).toBe(true)
    expect(Object.keys(recommendedRules)).not.toContain(`bamboo/${RULE_NAME}`)
    expect(Object.keys(bamboo.configs['flat/all'].rules ?? {})).not.toContain(`bamboo/${RULE_NAME}`)
  })
})
