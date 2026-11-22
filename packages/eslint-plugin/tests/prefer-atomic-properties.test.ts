import rule, { RULE_NAME } from '../src/rules/prefer-atomic-properties'
import { eslintTester } from '../test-utils'
import multiline from 'multiline-ts'

eslintTester.run(RULE_NAME, rule, {
  invalid: [
    // A style handed to a pattern beside its own props is still a style: one error, `margin`'s, as
    // `padding` is the pattern's.
    {
      code: multiline`
  import { panel } from './bamboo/patterns';

  const styles = panel({ padding: '4', margin: '2' })`,
      errors: [{ messageId: 'atomic', line: 3, column: 38 }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  const styles = css({ gap: '4' })`,
      errors: [{ messageId: 'atomic' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ background: 'red.100' })} />;
  }`,
      errors: [{ messageId: 'atomic' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ _hover: {  borderTop: 'solid 1px blue' } })} />;
  }`,
      errors: [{ messageId: 'atomic' }],
    },
  ],
  valid: [
    {
      code: multiline`
  import { css } from './bamboo/css';
  
  const styles = css({ rowGap: '4', columnGap: '4' })`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ backgroundColor: 'red.100' })} />;
  }`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ _hover: {  borderTopStyle: 'solid', borderTopWidth: '1px', borderTopColor: 'blue' } })} />;
  }`,
    },

    // A variant being selected, or a prop the pattern declares, is that recipe's or pattern's name for
    // something, and split up it would reach neither: \`panel\` reads \`padding\` and \`rounded\` by name.
    {
      code: multiline`
  import { cva } from './bamboo/css';
  import { panel } from './bamboo/patterns';
  import { cardStyle } from './bamboo/recipes';

  export const card = cardStyle({ rounded: true })
  export const box = panel({ padding: '4', rounded: true })
  export const badge = cva({
    className: 'badge',
    variants: { rounded: { true: { borderTopLeftRadius: 'md' } } },
    defaultVariants: { rounded: true },
    compoundVariants: [{ rounded: true, css: { color: 'red.300' } }],
  })`,
    },
  ],
})
