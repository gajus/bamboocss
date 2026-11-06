# Disallow joining a class this file styled with a class it cannot see, where neither can win by cascade layer (`@bamboocss/no-unlayered-override`)

⚠️ This rule _warns_ in the following configs: 🌐 `all`, ✅ `recommended`.

<!-- end auto-generated rule header -->

Joining class names does not resolve conflicts between them, in any build — see
[Merging styles](https://bamboocss.com/docs/concepts/merging-styles).

So when a component styles itself with `css()` and joins a `className` it was handed, both classes are in the
`utilities` layer. Which one applies is decided by their order in the stylesheet, not by the order they were passed, and
the caller has no way to influence it.

```jsx
// ⚠️ the caller's padding may or may not win
const Card = (props) => <div className={cx(css({ padding: '4' }), props.className)} />
```

Every join is reported, not only `cx`: `cx` imported under another name, `clsx`, `classnames` and a `cn` wrapper, a
template literal, `+` and an array's `join()`. A join outside `cx()` is worse, because the build cannot see it. When the
Vite plugin [splits the stylesheet per route](https://bamboocss.com/docs/installation/vite#per-route-stylesheets), it
keeps the atoms a `cx()` joins with an outside class in the entry sheet, so a class passed in from a lazily loaded route
loads after them. A template literal gets no such treatment, and which class applies can change with the route the
visitor opened first.

```jsx
// ⚠️ the same collision, and one the build cannot see
const Card = (props) => <div className={`${css({ padding: '4' })} ${props.className}`} />
```

## How to fix it

**Expose a variant for an override the caller chooses.** A recipe variant is a finite choice the compiler resolves into
one complete class, so the component's padding and the caller's never meet on one element:

```jsx
const card = cva({
  base: { padding: '4' },
  variants: { compact: { true: { padding: '2' } } },
})

const Card = ({ compact, ...rest }) => <div className={card({ compact })} {...rest} />
```

**Pass every style this file owns to `cx()` as a style call.** The compiler merges them per property before any class
exists, later arguments winning, and compiles a condition to one complete class per answer:

```jsx
const Card = ({ compact }) => <div className={cx(css({ padding: '4' }), compact && css({ padding: '2' }))} />
```

Accepting a style object instead of a class name, as in `css(base, props.css)`, does not help: an arbitrary runtime
object is not something the compiler can read.

## When not to use it

The rule only fires when one part of the join is styles this file wrote and another is a value it cannot see. Styles
this file wrote are a `css()` call or a `const` the file declares holding one, so `cx(styles, props.className)` is
reported wherever `styles` is declared, and a parameter named `styles` is not mistaken for it. A binding imported from
another module is not followed. Joining two of the file's own styles is not reported — `cx()` merges them. Neither is a
static marker class such as `'group'`, written as a string or as the text of a template literal, which carries no styles
to conflict with.

Recipe results are not reported either, though they collide the same way: a recipe compiles to the same `utilities`
atoms as `css()`, and no `recipes` layer is emitted for a caller's class to beat it from.
