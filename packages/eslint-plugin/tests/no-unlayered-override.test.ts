import rule, { RULE_NAME } from '../src/rules/no-unlayered-override'
import { eslintTester } from '../test-utils'
import multiline from 'multiline-ts'

/**
 * Joining class names does not resolve conflicts between them. So a component that styles
 * itself with `css()` and joins a `className` it was handed has both classes in the `utilities`
 * layer, and which one applies is decided by stylesheet order rather than by the caller.
 *
 * Every way of joining them counts: `cx`, under its own name or an alias, the joiners projects
 * bring from npm, a template literal, `+` and an array's `join()`. A join outside `cx()` is worse,
 * since the build cannot see it at all: it does not keep the component's atoms in the entry sheet
 * when it splits the stylesheet per route, so the winner can change with the route opened first.
 *
 * The fix is a recipe variant for an override the caller chooses, or `cx()` over style calls when
 * the file owns both sides. Accepting a style object instead does not help: an arbitrary runtime
 * object is not something the compiler can read.
 *
 * Recipe calls are not reported, and that is a decision about this rule's scope rather than a claim
 * that they are safe: recipes compile to the same `utilities` atoms `css()` uses, and no `recipes`
 * layer is emitted, so a recipe joined with an opaque class is the same collision.
 */
eslintTester.run(RULE_NAME, rule, {
  invalid: [
    {
      code: multiline`
  import { css, cx } from './bamboo/css';

  const Card = (props) => <div className={cx(css({ padding: '4' }), props.className)} />`,
      errors: [{ data: { join: '`cx`' }, messageId: 'unlayeredOverride' }],
    },
    {
      // Order does not matter — neither can win by layer whichever way round they go.
      code: multiline`
  import { css, cx } from './bamboo/css';

  const Card = ({ className }) => <div className={cx(className, css({ padding: '4' }))} />`,
      errors: [{ messageId: 'unlayeredOverride' }],
    },
    {
      // `cx` under another name is the same join.
      code: multiline`
  import { css, cx as join } from './bamboo/css';

  const Card = (props) => <div className={join(css({ padding: '4' }), props.className)} />`,
      errors: [{ data: { join: '`join`' }, messageId: 'unlayeredOverride' }],
    },
    {
      // And so is `css` under another name.
      code: multiline`
  import { css as style, cx } from './bamboo/css';

  const Card = (props) => <div className={cx(style({ padding: '4' }), props.className)} />`,
      errors: [{ messageId: 'unlayeredOverride' }],
    },
    {
      code: multiline`
  import clsx from 'clsx';
  import { css } from './bamboo/css';

  const Card = (props) => <div className={clsx(css({ padding: '4' }), props.className)} />`,
      errors: [{ data: { join: '`clsx`' }, messageId: 'unlayeredOverride' }],
    },
    {
      code: multiline`
  import classNames from 'classnames';
  import { css } from './bamboo/css';

  const Card = ({ className }) => <div className={classNames(css({ padding: '4' }), className)} />`,
      errors: [{ data: { join: '`classNames`' }, messageId: 'unlayeredOverride' }],
    },
    {
      // A project's own `clsx` wrapper.
      code: multiline`
  import { css } from './bamboo/css';
  import { cn } from './utils';

  const Card = ({ className }) => <div className={cn(css({ padding: '4' }), className)} />`,
      errors: [{ data: { join: '`cn`' }, messageId: 'unlayeredOverride' }],
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const Card = (props) => <div className={\`\${css({ padding: '4' })} \${props.className}\`} />`,
      errors: [{ data: { join: 'A template literal' }, messageId: 'unlayeredOverride' }],
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const Card = (props) => <div className={css({ padding: '4' }) + ' ' + props.className} />`,
      errors: [{ data: { join: 'Concatenating with `+`' }, messageId: 'unlayeredOverride' }],
    },
    {
      // A chain is read whole, wherever its parentheses fall, and reported once.
      code: multiline`
  import { css } from './bamboo/css';

  const Card = ({ className }) => <div className={css({ padding: '4' }) + (' ' + className)} />`,
      errors: [{ messageId: 'unlayeredOverride' }],
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const Card = ({ className }) => <div className={[css({ padding: '4' }), className].join(' ')} />`,
      errors: [{ data: { join: 'An array `join()`' }, messageId: 'unlayeredOverride' }],
    },
    {
      // The styles a component declares once and forwards a class beside, as the docs write it.
      code: multiline`
  import { css, cx } from './bamboo/css';

  const styles = css({ padding: '4' });
  const Card = (props) => <div className={cx(styles, props.className)} />`,
      errors: [{ messageId: 'unlayeredOverride' }],
    },
    {
      // Declared inside the component, the binding is the file's own all the same.
      code: multiline`
  import { css, cx } from './bamboo/css';

  const Card = ({ className }) => {
    const styles = css({ padding: '4' });
    return <div className={cx(styles, className)} />
  }`,
      errors: [{ messageId: 'unlayeredOverride' }],
    },
    {
      code: multiline`
  import { css } from './bamboo/css';

  const styles = css({ padding: '4' });
  const Card = ({ className }) => <div className={\`\${styles} \${className}\`} />`,
      errors: [{ data: { join: 'A template literal' }, messageId: 'unlayeredOverride' }],
    },
  ],
  valid: [
    {
      // A config recipe compiles to the same atoms as css(), so this is the same collision; see the
      // note above for why recipe calls are left out regardless.
      code: multiline`
  import { cx } from './bamboo/css';
  import { button } from './bamboo/recipes';

  const Button = (props) => <button className={cx(button(), props.className)} />`,
    },
    {
      // So is an inline cva.
      code: multiline`
  import { cva, cx } from './bamboo/css';

  const button = cva({ base: { padding: '4' } });
  const Button = (props) => <button className={cx(button(), props.className)} />`,
    },
    {
      // And an inline sva, per slot.
      code: multiline`
  import { cx, sva } from './bamboo/css';

  const card = sva({ slots: ['root'], base: { root: { padding: '4' } } });
  const Card = (props) => <div className={cx(card().root, props.className)} />`,
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
  import { css, cx } from './bamboo/css';

  const styles = cx(css({ padding: '4' }), css({ color: 'red.300' }))`,
    },
    {
      // And a call beside a binding holding another: the file's own twice over.
      code: multiline`
  import { css, cx } from './bamboo/css';

  const loud = css({ color: 'red.300' });
  const styles = cx(css({ padding: '4' }), loud)`,
    },
    {
      // A parameter of the same name shadows the binding, so neither part is the file's own.
      code: multiline`
  import { css, cx } from './bamboo/css';

  const styles = css({ padding: '4' });
  const Card = ({ styles, className }) => <div className={cx(styles, className)} />`,
    },
    {
      // A binding that can be reassigned may hold anything by the time it is joined.
      code: multiline`
  import { css, cx } from './bamboo/css';

  let styles = css({ padding: '4' });
  const Card = ({ className }) => <div className={cx(styles, className)} />`,
    },
    {
      // A static marker class carries no styles to conflict with.
      code: multiline`
  import { css, cx } from './bamboo/css';

  const styles = cx(css({ padding: '4' }), 'group')`,
    },
    {
      code: multiline`
  import { cx } from './bamboo/css';

  const styles = cx(a, b)`,
    },
    {
      // The same holds outside `cx`: a marker class in a template literal is part of its text.
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
