---
name: bamboo-css-migrate
description: >-
  Move a project from Panda CSS to Bamboo CSS, or debug a project that built on Panda and fails on Bamboo. Use when
  replacing @pandacss/* packages with @bamboocss/*, renaming panda.config.ts, swapping Panda's PostCSS plugin for
  @bamboocss/vite, when the config fails because an option was removed or renamed (globalCss, themes, strictTokens,
  textStyles, jsxFramework, hooks), when styled-system/jsx, styled(), <Stack>, createStyleContext, template literal
  styles or {token} references stop working, when calls that worked in Panda fail with "could not be compiled", or when
  the CSS or class names change after the switch. Do not use for everyday styling (use bamboo-css) or for theme and
  recipe design (use bamboo-css-theming).
---

# Panda CSS → Bamboo CSS

Bamboo is a fork of Panda CSS v1. Style objects, recipes, patterns, conditions and tokens carry over, and most of the
move is renaming `panda` to `bamboo`. What breaks is what Bamboo removed (the JSX factory, template literals, some
config keys and patterns) and what it now refuses: every style call is compiled at build time, so a runtime value Panda
extracted, or silently dropped, fails the build with a reason.

The guide is [Migrating from Panda CSS](https://bamboocss.com/docs/migration/panda), raw markdown at
`https://bamboocss.com/docs/migration/panda.mdx`. This skill is the ordered path through it and the pages it links to.
Read the guide for detail.

## Before you start

- **Vite only.** `@bamboocss/vite` is Bamboo's only build integration, and PostCSS does not emit Bamboo CSS. If the
  project builds with anything else (webpack, Next.js, Panda's PostCSS plugin outside Vite), say so and stop: there is
  no supported path short of moving the build to Vite.
- **Node 22.12 or later**, on macOS, Linux (glibc or musl) or Windows, each on arm64 or x64. Extraction is a bundled
  native binary with no fallback; another architecture has none.
- **Panda version.** Bamboo forked 1.x, and the guide is written for it. It notes the Panda 2 APIs that differ:
  `firstThatWorks()` is `fallback()`, and `keyframes()` names its block by the stops in the order written. Report any
  other 2.x-only API you find rather than guessing an equivalent.
- **Inventory first.** Grep for `@pandacss/`, `panda.config`, `PANDA_DEBUG`, `styled-system/jsx`, `styled(`,
  `createStyleContext`, `splitCssProps`, template literals (`` css` ``, `` cva` ``), `{colors.` and other curly token
  references, `textStyle:`/`layerStyle:`/`animationStyle:`, `data-panda-theme`, and the removed patterns `stack`,
  `hstack`, `vstack`, `wrap`, `box`, `square`, `circle`, `cq`, `visuallyHidden`. The counts scope the work.

## Checklist

Work in order, and build after each group. Failures compound if you batch them.

**1. Swap the packages.** Remove `@pandacss/dev`, add `@bamboocss/dev` and `@bamboocss/vite`. Every other package moves
scope: `@pandacss/types` → `@bamboocss/types`, `@pandacss/preset-base` → `@bamboocss/preset-base`,
`@pandacss/eslint-plugin` → `@bamboocss/eslint-plugin`. Two are not a straight swap: `@pandacss/preset-panda` is
`@bamboocss/preset-bamboo`, and `@pandacss/preset-typography` is `typographyPreset()` from `@bamboocss/dev/presets`.

**2. Rename the config.** `panda.config.ts` becomes `bamboo.config.ts` (`.ts`, `.js`, `.mts` or `.mjs`; the old name is
not read), importing `defineConfig` from `@bamboocss/dev`.

**3. Fix `presets`.** Unset, it loads the defaults and there is nothing to do. Listed, it is now the complete list:
listing a preset no longer keeps `preset-base` underneath, so a renamed `['@bamboocss/preset-bamboo', myPreset]` loses
every utility, condition and pattern, and the config load warns that it did. Write
`presets: [...defaultPresets, myPreset]`, `defaultPresets` from `@bamboocss/dev/presets`. `eject: true` is
`presets: []`.

**4. Load the config and apply every edit it asks for.** Run `bamboo codegen`. A removed or renamed option fails with
the replacement, every one listed at once, whatever `validation` says:

| Panda                                                            | Bamboo                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `globalCss`, `globalFontface`, `globalVars`, `globalPositionTry` | `global: { css, fontface, vars, positionTry }`                          |
| `themes`                                                         | `theme.variants`, selected by `data-bamboo-theme`                       |
| `theme.textStyles`, `theme.layerStyles`, `theme.animationStyles` | `theme.mixins`; `textStyle: 'xl'` at a call site is `mixin: 'xl'`       |
| `strictTokens: true`                                             | `strictValues: true`, a build check; a raw value is written `'[14px]'`  |
| `hooks: { … }`                                                   | `plugins: [{ name: 'app', hooks: { … } }]`                              |
| `lightningcss: true`                                             | `plugins: [pluginLightningcss()]` from `@bamboocss/plugin-lightningcss` |
| a pattern's `strict` / `blocklist`                               | `cssProps`                                                              |
| `validation: 'none'`                                             | `validation: 'off'`                                                     |

Delete, with no replacement: `studio`, `jsxFramework`, `jsxFactory`, `jsxStyleProps`, `syntax`, `polyfill`,
`importMap.jsx`, and a pattern's `jsx`, `jsxName` and `jsxElement`. A token value written `{colors.red.300}` fails the
same way: write `token(colors.red.300)`, and drop the second argument of `token(path, fallback)`.

**5. Wire Vite.** Remove Panda's PostCSS plugin from the PostCSS config. Add `bamboocss()` from `@bamboocss/vite` to the
Vite plugins, `import 'virtual:bamboo.css'` once from the JS entry module, and
`/// <reference types="@bamboocss/vite/client" />`. Delete the `@layer reset, base, tokens, recipes, utilities;`
statement Panda needed; the stylesheet declares its own. Every framework's setup is in
`https://bamboocss.com/llms/installation.txt`.

**6. Scripts and environment.** The CLI is `bamboo` (`bamboocss` also works) and the commands keep their names:
`"prepare": "bamboo codegen"`. `PANDA_DEBUG` is `BAMBOO_DEBUG`. For an MCP client, `bamboo init-mcp` writes the config
for `@bamboocss/mcp`.

**7. Regenerate.** `rm -rf styled-system && bamboo codegen`, then restart the TypeScript server, which holds the old
types. The `styled-system` name and its `.gitignore` entry do not change.

**8. Rewrite what Bamboo does not have.**

- **The JSX factory.** `styled.div`, `styled('button', recipe)`, `<Box>`, style props and everything else from
  `styled-system/jsx` are gone. Style props become a `css()` call. A recipe component calls the recipe:

```tsx
// panda
const Button = styled('button', button)

// bamboo
const Button = (props: ButtonProps) => {
  const [variantProps, rest] = button.splitVariantProps(props)
  return <button {...rest} className={cx(button(variantProps), props.className)} />
}
```

- **Pattern components.** `<Stack gap="4">` becomes `<div className={flex({ direction: 'column', gap: '4' })}>`.
- **Removed patterns.** `stack` and `vstack` are `flex({ direction: 'column', … })`, `hstack` is
  `flex({ align: 'center', … })`, `wrap` is `flex({ wrap: 'wrap', … })`, `square` and `circle` are `center({ size })`
  (plus `borderRadius: 'full'`), `box(styles)` is `css(styles)`, `visuallyHidden()` is `css({ srOnly: true })`, and
  `cq()` is `css({ containerType: 'inline-size' })`. The old ones applied a gap silently; choose one.
- **`createStyleContext`.** A slot recipe returns a record of class strings: pass that record through an ordinary
  context. See `https://bamboocss.com/docs/concepts/slot-recipes.mdx`.
- **Template literals.** `` css`font-size: 24px;` `` becomes `css({ fontSize: '24px' })`; the same for `cva`, `sva` and
  patterns.
- **Arrays.** A responsive array, `fontSize: ['sm', 'lg']`, is an error: write `{ base: 'sm', sm: 'lg' }`. `css([a, b])`
  is `css(a, b)`.
- **Tokens in JavaScript.** `token(path)` now always returns the `var(--…)` reference, so Panda's `token.var(path)` is
  `token(path)`, and a call that needed the raw value (a canvas, a meta tag) is `token.value(path)`. Neither takes a
  fallback: `token(path) ?? '#fff'`. In a style value, `{colors.red.400}` is `token(colors.red.400)`.
- **Recipe members.** Besides being called, a recipe has `splitVariantProps`. `raw`, `variantMap`, `config`,
  `getVariantProps` and `merge` are gone; override with `cx(recipe(), css({ … }))`.
- **Themes in markup.** `data-panda-theme` is `data-bamboo-theme`, in CSS, tests and server-rendered HTML.

**9. Build, and fix what the compiler refuses.** `BAMBOO_DIAGNOSTIC_LIMIT=all vite build` lists every finding rather
than the first few. Each `dynamic` call is a runtime value Panda extracted optimistically or never styled at all:

- one of a known set of values: a recipe variant, compiled to a lookup;
- a ternary inside a value: a ternary between two complete `css()` calls;
- a continuous value (a width, an offset): the `style` attribute, or a CSS variable the compiled rule reads;
- a class assembled outside the source Bamboo reads: `staticCss`.

A responsive recipe selection, `button({ size: { base: 'sm', md: 'lg' } })`, is rejected: move the condition into the
variant's styles. A recipe read rather than called (aliased, passed on, put in context) is `runtime-binding`. Load the
`bamboo-css` skill for the whole contract.

**10. Tests.** A component's style calls have to pass through Vite to run; Jest without the plugin fails with "was not
compiled". Use a Vite-based runner such as Vitest with `bamboocss()`, over files inside `include`. Replace assertions on
class names: recipes no longer produce `button--size_sm`, and the atoms that replace them are opaque.

## If the CSS changed

These differences are deliberate. Check them before calling something a regression:

- **Recipes compile to shared atoms.** There is no `recipes` layer and no recipe class name. The layer order is
  `reset, base, tokens, utilities`.
- **Precedence lives in sublayers of `utilities`**, not in rule order. At the same condition a longhand beats its
  shorthand whatever the order, so an override that relied on coming later now has to set the same property.
- **`cx()`** merges calls the compiler can see before allocating classes, later wins, and merges a class it cannot see
  at runtime the same way when Bamboo named it. A hand-written class is only joined.
- **Utility class names carry a merge code**: `_`, six characters and `:` ahead of the readable name in development
  (`_AQSe3b:md:w_480px`), and ahead of a five-character hash when hashed (`_AQSe3b:h5u26`). A class name written by hand
  to match a utility has to spell the code too; it is the same for every value of one property under one set of
  conditions.
- **Breakpoints are range queries**, `@media (width >= 40rem)`, with no media type, so they also apply when printing.
- **Unused tokens and keyframes are pruned** from the stylesheet by default. A token read only from outside `include`
  needs `prune.keepTokens`.

## It's working if

- `vite build` passes with no config error and no "could not be compiled".
- Nothing imports `@pandacss/*` or `styled-system/jsx`, no `panda.config.*` remains, and no `{…}` token reference is
  left in config or styles.
- `presets` is unset or starts with `...defaultPresets`, and `_hover` and `bg` resolve.
- `bamboo doctor` exits 0.
- The CSS diff against the Panda build holds only the differences listed above.

## See also

- The full guide: [Migrating from Panda CSS](https://bamboocss.com/docs/migration/panda).
- Writing styles once the move is done: load the `bamboo-css` skill.
- Tokens, themes, mixins and recipe architecture: load the `bamboo-css-theming` skill.
