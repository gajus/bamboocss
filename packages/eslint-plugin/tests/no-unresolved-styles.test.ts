import tsParser from '@typescript-eslint/parser'
import { Linter } from 'eslint'
import multiline from 'multiline-ts'
import { expect, test, vi } from 'vitest'
import bamboo from '../src'
import rule, { RULE_NAME } from '../src/rules/no-unresolved-styles'
import { eslintTester } from '../test-utils'

/**
 * The build's own warnings, where they are written: each a style whose declarations the build
 * could not read and that never reaches the stylesheet, in the words the build prints.
 */
const css = {
  fix:
    'Write the value out, or choose between values written out with a ternary. One known only at runtime belongs ' +
    "in the `style` attribute, or in a CSS variable a declaration reads, `width: 'var(--width)'`.",
  what: '`color` will not reach the stylesheet because its value could not be evaluated at build time',
}
const spreadFix = 'Write the properties out, or spread an object the build can read.'
const spread = 'an object spread or computed key leaves the build unable to tell which properties this call sets'
const dynamic = multiline`
  import { css } from './bamboo/css';

  export const styles = (tone: string) => css({ color: tone })`

eslintTester.run(RULE_NAME, rule, {
  invalid: [
    {
      code: dynamic,
      errors: [{ column: 41, data: css, line: 3, messageId: 'unresolved' }],
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  export const styles = (props: object) => css({ ...props })`,
      errors: [
        {
          column: 42,
          data: { fix: spreadFix, what: spread },
          line: 3,
          messageId: 'unresolved',
        },
      ],
    },
    // A whole argument the build cannot read, which reached the stylesheet as nothing at all and
    // said nothing either.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const pads = { sm: { px: '2' }, lg: { px: '6' } }
  export const styles = (size: 'sm' | 'lg') => css(pads[size])`,
      errors: [
        {
          column: 46,
          data: {
            fix: css.fix,
            what: 'this argument will not reach the stylesheet because it is not statically known',
          },
          line: 4,
          messageId: 'unresolved',
        },
      ],
    },
    // A recipe's calls compile without what its config does not let the build read. Each loss
    // names its path, or two in one call would read the same.
    {
      code: multiline`
  import { cva } from './bamboo/css';

  export const card = (x: object, y: object) => cva({ base: { ...x }, variants: { tone: { calm: { ...y } } } })`,
      errors: [
        { column: 47, data: { fix: spreadFix, what: `${spread} at \`base\`` }, line: 3, messageId: 'unresolved' },
        {
          column: 47,
          data: { fix: spreadFix, what: `${spread} at \`variants.tone.calm\`` },
          line: 3,
          messageId: 'unresolved',
        },
      ],
    },
    // A value a recipe's config cannot read is a variant's to choose, not a ternary's.
    {
      code: multiline`
  import { cva } from './bamboo/css';

  export const card = (tone: string) => cva({ base: { color: tone } })`,
      errors: [
        {
          column: 39,
          data: {
            fix: 'Write the value out, or declare what varies as a variant the calls select.',
            what: '`base.color` will not reach the stylesheet because its value could not be evaluated at build time',
          },
          line: 3,
          messageId: 'unresolved',
        },
      ],
    },
  ],
  valid: [
    {
      code: multiline`
  import { css } from './bamboo/css';

  export const styles = css({ color: 'red.400' })`,
    },
    // Outside the config's `include`: a file the build never reads.
    { code: dynamic, filename: 'Invalid.tsx' },
    // Under `outdir`: nothing the author writes would change it, and the build does not warn.
    { code: dynamic, filename: 'styled-system/css/leaf.ts' },
    // Read rewritten by a `parser:before` hook — as every `.vue`, `.svelte` and `.astro` file is —
    // so the positions the build reports are not the file's.
    { code: dynamic, filename: 'styles.rewritten.ts' },
    // No bamboo import, so nothing for the build to read: the extractor is not even asked.
    { code: `export const styles = (tone: string) => ({ color: tone })` },
  ],
})

// The editor's text is what is read, each time: an edit that makes the value static clears it.
test(`${RULE_NAME} reads the text as it is now`, () => {
  const linter = new Linter({ configType: 'flat' })
  const config: Linter.Config[] = [
    { files: ['**/*.ts'], languageOptions: { parser: tsParser } },
    { plugins: { bamboo }, rules: { 'bamboo/no-unresolved-styles': 'warn' } },
  ]

  expect(linter.verify(dynamic, config, 'edited.ts')).toHaveLength(1)
  expect(linter.verify(dynamic.replace('color: tone', "color: 'red.400'"), config, 'edited.ts')).toHaveLength(0)
  expect(linter.verify(dynamic, config, 'edited.ts')).toHaveLength(1)
})

// The editor's text stands in for a file only while that file is read. Another file importing it
// reads what is on disk — here nothing, as `shades.ts` was only ever an unsaved buffer — not a
// buffer left behind from an earlier lint.
test(`${RULE_NAME} reads another file as it is on disk`, () => {
  const linter = new Linter({ configType: 'flat' })
  const config: Linter.Config[] = [
    { files: ['**/*.ts'], languageOptions: { parser: tsParser } },
    { plugins: { bamboo }, rules: { 'bamboo/no-unresolved-styles': 'warn' } },
  ]
  linter.verify(`import { css } from './bamboo/css';\nexport const tone = 'red.400'\n`, config, 'shades.ts')

  const messages = linter.verify(
    `import { css } from './bamboo/css';\nimport { tone } from './shades';\nexport const styles = css({ color: tone })\n`,
    config,
    'button.ts',
  )

  expect(messages.map((message) => message.ruleId)).toEqual(['bamboo/no-unresolved-styles'])
})

// A code block a processor lifts out of a document — `@eslint/markdown`'s `guide.md/0.ts` — is no
// file the build reads, and is not asked about: not even its imports are read.
test(`${RULE_NAME} leaves a processor's code block alone`, () => {
  const report = vi.fn()
  const context = {
    filename: 'guide.md/0.ts',
    physicalFilename: 'guide.md',
    report,
    sourceCode: { ast: { type: 'Program' } },
  }

  const visitors = rule.create(context as never) as { 'Program:exit': () => void }
  visitors['Program:exit']()

  expect(report).not.toHaveBeenCalled()
})
