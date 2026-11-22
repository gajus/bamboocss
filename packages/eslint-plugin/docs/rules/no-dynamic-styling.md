# Ensure users don't use dynamic styling. Prefer static styles, leverage CSS variables, or recipes for known dynamic styles (`@bamboocss/no-dynamic-styling`)

⚠️ This rule _warns_ in the following configs: 🌐 `all`, ✅ `recommended`.

<!-- end auto-generated rule header -->

Reports a style value that is not written out: a binding, a call, any expression but a literal. This is stricter than
the build, which also reads a constant, an import or a helper's result. What the build itself cannot read is what
[`no-unresolved-styles`](./no-unresolved-styles.md) reports, in the build's own words.

A choice between values written out is not reported where the compiler compiles one: in a `css()` call whose objects
have every key written out, beside other choices, inside another's answers, beside a spread or after another argument.
It compiles to the choices' tests picking one class string per combination of answers, so a test can read anything but a
Bamboo import or a recipe, which the compiled call no longer holds. Past 32 combinations a call is reported once, where
its first choice is written: make some of the choices variants of a recipe. A choice beside a computed key, a method or
a spread of a choice is reported, and so is one in a call spreading its arguments. A pattern, a recipe and `css.raw()`
compile no choice.

## Examples

```ts
import { css } from '../styled-system/css'

const tone = 'red.300'

// ⚠️ a binding: write the value out
export const a = css({ color: tone })

// ✅ one choice, compiled to `compact` choosing between two class strings
export const b = (compact: boolean) => css({ padding: compact ? '2' : '4' })

// ✅ choices in one call, compiled to one class string per combination of answers
export const c = (active: boolean, loud: boolean) =>
  css({ color: active ? 'white' : 'gray.700', bg: loud ? 'blue.500' : 'transparent' })

// ⚠️ a choice beside a computed key, which leaves the build unable to write out what each answer sets
export const d = (active: boolean, key: string) => css({ [key]: 'red.300', color: active ? 'white' : 'gray.700' })
```

See [dynamic styling](https://bamboocss.com/docs/guides/dynamic-styling).
