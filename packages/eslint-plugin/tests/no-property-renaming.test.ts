import rule, { RULE_NAME } from '../src/rules/no-property-renaming'
import { eslintTester } from '../test-utils'
import multiline from 'multiline-ts'

eslintTester.run(RULE_NAME, rule, {
  invalid: [
    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function Text({ variant }){
    return <p className={css({ mixin: variant })} />;
  }`,
      errors: [{ messageId: 'noRenaming' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function Text(props){
    return <p className={css({ mixin: props.variant })} />;
  }`,
      errors: [{ messageId: 'noRenaming' }],
    },

    // TODO detect pattern attributes as bamboo property
    //   {
    //     code: multiline`
    // import { css } from './bamboo/css';

    // function CustomCircle(props){
    //   const { circleSize = '3' } = props
    //   return (
    //     <div className={css({ size: circleSize })} />
    //   )
    // }`,
    //   },

    //   {
    //     code: multiline`
    // import { css } from './bamboo/css';

    // function CustomCircle(props){
    //   return (
    //     <div className={css({ size: props.circleSize })} />
    //   )
    // }`,
    //   },
  ],
  valid: [
    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function Text({ mixin }){
    return <p className={css({ mixin })} />;
  }`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function Text(props){
    return <p className={css({ mixin: props.mixin })} />;
  }`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function CustomCircle(props){
    const { size = '3' } = props
    return (
      <div className={css({ size: size })} />
    )
  }`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function CustomCircle(props){
    return (
      <div className={css({ size: props.size })} />
    )
  }`,
    },

    // A variant being selected is no prop the build tracks: a recipe call reads whatever it is handed.
    // That a declaration's selection is written out is \`no-dynamic-styling\`'s to say.
    {
      code: multiline`
  import { cva } from './bamboo/css';
  import { cardStyle } from './bamboo/recipes';

  export const card = (isRounded: boolean) => cardStyle({ rounded: isRounded })
  export const badge = (isRounded: boolean) =>
    cva({ className: 'badge', variants: { rounded: { true: { borderRadius: 'md' } } }, defaultVariants: { rounded: isRounded } })`,
    },
  ],
})
