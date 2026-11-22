import rule, { RULE_NAME } from '../src/rules/no-invalid-token-paths'
import { eslintTester } from '../test-utils'
import multiline from 'multiline-ts'

const validLiteral = 'const className = css`\n  font-size: token(fontSizes.md);\n`'
const invalidLiteral = 'const className = css`\n  font-size: token(fontSizes.emd);\n`'

/** The build's sentence for a call naming no token, which the rule passes through. */
const noSuchToken = (call: string, fix = 'Check the path, or add the token to your theme.') =>
  `${call} names no token. It returns \`undefined\`, so whatever reads it gets nothing: in a style, the property is dropped. ${fix}`

eslintTester.run(RULE_NAME, rule, {
  invalid: [
    // A style handed to a pattern beside the pattern's own prop is still judged as one.
    {
      code: multiline`
  import { flex } from './bamboo/patterns';

  const styles = flex({ direction: 'column', color: 'shark' })`,
      errors: [{ messageId: 'unresolvedValue' }],
    },

    /**
     * The squiggle the deleted type narrowing used to give, from the resolver instead.
     *
     * `mutedd` has no dot, so the token-path extraction below cannot see it — a value only tells
     * you it is a name, never whether the property accepts one. The build has answered this for
     * a while; these are the same verdicts, in the editor.
     */
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'mutedd' })`,
      errors: [{ messageId: 'unresolvedValue' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ display: 'flexx' })`,
      errors: [{ messageId: 'unresolvedValue' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  // colorszz is not a valid token type
  const styles = css({ bg: 'token(colorszz.red.300) 50%' })`,
      errors: [{ messageId: 'noInvalidTokenPaths' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    // \`4000\` is not a valid size token. Assuming we're using the default bamboo presets
    return <div className={css({ marginX: 'token(sizes.4000) 20px' })} />;
  }`,
      errors: [{ messageId: 'noInvalidTokenPaths' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    // \`1\` does not exist in borderWidths, and \`grays\` is not a valid color token. Assuming we're using the default bamboo presets
    return <div className={css({ _hover: {  border: 'solid token(borderWidths.1) token(colors.grays.100)' } })} />;
  }`,
      errors: [{ messageId: 'noInvalidTokenPaths' }, { messageId: 'noInvalidTokenPaths' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  ${invalidLiteral}`,
      errors: [{ messageId: 'noInvalidTokenPaths' }],
    },

    // `base` is not a property, so the value under it was skipped while `_hover` beside it was
    // read; and a quoted key was skipped whatever it named.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: { base: 'token(colors.nope)', _hover: 'token(colors.nope2)' } })`,
      errors: [{ messageId: 'noInvalidTokenPaths' }, { messageId: 'noInvalidTokenPaths' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ '--accent': 'token(colors.nope)' })`,
      errors: [{ messageId: 'noInvalidTokenPaths' }],
    },

    // An opacity the build cannot read fails it, so the rule says so, as it does of the colour.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: 'token(colors.red.300/hlaf)' })`,
      errors: [{ messageId: 'noInvalidTokenPaths' }],
    },

    // A value under a condition is judged against the property holding it, not the condition.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: { base: 'mutedd', _hover: 'mutedd2' } })`,
      errors: [{ messageId: 'unresolvedValue' }, { messageId: 'unresolvedValue' }],
    },

    /**
     * The call form returns `undefined`, so the property it is written into is dropped: no rule, and
     * nothing in the build said so. Reported over the call, in the sentence the build fails with.
     */
    {
      code: multiline`
  import { css } from './bamboo/css';
  import { token } from './bamboo/tokens';

  const styles = css({ color: token('colors.ghost') })`,
      errors: [
        {
          column: 29,
          data: { message: noSuchToken("`token('colors.ghost')`") },
          endColumn: 50,
          line: 4,
          messageId: 'unresolvedTokenCall',
        },
      ],
    },

    // `token.value()` too, wherever its result goes, and with the path it was probably meant to be.
    {
      code: multiline`
  import { token } from './bamboo/tokens';

  export const accent = token.value('red.300')`,
      errors: [
        {
          data: { message: noSuchToken("`token.value('red.300')`", "Did you mean `token.value('colors.red.300')`?") },
          messageId: 'unresolvedTokenCall',
        },
      ],
    },

    // A path the build reads through a constant is judged as the build judges it.
    {
      code: multiline`
  import { css } from './bamboo/css';
  import { token } from './bamboo/tokens';

  const shade = 'colors.ghost';
  export const styles = css({ color: token(shade) })`,
      errors: [{ data: { message: noSuchToken("`token('colors.ghost')`") }, messageId: 'unresolvedTokenCall' }],
    },
  ],
  valid: [
    // A keyword the property enumerates, a `<custom-ident>` the grammar asks for, and a raw
    // value. The type layer needed a hand-written list of 29 property names to get the middle
    // one right, and still rejected `transitionProperty: 'color'`.
    `import { css } from './bamboo/css';\nconst a = css({ display: 'flex' })`,
    `import { css } from './bamboo/css';\nconst b = css({ animationName: 'fadeIn' })`,
    `import { css } from './bamboo/css';\nconst c = css({ transitionProperty: 'color' })`,
    `import { css } from './bamboo/css';\nconst d = css({ fontSize: '14px' })`,
    `import { css } from './bamboo/css';\nconst e = css({ color: 'currentcolor' })`,
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ bg: 'token(colors.red.300) 50%' })`,
    },

    // The build resolves a colour with an opacity through the colour, and so does the rule.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ color: { base: 'token(colors.red.300/50)', _hover: 'red.300' }, '--accent': 'token(colors.red.300)' })`,
    },

    /**
     * The retired curly spelling is no longer a token reference, so a path that would be invalid
     * inside `token(…)` is not reported here — there is nothing to validate.
     *
     * Pinned because the lint plugin carries its own copy of the reference syntax, in
     * `utils/helpers.ts` and in `no-unsafe-token-fn-usage`. Restoring the curly branch in both
     * left the entire suite green, so a half-removal that kept `{…}` alive in four rules could
     * have shipped unnoticed — which is exactly the two-ways-to-say-one-thing this removed.
     */
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ marginX: '{sizes.4000} 20px' })`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ marginX: 'token(sizes.4) 20px' })} />;
  }`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ _hover: {  border: 'solid 1px token(colors.gray.100, #F3F4F6)' } })} />;
  }`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  ${validLiteral}`,
    },

    // A call naming a token, and one after the retired fallback argument, which is not a path.
    {
      code: multiline`
  import { css } from './bamboo/css';
  import { token } from './bamboo/tokens';

  export const styles = css({ color: token('colors.red.300'), bg: token('colors.red.300', '#fff') })`,
    },

    // A call whose result is defaulted handles a path naming nothing itself, as the docs say to.
    {
      code: multiline`
  import { css } from './bamboo/css';
  import { token } from './bamboo/tokens';

  export const styles = css({ color: token('colors.ghost') ?? '#fff' })`,
    },

    // A path known only at runtime, which the build does not judge, and somebody else's `token`.
    {
      code: multiline`
  import { css } from './bamboo/css';
  import { token } from './bamboo/tokens';

  export const styles = (shade: string) => css({ color: token(shade) })`,
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const token = (path: string) => path;
  export const label = token('colors.ghost');
  export const styles = css({ color: 'red.300' })`,
    },

    /**
     * A recipe's argument selects variants, and a pattern's own prop is the pattern's to map: neither
     * value is a style's. `rounded: true` names a `cardStyle` variant, not a `radii` token, and
     * `direction` is `flex`'s `flexDirection`, not CSS `direction`. They were judged as both.
     */
    {
      code: multiline`
  import { cva } from './bamboo/css';
  import { flex } from './bamboo/patterns';
  import { cardStyle } from './bamboo/recipes';

  export const card = cardStyle({ rounded: true })
  export const column = flex({ direction: 'column' })
  export const responsive = flex({ direction: { base: 'column', md: 'row' } })
  export const badge = cva({
    className: 'badge',
    variants: { rounded: { true: { borderRadius: 'md' } } },
    defaultVariants: { rounded: true },
    compoundVariants: [{ rounded: true, css: { color: 'red.300' } }],
  })`,
    },
  ],
})
