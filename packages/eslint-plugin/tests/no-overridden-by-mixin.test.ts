import rule, { RULE_NAME } from '../src/rules/no-overridden-by-mixin'
import { eslintTester } from '../test-utils'

/**
 * A mixin is its declarations written where it is applied, so a property written before it that it
 * sets too is replaced, and does nothing. Keys sorted alphabetically put `mixin` after nearly every
 * property beside it, which is how a codebase ends up with hundreds of them.
 *
 * `headline.h1` sets `fontSize` and `fontWeight`; `headline.h2` sets `fontWeight`, and `fontSize`
 * at its base and at `lg`; `inset` writes `padding` as `p`.
 */
const file = (body: string) => `import { css, cva } from './bamboo/css';\n\n${body}`

const overridden = (property: string, mixin: string) => ({
  data: { mixin, property },
  messageId: 'overridden' as const,
})

eslintTester.run(RULE_NAME, rule, {
  valid: [
    // Written after the mixin, it is the one that wins.
    { code: file(`const a = css({ mixin: 'headline.h1', fontWeight: 'light' })`) },
    // A property the mixin does not set.
    { code: file(`const a = css({ color: 'red.100', mixin: 'headline.h1' })`) },
    // The same property under a condition the mixin does not write it under.
    { code: file(`const a = css({ _hover: { fontWeight: 'light' }, mixin: 'headline.h1' })`) },
    { code: file(`const a = css({ fontSize: { md: '3rem' }, mixin: 'headline.h2' })`) },
    // An important value is kept against one written after it that is not.
    { code: file(`const a = css({ fontWeight: 'light !important', mixin: 'headline.h1' })`) },
    // A mixin no theme defines writes nothing, and one chosen at runtime is not read.
    { code: file(`const a = css({ fontWeight: 'light', mixin: 'nope' })`) },
    { code: file(`const a = (name: string) => css({ fontWeight: 'light', mixin: name })`) },
    // Somebody else's `css`.
    { code: `const css = (styles: object) => styles;\nconst a = css({ fontWeight: 'light', mixin: 'headline.h1' })` },
  ],
  invalid: [
    {
      code: file(`const a = css({ fontWeight: 'light', mixin: 'headline.h1' })`),
      errors: [overridden('fontWeight', "'headline.h1'")],
      output: file(`const a = css({ mixin: 'headline.h1', fontWeight: 'light' })`),
    },
    {
      code: file(`const a = css({ color: 'red.100', fontSize: '1rem', fontWeight: 'light', mixin: 'headline.h1' })`),
      errors: [overridden('fontSize', "'headline.h1'"), overridden('fontWeight', "'headline.h1'")],
      output: file(`const a = css({ mixin: 'headline.h1', color: 'red.100', fontSize: '1rem', fontWeight: 'light' })`),
    },
    // Each key on its own line keeps its line.
    {
      code: file(`const a = css({\n  color: 'red.100',\n  fontWeight: 'light',\n  mixin: 'headline.h1',\n})`),
      errors: [overridden('fontWeight', "'headline.h1'")],
      output: file(`const a = css({\n  mixin: 'headline.h1',\n  color: 'red.100',\n  fontWeight: 'light',\n})`),
    },
    // A shorthand and its longhand are one declaration, whichever side writes which.
    {
      code: file(`const a = css({ padding: '2', mixin: 'inset' })`),
      errors: [overridden('padding', "'inset'")],
      output: file(`const a = css({ mixin: 'inset', padding: '2' })`),
    },
    // A value chosen per condition, where the mixin writes the same one.
    {
      code: file(`const a = css({ fontSize: { lg: '3rem' }, mixin: 'headline.h2' })`),
      errors: [overridden('fontSize', "'headline.h2'")],
      output: file(`const a = css({ mixin: 'headline.h2', fontSize: { lg: '3rem' } })`),
    },
    // Under a condition, both written there.
    {
      code: file(`const a = css({ _hover: { fontWeight: 'light', mixin: 'headline.h1' } })`),
      errors: [overridden('fontWeight', "'headline.h1'")],
      output: file(`const a = css({ _hover: { mixin: 'headline.h1', fontWeight: 'light' } })`),
    },
    // A mixin chosen per condition overrides what its base writes.
    {
      code: file(`const a = css({ fontWeight: 'light', mixin: { base: 'headline.h1', lg: 'headline.h2' } })`),
      errors: [overridden('fontWeight', "{ base: 'headline.h1', lg: 'headline.h2' }")],
      output: file(`const a = css({ mixin: { base: 'headline.h1', lg: 'headline.h2' }, fontWeight: 'light' })`),
    },
    // In a recipe's base and its variants.
    {
      code: file(`const r = cva({ base: { fontWeight: 'light', mixin: 'headline.h1' } })`),
      errors: [overridden('fontWeight', "'headline.h1'")],
      output: file(`const r = cva({ base: { mixin: 'headline.h1', fontWeight: 'light' } })`),
    },
    {
      code: file(`const r = cva({ variants: { size: { lg: { fontWeight: 'light', mixin: 'headline.h1' } } } })`),
      errors: [overridden('fontWeight', "'headline.h1'")],
      output: file(`const r = cva({ variants: { size: { lg: { mixin: 'headline.h1', fontWeight: 'light' } } } })`),
    },
    // In a compound variant's styles, and in a pattern's.
    {
      code: file(
        `const r = cva({ variants: { size: { lg: {} } }, compoundVariants: [{ size: 'lg', css: { fontWeight: 'light', mixin: 'headline.h1' } }] })`,
      ),
      errors: [overridden('fontWeight', "'headline.h1'")],
      output: file(
        `const r = cva({ variants: { size: { lg: {} } }, compoundVariants: [{ size: 'lg', css: { mixin: 'headline.h1', fontWeight: 'light' } }] })`,
      ),
    },
    {
      code: `import { flex } from './bamboo/patterns';\n\nconst a = flex({ fontWeight: 'light', mixin: 'headline.h1' })`,
      errors: [overridden('fontWeight', "'headline.h1'")],
      output: `import { flex } from './bamboo/patterns';\n\nconst a = flex({ mixin: 'headline.h1', fontWeight: 'light' })`,
    },
    // Not moved past a spread, whose keys it would now precede unread, nor away from a comment.
    {
      code: file(`const base = {}\nconst a = css({ ...base, fontWeight: 'light', mixin: 'headline.h1' })`),
      errors: [overridden('fontWeight', "'headline.h1'")],
      output: null,
    },
    {
      code: file(`const a = css({ fontWeight: 'light', /* the type */ mixin: 'headline.h1' })`),
      errors: [overridden('fontWeight', "'headline.h1'")],
      output: null,
    },
  ],
})
