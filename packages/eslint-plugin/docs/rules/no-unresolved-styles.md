# Report styles the build cannot read, whose declarations never reach the stylesheet (`@bamboocss/no-unresolved-styles`)

⚠️ This rule _warns_ in the following configs: 🌐 `all`, ✅ `recommended`.

<!-- end auto-generated rule header -->

The build warns when it cannot read a style: a value known only at runtime, an object spread it cannot see into, an
argument it cannot evaluate at all. A `css()` or pattern call it cannot read does not compile, and the build fails at
it; a recipe's calls compile without the declarations its config does not let the build read. This rule reports the same
warnings where they are written, from the build's own extraction and in the build's own words — not a guess at what is
dynamic, as [`no-dynamic-styling`](./no-dynamic-styling.md) makes — so it reports exactly the styles the build drops.

No report for a file the config's `include` does not reach, which the build never reads; for one under `outdir`, which
the build does not warn about either; for a code block a processor such as `@eslint/markdown` lifts out of a document;
or for a file the build reads rewritten — a `.vue`, `.svelte` or `.astro` file, or one a plugin's `parser:before`
changes — whose positions are not the file's. A file that reaches bamboo only through `require()` or a re-export is not
checked. The editor's unsaved text is what is read, and only for the file being linted: another file importing it reads
what is on disk, as the build does.

## Examples

```ts
import { css, cva } from '../styled-system/css'

// `color` will not reach the stylesheet because its value could not be evaluated at build time.
export const tone = (color: string) => css({ color })

// An object spread or computed key leaves the build unable to tell which properties this call sets.
export const passthrough = (props: object) => css({ ...props })

// This argument will not reach the stylesheet because it is not statically known.
const pads = { sm: { px: '2' }, lg: { px: '6' } }
export const pad = (size: 'sm' | 'lg') => css(pads[size])

// The recipe's calls compile without `base.color`, and the element gets the rest of its styles.
export const card = (color: string) => cva({ base: { color } })
```

Write the value out, or choose between values written out with a ternary. A known set of values is a recipe variant, and
a value known only at runtime belongs in the `style` attribute, or in a CSS variable a declaration reads. See
[dynamic styling](https://bamboocss.com/docs/guides/dynamic-styling).
