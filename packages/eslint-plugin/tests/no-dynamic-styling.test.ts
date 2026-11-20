import rule, { RULE_NAME } from '../src/rules/no-dynamic-styling'
import { eslintTester } from '../test-utils'
import multiline from 'multiline-ts'

eslintTester.run(RULE_NAME, rule, {
  invalid: [
    {
      code: multiline`
  import { css } from './bamboo/css';
  
  const color = 'red.100';
  const styles = css({ bg: color })`,
      errors: [{ messageId: 'dynamic' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  const size = '8';
  const styles = css({ padding: ['4', size] })`,
      errors: [{ messageId: 'array' }],
    },

    // An array of literals is still not a style value: the runtime throws and the build fails.
    {
      code: multiline`
  import { css } from './bamboo/css';
  
  const styles = css({ padding: ['4', '8'] })`,
      errors: [{ messageId: 'array' }],
    },

    // A list of mixins is an array a style takes, and each name in it is a value.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const heading = 'headline.h2';
  const styles = css({ mixin: ['headline.h1', heading], md: { mixin: { lg: [heading] } } })`,
      errors: [{ messageId: 'dynamic' }, { messageId: 'dynamic' }],
    },

    {
      code: multiline`
  import { flex } from './bamboo/patterns';

  const align = 'center';
  const styles = flex({ align: align })`,
      errors: [{ messageId: 'dynamic' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    const bool = true;
    return <div className={css({ debug: bool })} />;
  }`,
      errors: [{ messageId: 'dynamic' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    const color = 'red.100';
    return <div className={css({ color: color })} />;
  }`,
      errors: [{ messageId: 'dynamic' }],
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  const property = 'background';
  const styles = css({ [property]: 'red.100' })`,
      errors: [{ messageId: 'dynamicProperty' }],
    },

    {
      code: multiline`
  import { cva,sva } from './bamboo/css';

  function App(){
    const computedValue = "value"
    const heading = cva({
      variants: {
        [computedValue]: {
          color: "red.100",
        }
      }
    });
  }`,
      errors: [{ messageId: 'dynamicRecipeVariant' }],
    },

    // A css() call compiles one choice: the second is reported, where it is written.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const tab = (active) => css({ color: active ? 'white' : 'gray.700', bg: active ? 'blue.500' : 'transparent' })`,
      errors: [{ messageId: 'choice', line: 3, column: 73 }],
    },

    // A choice within a choice is a second one, in an answer as in the other answer's styles.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const a = (x, y) => css({ color: x ? (y ? 'red.100' : 'red.300') : 'gray.700' })
  const b = (x, y) => css(x ? { color: y ? 'red.100' : 'red.300' } : {})`,
      errors: [
        { messageId: 'choice', line: 3, column: 39 },
        { messageId: 'choice', line: 4, column: 38 },
      ],
    },

    // A choice compiles only in a call taking one object, every key of it written out.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const base = { display: 'flex' }
  const a = (active) => css(base, { color: active ? 'red.100' : 'gray.700' })
  const b = (active) => css({ ...base, color: active ? 'red.100' : 'gray.700' })`,
      errors: [{ messageId: 'choice' }, { messageId: 'choice' }],
    },

    // A pattern, a recipe and css.raw() compile none.
    {
      code: multiline`
  import { css, cva } from './bamboo/css';
  import { flex } from './bamboo/patterns';

  const a = (compact) => flex({ gap: compact ? '2' : '4' })
  const b = (dark) => cva({ base: { color: dark ? 'white' : 'black' } })
  const c = (active) => css.raw({ color: active ? 'red.100' : 'gray.700' })`,
      errors: [{ messageId: 'dynamic' }, { messageId: 'dynamic' }, { messageId: 'dynamic' }],
    },

    // An answer is a style value like any other.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const tone = 'red.100'
  const a = (active) => css({ color: active ? tone : 'gray.700' })`,
      errors: [{ messageId: 'dynamic', line: 4, column: 45 }],
    },

    // The test is copied into the compiled call, where a Bamboo import or a recipe is not.
    {
      code: multiline`
  import { css, cva, cx } from './bamboo/css';

  const badge = cva({ base: { color: 'red.100' } })
  const a = () => css({ color: badge() ? 'red.100' : 'gray.700' })
  const b = (props) => css({ color: props.join === cx ? 'red.100' : 'gray.700' })`,
      errors: [{ messageId: 'choiceTest' }, { messageId: 'choiceTest' }],
    },
  ],
  valid: [
    {
      code: multiline`
  import { css } from './bamboo/css';
  
  const styles = css({ bg: 'gray.900' })`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ debug: true })} />;
  }`,
    },

    {
      code: multiline`
  import { css } from './bamboo/css';
  
  function App(){
    return <div className={css({ color: 'red.100' })} />;
  }`,
    },
    {
      code: multiline`
  const foo = 'foo'
  const nonStyles = {bar: [foo]}
  `,
    },

    // Mixins listed apply in order, alone and chosen per condition.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ mixin: ['headline.h1', 'headline.h2'], _hover: { mixin: { base: 'headline.h1', md: ['headline.h2'] } } })`,
    },

    // One choice between values written out, which the compiler compiles to its test choosing
    // between two class strings.
    {
      code: multiline`
  import { css, cx } from './bamboo/css';

  const a = (compact) => css({ padding: compact ? '2' : '4' })
  const b = (props) => css({ color: 'red.100', padding: props.size === 'sm' ? '2' : '4' })
  const c = (active) => css({ _hover: active ? { color: 'red.100' } : {} })
  const d = (active) => css({ color: active ? 'red.100' : undefined })
  const e = (active) => css({ color: { base: 'gray.700', _hover: active ? 'red.100' : 'red.300' } })
  const f = (active) => css(active ? { color: 'red.100' } : { color: 'gray.700' })
  const g = (compact, loud) => cx(css({ padding: compact ? '2' : '4' }), css({ color: loud ? 'red.100' : 'gray.700' }))
  const h = (active) => css({ color: (active ? 'red.100' : 'gray.700') as string })

  function App({ compact }){
    return <div className={css({ padding: compact ? '2' : '4' })} />;
  }`,
    },

    // A negative number, and a literal under TypeScript the compiler reads through.
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ zIndex: -1, marginTop: -4, color: 'red.100' as const })`,
    },
  ],
})
