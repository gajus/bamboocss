---
name: bamboo-css-theming
description: >-
  Design the theme and component-style architecture of a Bamboo CSS project. Use when setting up or restructuring tokens
  and semantic tokens, adding brand colors, wiring dark mode or a color-mode toggle, shipping more than one theme with
  theme.variants, staticCss.themes, data-bamboo-theme or getTheme/injectTheme, choosing or writing presets
  (defaultPresets, typographyPreset, a shared preset), defining mixins, deciding between css(), cva, a config recipe and
  a slot recipe, designing a component's variant API, or cleaning up a theme that has drifted. Do not use for writing
  styles against a system that already exists (use bamboo-css), or for moving a project from Panda CSS (use
  bamboo-css-migrate).
---

# Bamboo CSS theming and system design

This is the architecture layer: what a token is called, which layer it lives in, and when a style graduates from a call
site to a recipe. These choices are hard to reverse once a codebase has a few hundred call sites.

Two questions answer most of it:

- **Does this value have meaning, or is it just a value?** Meaning goes in `semanticTokens`.
- **Does anyone outside this file need to vary it?** Then it is a recipe. Otherwise it is `css()`.

## Vocabulary

Bamboo's config keys are named after these words. A loose word turns into the wrong key later.

- **Primitive token**: a raw scale value in `theme.tokens`, named for what it is (`blue.500`, `spacing.4`).
- **Semantic token**: a value in `theme.semanticTokens`, named for its role (`fg.muted`, `danger`), free to differ per
  condition.
- **Mixin**: a named bundle of declarations in `theme.mixins`, applied with `css({ mixin: 'heading.h1' })`. It replaces
  Panda's text, layer and animation styles.
- **Recipe**: a component's styles and variants, from `cva` in a file or `theme.recipes` in config. A **slot recipe**
  (`sva`, `theme.slotRecipes`) styles several named parts, its **slots**. The slot list is the component's anatomy.
- **Variant axis**: one key under `variants`. A **compound variant** applies when several axes match at once.
- **Theme variant**: an alternative set of token values in `theme.variants`, selected by `data-bamboo-theme`.
- **Preset**: a shareable config listed in `presets`. Not a mixin, and not a theme.
- **Condition**: a state, selector or media key (`_hover`, `_dark`, `md`).

## Step 1: read what exists

1. `bamboo.config.ts`: `presets`, `theme` and whether it writes `extend`, `theme.variants`, `conditions`, `staticCss`,
   `strictValues`.
2. `<outdir>/tokens/tokens.d.ts`: every token path that resolves today.
3. The resolved system, not the config file, which does not show what presets added. `bamboo spec` writes
   `<outdir>/specs/`: tokens and semantic tokens with values and CSS variables, recipes with their variants, mixins,
   conditions and themes. With the MCP server configured, `get_tokens`, `get_semantic_tokens` and `get_recipes` answer
   the same from the live config.
4. `bamboo analyze --scope token` counts token usage, and `bamboo analyze --unused --scope token` lists tokens nothing
   uses.
5. Grep call sites for the property you are about to tokenize. Eight files writing `gray.600` for secondary text is the
   semantic token you are missing.

## Presets

An unset `presets` loads `defaultPresets`: `@bamboocss/preset-base` (utilities, conditions, patterns) and
`@bamboocss/preset-bamboo` (color, spacing, size, type, radius and shadow scales, breakpoints, keyframes, and the size
mixins `xs` to `9xl`). They define no semantic tokens; that layer is yours.

`presets` is the complete list, so add to the defaults rather than replacing them:

```ts
import { defineConfig } from '@bamboocss/dev'
import { defaultPresets, typographyPreset } from '@bamboocss/dev/presets'
import { brandPreset } from './brand-preset'

export default defineConfig({
  presets: [...defaultPresets, brandPreset, typographyPreset()],
})
```

- ❌ `presets: [brandPreset]` drops every utility, condition and pattern along with the default scales. `[]` loads
  nothing.
- A preset is `definePreset({ name: '…', theme: { … } })` from `@bamboocss/dev`, with a unique `name`.
- In the config, add through `theme.extend`. A `theme` key written without `extend` replaces what the presets defined
  there: `theme.tokens` alone discards every default token.
- `typographyPreset()` adds a `prose` recipe for HTML you do not write (Markdown, CMS, model output):
  `<article className={prose({ size: 'lg' })}>`, sizes `sm` to `2xl`, `md` by default. Its colors are `prose.*` semantic
  tokens built on `neutral`; override them in `semanticTokens`, or pass `{ semanticTokens: { colorPalette } }`. It is
  recent: check that `@bamboocss/dev/presets` exports it before relying on it.

