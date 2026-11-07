import rule, { RULE_NAME } from '../src/rules/no-unlayered-override'
import { eslintTester } from '../test-utils'
import multiline from 'multiline-ts'

/**
 * Joining class names does not resolve conflicts between them, unless the join is Bamboo's `cx`,
 * which keeps the last class passed for each property and conditions.
 * So a component that styles itself with `css()` and joins a `className` it was handed any other
 * way has both classes in the `utilities` layer, and which one applies is decided by stylesheet
 * order rather than by the caller.
 *
 * A join outside `cx` is worse than an unresolved one: the build cannot see it at all, so it does
 * not keep the component's atoms in the entry sheet when it splits the stylesheet per route, and
 * the winner can change with the route opened first.
 *
 * Recipe calls are not reported, and that is a decision about this rule's scope rather than a claim
 * that they are safe: recipes compile to the same `utilities` atoms `css()` uses, and no `recipes`
 * layer is emitted, so a recipe joined with an opaque class is the same collision.
 */
eslintTester.run(RULE_NAME, rule, {
  invalid: [
    {
      code: multiline`
  import clsx from 'clsx';
  import { css } from './bamboo/css';

  const Card = (props) => <div className={clsx(css({ padding: '4' }), props.className)} />`,
      errors: [{ data: { join: '`clsx`' }, messageId: 'unmergedJoin' }],
    },
    {
      // Order does not matter — neither can win by layer whichever way round they go.
      code: multiline`
  import clsx from 'clsx';
  import { css } from './bamboo/css';

  const Card = ({ className }) => <div className={clsx(className, css({ padding: '4' }))} />`,
      errors: [{ messageId: 'unmergedJoin' }],
    },
    {
      // And so is `css` under another name.
      code: multiline`
  import clsx from 'clsx';
  import { css as style } from './bamboo/css';

  const Card = (props) => <div className={clsx(style({ padding: '4' }), props.className)} />`,
      errors: [{ messageId: 'unmergedJoin' }],
    },
    {
      code: multiline`
  import classNames from 'classnames';
  import { css } from './bamboo/css';

  const Card = ({ className }) => <div className={classNames(css({ padding: '4' }), className)} />`,
      errors: [{ data: { join: '`classNames`' }, messageId: 'unmergedJoin' }],
    },
    {
      // A project's own `clsx` wrapper.
      code: multiline`
  import { css } from './bamboo/css';
  import { cn } from './utils';

  const Card = ({ className }) => <div className={cn(css({ padding: '4' }), className)} />`,
      errors: [{ data: { join: '`cn`' }, messageId: 'unmergedJoin' }],
    },
    {
      // A `cx` that is not Bamboo's only joins, whatever it is called.
      code: multiline`
  import cx from 'classnames';
  import { css } from './bamboo/css';

  const Card = (props) => <div className={cx(css({ padding: '4' }), props.className)} />`,
      errors: [{ data: { join: '`cx`' }, messageId: 'unmergedJoin' }],
    },
    {
      // Nor is one the file defines for itself.
      code: multiline`
  import { css } from './bamboo/css';

  const cx = (...names) => names.filter(Boolean).join(' ');
  const Card = (props) => <div className={cx(css({ padding: '4' }), props.className)} />`,
      errors: [{ data: { join: '`cx`' }, messageId: 'unmergedJoin' }],
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const Card = (props) => <div className={\`\${css({ padding: '4' })} \${props.className}\`} />`,
      errors: [{ data: { join: 'A template literal' }, messageId: 'unmergedJoin' }],
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const Card = (props) => <div className={css({ padding: '4' }) + ' ' + props.className} />`,
      errors: [{ data: { join: 'Concatenating with `+`' }, messageId: 'unmergedJoin' }],
    },
    {
      // A chain is read whole, wherever its parentheses fall, and reported once.
      code: multiline`
  import { css } from './bamboo/css';

  const Card = ({ className }) => <div className={css({ padding: '4' }) + (' ' + className)} />`,
      errors: [{ messageId: 'unmergedJoin' }],
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const Card = ({ className }) => <div className={[css({ padding: '4' }), className].join(' ')} />`,
      errors: [{ data: { join: 'An array `join()`' }, messageId: 'unmergedJoin' }],
    },
    {
      // The styles a component declares once and forwards a class beside.
      code: multiline`
  import clsx from 'clsx';
  import { css } from './bamboo/css';

  const styles = css({ padding: '4' });
  const Card = (props) => <div className={clsx(styles, props.className)} />`,
      errors: [{ messageId: 'unmergedJoin' }],
    },
    {
      // Declared inside the component, the binding is the file's own all the same.
      code: multiline`
  import clsx from 'clsx';
  import { css } from './bamboo/css';

  const Card = ({ className }) => {
    const styles = css({ padding: '4' });
    return <div className={clsx(styles, className)} />
  }`,
      errors: [{ messageId: 'unmergedJoin' }],
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ padding: '4' });
  const Card = ({ className }) => <div className={\`\${styles} \${className}\`} />`,
      errors: [{ data: { join: 'A template literal' }, messageId: 'unmergedJoin' }],
    },
  ],
  valid: [
    {
      // Bamboo's `cx` keeps the last class per property: the caller's padding replaces the
      // component's, and the two never meet on one element.
      code: multiline`
  import { css, cx } from './bamboo/css';

  const Card = (props) => <div className={cx(css({ padding: '4' }), props.className)} />`,
    },
    {
      // Passed first, the caller's class is the one replaced. That is the order deciding, not the
      // stylesheet.
      code: multiline`
  import { css, cx } from './bamboo/css';

  const Card = ({ className }) => <div className={cx(className, css({ padding: '4' }))} />`,
    },
    {
      // Under another name it is the same `cx`.
      code: multiline`
  import { css, cx as join } from './bamboo/css';

  const Card = (props) => <div className={join(css({ padding: '4' }), props.className)} />`,
    },
    {
      // The forwarding the docs show.
      code: multiline`
  import { css, cx } from './bamboo/css';

  const styles = css({ padding: '4' });
  const Card = (props) => <div className={cx(styles, props.className)} />`,
    },
    {
      // A config recipe compiles to the same atoms as css(), so this is the same collision; see the
      // note above for why recipe calls are left out regardless.
      code: multiline`
  import clsx from 'clsx';
  import { button } from './bamboo/recipes';

  const Button = (props) => <button className={clsx(button(), props.className)} />`,
    },
    {
      // So is an inline cva.
      code: multiline`
  import clsx from 'clsx';
  import { cva } from './bamboo/css';

  const button = cva({ base: { padding: '4' } });
  const Button = (props) => <button className={clsx(button(), props.className)} />`,
    },
    {
      // And an inline sva, per slot.
      code: multiline`
  import clsx from 'clsx';
  import { sva } from './bamboo/css';

  const card = sva({ slots: ['root'], base: { root: { padding: '4' } } });
  const Card = (props) => <div className={clsx(card().root, props.className)} />`,
    },
    {
      // Not a join, so not this rule's question. A runtime style object is not one the compiler
      // can read either, so this does not stand in for the join it replaced.
      code: multiline`
  import { css } from './bamboo/css';

  const Card = (props) => <div className={css({ padding: '4' }, props.css)} />`,
    },
    {
      // Two calls this file owns. Both visible, so nothing is being joined blind.
      code: multiline`
  import clsx from 'clsx';
  import { css } from './bamboo/css';

  const styles = clsx(css({ padding: '4' }), css({ color: 'red.300' }))`,
    },
    {
      // And a call beside a binding holding another: the file's own twice over.
      code: multiline`
  import clsx from 'clsx';
  import { css } from './bamboo/css';

  const loud = css({ color: 'red.300' });
  const styles = clsx(css({ padding: '4' }), loud)`,
    },
    {
      // A parameter of the same name shadows the binding, so neither part is the file's own.
      code: multiline`
  import clsx from 'clsx';
  import { css } from './bamboo/css';

  const styles = css({ padding: '4' });
  const Card = ({ styles, className }) => <div className={clsx(styles, className)} />`,
    },
    {
      // A binding that can be reassigned may hold anything by the time it is joined.
      code: multiline`
  import clsx from 'clsx';
  import { css } from './bamboo/css';

  let styles = css({ padding: '4' });
  const Card = ({ className }) => <div className={clsx(styles, className)} />`,
    },
    {
      // A static marker class carries no styles to conflict with.
      code: multiline`
  import clsx from 'clsx';
  import { css } from './bamboo/css';

  const styles = clsx(css({ padding: '4' }), 'group')`,
    },
    {
      code: multiline`
  import clsx from 'clsx';

  const styles = clsx(a, b)`,
    },
    {
      // The same holds outside a call: a marker class in a template literal is part of its text.
      code: multiline`
  import { css } from './bamboo/css';

  const styles = \`\${css({ padding: '4' })} group\``,
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ padding: '4' }) + ' ' + css({ color: 'red.300' })`,
    },
    {
      // A function that is not known to join class names.
      code: multiline`
  import { css } from './bamboo/css';

  const styles = (className) => track(css({ padding: '4' }), className)`,
    },
    {
      // Nothing of this file's own.
      code: multiline`
  const Card = ({ className, tone }) => <div className={\`\${tone} \${className}\`} />`,
    },
  ],
})
