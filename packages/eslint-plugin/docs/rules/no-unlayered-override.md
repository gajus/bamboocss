# Disallow joining a class this file styled with a class it cannot see, by a join that does not decide which of them applies (`@bamboocss/no-unlayered-override`)

⚠️ This rule _warns_ in the following configs: 🌐 `all`, ✅ `recommended`.

<!-- end auto-generated rule header -->

Bamboo's runtime `cx` keeps the last class passed for each property and conditions, so a component that forwards the
`className` it was handed through `cx` lets the caller's class replace its own — see
[Merging styles](https://bamboocss.com/docs/concepts/merging-styles). Any other way of joining class names does not
resolve conflicts between them.

So when a component styles itself with `css()` and joins a `className` it was handed outside `cx`, both classes end up
on the element, both in the `utilities` layer. Which one applies is decided by their order in the stylesheet, not by the
order they were written, and the caller has no way to influence it.

```jsx
// ⚠️ the caller's padding may or may not win
const Card = (props) => <div className={`${css({ padding: '4' })} ${props.className}`} />

// ✅ the caller's padding replaces the component's
const Card = (props) => <div className={cx(css({ padding: '4' }), props.className)} />
```

Every join outside `cx` is reported: `clsx`, `classnames` and a `cn` wrapper, a template literal, `+` and an array's
`join()`. They are worse than a join that only leaves the order to the stylesheet, because the build cannot see them.
When the Vite plugin
[splits the stylesheet per route](https://bamboocss.com/docs/installation/vite#per-route-stylesheets), it keeps the
atoms a `cx()` joins with an outside class in the entry sheet, so a class passed in from a lazily loaded route loads
after them. A template literal gets no such treatment, and which class applies can change with the route the visitor
opened first.

Only a `cx` imported from Bamboo is known to merge. A `cx` imported from `classnames`, or one the file defines, is a
join like any other and is reported.

## How to fix it

**Join through `cx`.** It keeps the last class passed for each property and conditions, so pass the class the caller may
override with last:

```jsx
const Card = ({ className }) => <div className={cx(css({ padding: '4' }), className)} />
```

**Expose a variant for an override the caller chooses.** A recipe variant is a finite choice the compiler resolves into
one complete class:

```jsx
const card = cva({
  base: { padding: '4' },
  variants: { compact: { true: { padding: '2' } } },
})

const Card = ({ compact, ...rest }) => <div className={card({ compact })} {...rest} />
```

Accepting a style object instead of a class name, as in `css(base, props.css)`, does not help: an arbitrary runtime
object is not something the compiler can read.

## When not to use it

The rule only fires when one part of the join is styles this file wrote and another is a value it cannot see. Styles
this file wrote are a `css()` call or a `const` the file declares holding one, so `clsx(styles, props.className)` is
reported wherever `styles` is declared, and a parameter named `styles` is not mistaken for it. A binding imported from
another module is not followed. Joining two of the file's own styles is not reported. Neither is a static marker class
such as `'group'`, written as a string or as the text of a template literal, which carries no styles to conflict with.

Recipe results are not reported either, though outside `cx` they collide the same way: a recipe compiles to the same
`utilities` atoms as `css()`, and no `recipes` layer is emitted for a caller's class to beat it from.
