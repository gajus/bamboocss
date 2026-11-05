import rule, { RULE_NAME } from '../src/rules/no-hardcoded-color'
import { eslintTester } from '../test-utils'
import { type RuleContext, type RuleModule } from '@typescript-eslint/utils/ts-eslint'
import multiline from 'multiline-ts'

/**
 * One rule context for every file, as oxlint hands it to a JS plugin.
 *
 * ESLint creates a context per rule per file. oxlint creates one per rule and passes that object to
 * `create` for every file, its properties reading whichever file is being linted. A cache keyed by
 * the context holds the first file's answer for every file after it, and the plugin's imports were
 * cached that way: `no-hardcoded-color` found 29 colors in one directory, none in its parent and
 * 231 in the whole app, depending on which file it happened to read first.
 *
 * `RuleTester` lints its cases one after another in one process, valid ones first, so a rule given
 * the same context for each of them is linted the way oxlint lints a project.
 */
const reusingContext = <M extends string, O extends readonly unknown[]>(inner: RuleModule<M, O>): RuleModule<M, O> => {
  let current: RuleContext<M, O> | undefined
  const shared = new Proxy({} as RuleContext<M, O>, {
    get: (_target, key) => {
      const value = Reflect.get(current!, key)
      return typeof value === 'function' ? value.bind(current) : value
    },
  })
  return {
    ...inner,
    create(context) {
      current = context
      return inner.create(shared)
    },
  }
}

const bambooColor = multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: '#ef4444' })`

const localColor = multiline`
  const css = (styles: object) => styles;

  const styles = css({ color: '#ef4444' })`

// Linted first, a file importing nothing from bamboo left the context holding no imports, and the
// bamboo file after it went unread.
eslintTester.run(RULE_NAME, reusingContext(rule), {
  valid: [{ code: localColor }],
  invalid: [{ code: bambooColor, errors: [{ messageId: 'invalidColor', data: { color: '#ef4444' } }] }],
})

// Linted first, a bamboo file left the context holding its imports, and a file with a `css` of its
// own was read as bamboo's.
eslintTester.run(RULE_NAME, reusingContext(rule), {
  valid: [
    {
      code: multiline`
        import { css } from './bamboo/css';

        const styles = css({ color: 'red.100' })`,
    },
    { code: localColor },
  ],
  invalid: [],
})
