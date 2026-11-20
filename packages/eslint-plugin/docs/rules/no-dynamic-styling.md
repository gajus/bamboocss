# Ensure users don't use dynamic styling. Prefer static styles, leverage CSS variables, or recipes for known dynamic styles (`@bamboocss/no-dynamic-styling`)

⚠️ This rule _warns_ in the following configs: 🌐 `all`, ✅ `recommended`.

<!-- end auto-generated rule header -->

Reports a style value that is not written out: a binding, a call, any expression but a literal. This is stricter than
the build, which also reads a constant, an import or a helper's result. What the build itself cannot read is what
[`no-unresolved-styles`](./no-unresolved-styles.md) reports, in the build's own words.

A choice between values written out is not reported where the compiler compiles one: once per `css()` call that takes
one object with every key written out. It compiles to the choice's test picking one of two class strings, so the test
can read anything but a Bamboo import or a recipe, which the compiled call no longer holds. A second choice in the same
call is reported, and so is one beside a spread or a second argument: give it a `css()` call of its own, and `cx()`
composes the calls into every combination. A pattern, a recipe and `css.raw()` compile no choice.

## Examples

```ts
import { css, cx } from '../styled-system/css'

const tone = 'red.300'

// ⚠️ a binding: write the value out
export const a = css({ color: tone })

// ✅ one choice, compiled to `compact` choosing between two class strings
export const b = (compact: boolean) => css({ padding: compact ? '2' : '4' })

// ⚠️ a second choice in the same call, which the build does not compile
export const c = (active: boolean) =>
  css({ color: active ? 'white' : 'gray.700', bg: active ? 'blue.500' : 'transparent' })

// ✅ a call per choice, composed by cx()
export const d = (active: boolean) =>
  cx(css({ color: active ? 'white' : 'gray.700' }), css({ bg: active ? 'blue.500' : 'transparent' }))
```

See [dynamic styling](https://bamboocss.com/docs/guides/dynamic-styling).