## The token layers

Put a value in the highest layer that still describes it honestly. Recipes, the fourth layer, are below.

**1. Primitive tokens**, `theme.extend.tokens`. Full scales, named by what they are. Nothing in a primitive's name
mentions a component. The defaults already ship most scales; extend them.

**2. Semantic tokens**, `theme.extend.semanticTokens`. What a value means, and how it changes per condition.

```ts
import { defineConfig } from '@bamboocss/dev'

export default defineConfig({
  theme: {
    extend: {
      tokens: {
        colors: { brand: { 300: { value: '#93c5fd' }, 600: { value: '#2563eb' } } },
      },
      semanticTokens: {
        colors: {
          fg: {
            DEFAULT: { value: { base: 'token(colors.gray.900)', _dark: 'token(colors.gray.50)' } },
            muted: { value: { base: 'token(colors.gray.600)', _dark: 'token(colors.gray.400)' } },
          },
          accent: { value: { base: 'token(colors.brand.600)', _dark: 'token(colors.brand.300)' } },
          danger: { value: 'token(colors.red.600)' },
        },
      },
    },
  },
})
```

- Reference a token as `token(colors.gray.900)`. The curly form `{colors.gray.900}` and `token(path, fallback)` are
  retired: the config fails to load, naming each one and its replacement.
- Pair light and dark in the token. A component should never branch on `_dark` for a color the theme owns.
- A semantic token's conditions must be at-rules or parent selectors (`_dark`, `_osDark`, a theme condition), not states
  such as `_hover`. A token whose only condition is `_osDark` is emitted as one `light-dark()` declaration.
- `DEFAULT` names the bare path: `fg` and `fg.muted` above.
- Name by role: `fg.muted`, `bg.subtle`, `border`, `danger`. Not `gray600Text`, not `buttonBlue`. A value only one
  component uses belongs in its recipe until a second consumer appears.

**3. Mixins**, `theme.extend.mixins`. Three to five declarations that always travel together, under a name the team
already says out loud.

```ts
import { defineMixins } from '@bamboocss/dev'

export const mixins = defineMixins({
  heading: {
    DEFAULT: { value: { fontSize: '2xl', fontWeight: 'semibold', lineHeight: 'tight' } },
    h1: { value: { fontSize: '4xl', fontWeight: 'bold', lineHeight: 'tight' } },
  },
})
// css({ mixin: 'heading' }), css({ mixin: 'heading.h1' })
```

A mixin is the base of the style it is applied in, so the style's own properties override it wherever the `mixin` key is
written; list several to apply them in order, `mixin: ['heading', 'muted']`. If it needs variants, it is a recipe.

## Color mode and themes

- `_dark` is `.dark &`: a `dark` class on any ancestor, usually `<html>`. `_osDark` follows `prefers-color-scheme`.
  Toggle the class and every semantic token flips; no component knows it happened.
- To match an attribute as well: `conditions: { extend: { dark: '.dark &, [data-theme="dark"] &' } }`, then
  `bamboo codegen`.
- More than one look: `theme.variants` overrides token values behind `data-bamboo-theme`. Override roles, not scales,
  and give every value you override both modes.

```ts
export default defineConfig({
  theme: {
    variants: {
      ocean: {
        semanticTokens: {
          colors: { accent: { value: { base: 'token(colors.cyan.700)', _dark: 'token(colors.cyan.300)' } } },
        },
      },
    },
  },
  staticCss: { themes: ['ocean'] },
})
```

- A theme emits nothing until it is shipped. `staticCss.themes` writes it into the main stylesheet as
  `[data-bamboo-theme='ocean']` variables. On demand, `getTheme('ocean')` from `<outdir>/themes` loads it and
  `injectTheme(document.documentElement, theme)` sets the attribute and appends its `<style>`.
- Theme and color mode stack: `data-bamboo-theme` picks the theme, the `dark` class picks the mode inside it. A theme
  applies to the element carrying the attribute and everything under it.
- `defineThemeContract` from `@bamboocss/dev` makes every theme implement the same tokens.
- Deciding: one look in light and dark is semantic tokens alone. A few fixed brands is `theme.variants` with
  `staticCss.themes`. Many, or chosen by the user at runtime, is `getTheme` and `injectTheme`. A theme that overrides
  most of the token set means the semantic layer is too thin.

## When a style becomes a recipe

