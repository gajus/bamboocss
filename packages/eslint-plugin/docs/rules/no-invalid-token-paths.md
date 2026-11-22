# Disallow token paths that name no token, in a `token()` reference or a `token()` call (`@bamboocss/no-invalid-token-paths`)

💼 This rule is enabled in the following configs: 🌐 `all`, ✅ `recommended`.

<!-- end auto-generated rule header -->

A token path that names no token fails the build — graded by the token half of
[`unresolvedToken`](https://bamboocss.com/docs/references/config#unresolvedtoken) — and this rule reports it where it is
written, in either of the two ways a style asks for a token.

A reference written in a value, `token(colors.nope)`, reaches the stylesheet as text instead of a variable, so the
declaration never takes a token's value. A value naming no token on a property that reads a token category,
`color: 'mutedd'`, is reported the same way, in the build's own sentence.

Only a style's value is judged. A recipe's call selects variants, so `link({ color: 'shark' })` names the `shark`
variant, not a colour, and the same goes for `defaultVariants` and a compound variant's conditions. A pattern's own prop
is the pattern's to map: `flex({ direction: 'column' })` is `flexDirection`, not CSS `direction`. A style handed to the
pattern beside them is judged as any other.

A call, `token('colors.nope')` or `token.value('colors.nope')`, returns `undefined`, so whatever reads it gets nothing:
in a style, the property is dropped and no rule is emitted for it. Calls are read off the build's own extraction, so a
path it resolves through a constant or a ternary is judged as the build judges it, a path it cannot read is left alone,
and the retired fallback argument after a path is not taken for one. A call whose result is tested or defaulted,
`token('colors.brand') ?? '#fff'`, handles a path naming nothing itself, and is not reported. As with
[`no-unresolved-styles`](./no-unresolved-styles.md), a file the config's `include` does not reach, one under `outdir`,
or one the build reads rewritten — a `.vue`, `.svelte` or `.astro` file — is not checked for calls.

## Examples

```ts
import { css } from '../styled-system/css'
import { token } from '../styled-system/tokens'

// `colors.nope` names no token: the border reaches the stylesheet without a colour.
export const card = css({ border: '1px solid token(colors.nope)' })

// Returns `undefined`, so `color` is dropped. Did you mean `token('colors.red.300')`?
export const accent = css({ color: token('red.300') })
```