Climb one rung at a time, and only when the test passes.

1. **`css({ … })` at the call site.** Where everything starts.
2. **`cva` in the component file**, once the same style object appears in three places or the element has variants.
3. **A config recipe**, once consumers outside the file need the variants, or the styles belong to the design system:
   `defineRecipe` from `@bamboocss/dev`, registered under `theme.extend.recipes`, imported from `<outdir>/recipes` with
   a generated props type (`ButtonVariantProps` for `button`), and shareable through a preset.
4. **A slot recipe**, once the component renders several parts that each need styles: `sva` in the file, or
   `defineSlotRecipe` under `theme.extend.slotRecipes`.

Inline and config recipes compile to the same shared atoms, and both accept a finite selection made at runtime. Choose
by where the recipe has to live, not by what it emits. A config recipe for a style one file uses is indirection with a
typing cost.

### Slot recipes

Signals: you pass `className` down to inner elements, a nested selector reaches into a child, or two elements react to
the same variant differently. Name the slots before writing styles; the list is public API.

```ts
import { sva } from '../styled-system/css'

export const card = sva({
  slots: ['root', 'header', 'body'],
  base: {
    root: { rounded: 'lg', borderWidth: '1px', borderColor: 'gray.200' },
    header: { px: '4', py: '3', borderBottomWidth: '1px' },
    body: { p: '4' },
  },
  variants: {
    density: { comfortable: {}, compact: { header: { py: '2' }, body: { p: '2' } } },
  },
  defaultVariants: { density: 'comfortable' },
})
```

- A call returns one class string per slot: `card({ density }).header`. A compound component passes that record through
  an ordinary context, never the recipe itself, which is erased at build time.
- Generated classes carry no slot or recipe identity. Put `data-slot="header"` on a part that CSS or a test has to find.
- To convert a recipe: list the elements it renders, move each block of styles under its slot, then make each variant
  name the slots it touches.

## Designing the variant API

- Name axes by intent: `tone`, `size`, `density`. Not `isBlue`.
- Give every axis a `defaultVariants` entry. A call that passes nothing otherwise gets `base` alone.
- Boolean variants are `true` and `false` keys. Keep them for things that are really binary.
- Every axis selected at runtime multiplies the states the build compiles for that call, and past `maxRecipeStates`
  (65,536) the build fails. Keep axes few and independent.
- Compound variants are resolved into each leaf they match. If most cells of the matrix need one, the axes are wrong.
- A selection cannot be responsive. Put the condition in the variant's styles:
  `size: { sm: { fontSize: { base: 'sm', md: 'md' } } }`.
- One recipe for several palettes: `colorPalette: 'blue'` on the element or a variant, with `bg: 'colorPalette.600'` in
  the recipe.

## Anti-patterns

- **Primitives at every call site.** If forty files write `gray.600`, a rebrand is a find-and-replace.
- **Component names in global tokens.** `colors.buttonPrimary` means every future component invents its own.
- **A recipe re-declaring the theme's values** in its `base`: it is drifting from the scale.
- **Page layout inside a recipe.** Layout is `css()` and patterns.
- **`_dark` at call sites** for colors the theme owns.
- **Slots added defensively.** A slot nothing styles is API you have to keep.
- **`staticCss` to keep tokens alive.** It emits a rule per value; name them in `prune.keepTokens` instead.

## After changing the config

- `bamboo codegen`, so the types and the generated recipes exist for `tsc` and the editor. The Vite dev server restarts
  itself on a config edit.
- A removed or renamed option, or a retired token reference, fails with the edit to make. Make all of them.
- Unused tokens and keyframes are pruned from the stylesheet by default. A token read only from outside `include` needs
  `prune.keepTokens`.
- A token renamed out from under a call site fails the build as an unresolved token. Fix the call sites, not the check.

## It's working if

- A rebrand touches the config, not the call sites.
- `_dark` appears in `semanticTokens` and almost nowhere else.
- Toggling the `dark` class or `data-bamboo-theme` changes the page, and no component reads either.
- Every theme in `theme.variants` is in `staticCss.themes` or loaded through `getTheme`.
- Grepping a primitive such as `gray.600` across components finds close to nothing, and no token name contains a
  component name.
- Every slot has styles under it, and every axis has a default.
- `bamboo codegen` runs clean and `vite build` passes.

## See also

- Writing styles against the system you designed: load the `bamboo-css` skill.
- Moving a project from Panda CSS, including `textStyles` and `themes`: load the `bamboo-css-migrate` skill.
