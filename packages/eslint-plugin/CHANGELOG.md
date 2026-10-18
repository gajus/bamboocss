# @bamboocss/eslint-plugin

## 1.57.5

### Patch Changes

- Updated dependencies [9c45fc6]
  - @bamboocss/node@1.57.5
  - @bamboocss/config@1.57.5
  - @bamboocss/generator@1.57.5
  - @bamboocss/logger@1.57.5
  - @bamboocss/shared@1.57.5

## 1.57.4

### Patch Changes

- @bamboocss/config@1.57.4
- @bamboocss/generator@1.57.4
- @bamboocss/logger@1.57.4
- @bamboocss/node@1.57.4
- @bamboocss/shared@1.57.4

## 1.57.3

### Patch Changes

- Updated dependencies [b96f112]
- Updated dependencies [280c7e0]
  - @bamboocss/node@1.57.3
  - @bamboocss/config@1.57.3
  - @bamboocss/generator@1.57.3
  - @bamboocss/logger@1.57.3
  - @bamboocss/shared@1.57.3

## 1.57.2

### Patch Changes

- Updated dependencies [8b44d2b]
- Updated dependencies [8174af9]
  - @bamboocss/config@1.57.2
  - @bamboocss/node@1.57.2
  - @bamboocss/generator@1.57.2
  - @bamboocss/logger@1.57.2
  - @bamboocss/shared@1.57.2

## 1.57.1

### Patch Changes

- Updated dependencies [7c4cce6]
  - @bamboocss/node@1.57.1
  - @bamboocss/config@1.57.1
  - @bamboocss/generator@1.57.1
  - @bamboocss/logger@1.57.1
  - @bamboocss/shared@1.57.1

## 1.57.0

### Minor Changes

- 80c94d4: Add flat configs, `configs['flat/recommended']` and `configs['flat/all']`, for ESLint 9 and later.
  `configs.recommended` and `configs.all` are `.eslintrc` configs, which flat config refuses with
  `Key "parser": This appears to be in eslintrc format`; they are unchanged.

  ```js
  // eslint.config.js
  import bamboo from '@bamboocss/eslint-plugin'

  export default [bamboo.configs['flat/recommended']]
  ```

  - The flat configs name no parser and no `files`, so component files keep their own parser and ESLint lints no file it
    did not before. In a file ESLint lints as another language, such as CSS or JSON, the rules stand aside.
  - The plugin and its configs type-check as ESLint's `ESLint.Plugin` and `Linter.Config`, so an `eslint.config.ts`
    using them compiles. With `meta.namespace`, `defineConfig` can extend `<name>/flat/recommended` for the plugin
    registered under any name, and renames its rules to match.
  - The CommonJS and ES module builds give the same plugin, so a config importing one beside a shared config requiring
    the other no longer fails with `Cannot redefine plugin "bamboo"`.
  - `@bamboocss/configPath` reads the config file it names, relative to ESLint's working directory, and says so when it
    does not exist. It was only where the search for a `bamboo.config.*` began, so a file by another name was never
    read.
  - `@typescript-eslint/parser`, which the `.eslintrc` configs name, is an optional peer dependency, so a strict package
    manager can resolve it.
  - A linting guide documents the setup, the settings and the rules.

- 2ec456e: Add `prefer-token`, in `all`: a value written out that a token of the property's category holds —
  `padding: '1rem'` where `spacing.4` is `1rem` — with the token as the suggestion, each one when several hold it.
  - Only a value a token holds is reported, so the suggestion is always a token: a value no token holds — `0` — is
    nothing to report, and neither is a keyword or a name such as `currentColor` or `normal`, nor a value that already
    is a token's name.
  - The property is the one the value is for, however it is written: under a condition, per breakpoint, by its
    shorthand, or under a selector. A recipe's variant selections — its call's argument, `defaultVariants`, a compound
    variant's conditions — are left alone, since they name variants.
  - A value is compared as CSS reads it: `#FFF` and `#ffffff` are `#fff`, and `.25rem` is `0.25rem`. A keyframe's or a
    custom property's name keeps its case.

- f184b7b: Add `no-unresolved-styles`, in `recommended`: the build's warnings about styles it could not read, reported
  where they are written.

  ```ts
  // `color` will not reach the stylesheet because its value could not be evaluated at build time.
  export const tone = (color: string) => css({ color })
  ```

  - The build's own extraction and the build's own words — what is lost and what to do — so it reports the styles the
    build drops and none it reads, not a guess at what is dynamic, as `no-dynamic-styling` makes. Each loss names its
    path, so several in one call can be told apart, and a recipe's says to set `className`, since a recipe the build
    cannot fully read loses every style rather than the one.
  - No report for a file `include` does not reach, for one under `outdir`, for a processor's code block, or for a file
    the build reads rewritten — `.vue`, `.svelte`, `.astro`, or by a plugin's `parser:before` — whose positions are not
    the file's. A file with no bamboo import is not sent to the extractor at all.
  - The editor's unsaved text is read for the file being linted only: another file importing it reads what is on disk.
  - Every rule reads one context per config, prepared as the build prepares it, where the generator rules read their
    own: `include` is matched from the config's directory, so linting from a monorepo's root no longer reports
    `file-not-included` on every file of a project in it, and imports through the tsconfig's aliases count as bamboo's.
    A config the build cannot prepare — a tsconfig it cannot read — still answers the rules that read only the config,
    and one that fails to load, mid-edit, is loaded again once it changes rather than remembered as broken.
  - Nothing the plugin's worker logs reaches ESLint's output, where a line corrupted `--format json`.
  - `@bamboocss/node` exports `explainUnresolvedStyle`, the parts the build's warning is made of — the warning is
    unchanged — and makes `BambooContext.isGenerated` public.

### Patch Changes

- 4ea912c: Every published package declares the Node.js it runs on, `engines: { node: ">=22.12.0" }`, so a package
  manager and tooling can see it.
  - No package said, and the floor was its dependencies': the PostCSS plugins the stylesheet is optimized with take no
    release before 22, and Vite none before 22.12. Node 20 reached its end of life in April 2026.
  - tsdown builds for the version `engines` names. Every package's `dist` is the same, byte for byte.

- dd6c070: Read an important mark the way the stylesheet ends up holding it.
  - Any whitespace inside a mark counts, not only CSS's: the build writes each run of it as one space, so `!` and
    `important` with a no-break space between them reach the browser as an important declaration. Read as no mark, a
    value from the config — which reaches the class name sanitized and the stylesheet as written — named a class for an
    ordinary rule while the rule was written as an important one, and the element matched nothing. The class is now
    named from the same value the mark is read from. NUL beside the mark, which the build removes from a value, counts
    as whitespace too.
  - A comment around the mark is not read, as it was not before, though CSS reads one as whitespace: telling a comment's
    `/*` from one in a string or a `url()` is the tokenizer's job. Write the mark last: `red !important /* c */` is
    written as an ordinary declaration, and `no-important` does not report it. A value holding a comment it never closes
    is no CSS at all, and its rule is dropped whatever follows the `/*`.
  - An escape hatch is only brackets that are the whole value: `[a] 1fr [b!]` is two line names around a track, and its
    `!` is no mark. A fallback candidate that is an escape hatch holding the mark, `fallback([a!], b)`, marks the
    declaration, as `[a!]` alone does.
  - `no-important` reads a template literal as it cooks, as the build does, so `` `red\!` `` is reported and
    `` `foo\\!` `` is not. Its suggested fix is written back escaped the way the literal reads: `"\"hi\" !"` became
    `""hi""`, which does not parse, and `'a\\! !'` became `'a\!'`, a mark again. A carriage return in a template, a
    control character and half a surrogate pair are written back as escapes.

- 0cb809f: Only a trailing `!` or `!important` marks a declaration important. Any `!` in a value used to count, and was
  cut out of the value as it was marked:
  - `content: '"!"'` came out as `content: "" !important`, and `content: '"hello!"'` as `content: "hello" !important`.
  - `fontFamily: '"Foo!Bar", sans-serif'` lost its `!` and became important.
  - `<!--` in an SVG data URI became `<--`, which broke the image.

  A value whose `!` is part of it now keeps it, in the declaration and in its class name. Marks that end a value are all
  removed, so `red !important !important` no longer emits a doubled, invalid mark, and a mark ending a `fallback(...)`
  candidate still marks every candidate. The `no-important` lint rule now reads the keyword in any case, as the build
  does.

- 960ca70: Read `! important`, with whitespace inside the mark, as an important mark. The browser treats
  `color: 'red ! important'` as important either way, but the build wrote it as an ordinary declaration, so it was
  ordered and composed as something it was not. It is now the same atom as `red !important`.

  An escaped `\!` is not a mark either: `foo\!` is the identifier `foo!`, and `foo\!important` the identifier
  `foo!important`. Stripping the `!` as a mark left a backslash, which escaped the space written after it.

  The ESLint rule `no-important` names the mark it would remove, as it is written: the one the build reads, found where
  the build finds it. `content: '"!important" !'` was reported as using `!important`, which is part of the string.

- 49c7a7c: The published ES modules import Node's built-ins with the `node:` prefix, the only spelling Deno resolves.
  - Seventeen source files imported `fs`, `path`, `child_process` or `worker_threads` bare, and the built `dist` kept
    the specifier as written. So did the update notifier the CLI bundles.
  - A lint rule keeps a bare built-in out of each package's source.

- 77a276d: Whether a file is a source is answered as the source glob reads `include` and `exclude`.
  - A negated pattern in `include` — `['src/**/*.tsx', '!src/legacy/**']` — made every path a source wherever that was
    asked without the glob. The Vite compiler took each module it was handed for one, `node_modules` included, a file
    added anywhere in a dev session set off a scan of every source, and `bamboo --watch` rebuilt on any change. It now
    passes over what it names and nothing else, as the glob does; so does a negated pattern in `exclude`, which the glob
    reads without its `!`.
  - A folder named in `exclude` — `src/legacy`, `**/legacy` — is passed over whole below where the glob begins, as the
    glob passes over it; one named with a glob of its own, `src/legacy/*`, still passes over only what it matches. Its
    files were still taken for sources, so the compiler built classes from them that the stylesheet was never built
    from.
  - What `exclude` names is passed over inside a hidden folder `include` reaches, and each pattern is matched as its own
    walk spells a path — from `cwd`, or from the root for one written as an absolute path — so `**/*.tsx` no longer
    makes a file outside the project a source. A `.d.ts` added under a `dependencies` glob no longer reloads the config,
    since the glob that expands `dependencies` never reads it.
  - The ESLint plugin reads `include` the same way. `bamboo/file-not-included` now reports a file in a hidden folder —
    `.storybook/preview.tsx` — which the build's glob never enters, and the rules that check only what the build reads
    (`no-unresolved-styles`, `require-recipe-class-name`, `no-unlayered-override`, `no-config-function-in-source`) pass
    over it, as the build does.
  - Asked of a module, the answer costs much what it did, measured side by side: 0.41–0.46 µs for a source against
    0.37–0.41 µs, the same for a dependency, and 0.87–0.98 µs against 0.60–0.87 µs where `exclude` names a folder, which
    is now looked for.

- Updated dependencies [96d1679]
- Updated dependencies [f55d8e7]
- Updated dependencies [382e9d1]
- Updated dependencies [fce5d3a]
- Updated dependencies [4c0c5af]
- Updated dependencies [4ea912c]
- Updated dependencies [f184b7b]
- Updated dependencies [14569ac]
- Updated dependencies [faf921e]
- Updated dependencies [dd6c070]
- Updated dependencies [0cb809f]
- Updated dependencies [960ca70]
- Updated dependencies [61b3394]
- Updated dependencies [611d1bc]
- Updated dependencies [04f8720]
- Updated dependencies [5730bb3]
- Updated dependencies [a055085]
- Updated dependencies [49c7a7c]
- Updated dependencies [63336e0]
- Updated dependencies [697185e]
- Updated dependencies [e8cca66]
- Updated dependencies [f46e9f6]
- Updated dependencies [00076f6]
- Updated dependencies [77a276d]
- Updated dependencies [c58eea4]
- Updated dependencies [b38a97a]
- Updated dependencies [cab6edf]
- Updated dependencies [f9dbab9]
  - @bamboocss/node@1.57.0
  - @bamboocss/shared@1.57.0
  - @bamboocss/config@1.57.0
  - @bamboocss/generator@1.57.0
  - @bamboocss/logger@1.57.0

## 1.56.7

### Patch Changes

- @bamboocss/config@1.56.7
- @bamboocss/generator@1.56.7
- @bamboocss/shared@1.56.7

## 1.56.6

### Patch Changes

- @bamboocss/config@1.56.6
- @bamboocss/generator@1.56.6
- @bamboocss/shared@1.56.6

## 1.56.5

### Patch Changes

- @bamboocss/generator@1.56.5
- @bamboocss/config@1.56.5
- @bamboocss/shared@1.56.5

## 1.56.4

### Patch Changes

- @bamboocss/config@1.56.4
- @bamboocss/generator@1.56.4
- @bamboocss/shared@1.56.4

## 1.56.3

### Patch Changes

- @bamboocss/config@1.56.3
- @bamboocss/generator@1.56.3
- @bamboocss/shared@1.56.3

## 1.56.2

### Patch Changes

- @bamboocss/config@1.56.2
- @bamboocss/generator@1.56.2
- @bamboocss/shared@1.56.2

## 1.56.1

### Patch Changes

- @bamboocss/generator@1.56.1
- @bamboocss/config@1.56.1
- @bamboocss/shared@1.56.1

## 1.56.0

### Minor Changes

- 534ef89: Stop typing arrays as style values, and have `no-dynamic-styling` report them.

  Array values are no longer read as one value per breakpoint: the runtime throws `INVALID_STYLE_VALUE` and the compiler
  fails the build. `ConditionalValue` still admitted `Array<V | null>`, so `css({ fontWeight: ['bold', 'normal'] })`
  type-checked and then broke the build. The generated type is now the value or a condition object, so the mistake shows
  up in the editor instead.

  `no-dynamic-styling` used to accept an array of literals as static. It now reports any array value with the new
  `array` message, which points to the condition-object form: `{ base: 'medium', lg: 'bold' }`.

### Patch Changes

- Updated dependencies [534ef89]
- Updated dependencies [5624173]
- Updated dependencies [603d580]
- Updated dependencies [6f122c5]
  - @bamboocss/generator@1.56.0
  - @bamboocss/config@1.56.0
  - @bamboocss/shared@1.56.0

## 1.55.8

### Patch Changes

- @bamboocss/generator@1.55.8
- @bamboocss/config@1.55.8
- @bamboocss/shared@1.55.8

## 1.55.7

### Patch Changes

- @bamboocss/generator@1.55.7
- @bamboocss/config@1.55.7
- @bamboocss/shared@1.55.7

## 1.55.6

### Patch Changes

- @bamboocss/generator@1.55.6
- @bamboocss/config@1.55.6
- @bamboocss/shared@1.55.6

## 1.55.5

### Patch Changes

- Updated dependencies [8284292]
- Updated dependencies [8284292]
  - @bamboocss/shared@1.55.5
  - @bamboocss/config@1.55.5
  - @bamboocss/generator@1.55.5

## 1.55.4

### Patch Changes

- Updated dependencies [100becd]
  - @bamboocss/config@1.55.4
  - @bamboocss/generator@1.55.4
  - @bamboocss/shared@1.55.4

## 1.55.3

### Patch Changes

- @bamboocss/config@1.55.3
- @bamboocss/generator@1.55.3
- @bamboocss/shared@1.55.3

## 1.55.2

### Patch Changes

- @bamboocss/config@1.55.2
- @bamboocss/generator@1.55.2
- @bamboocss/shared@1.55.2

## 1.55.1

### Patch Changes

- @bamboocss/config@1.55.1
- @bamboocss/generator@1.55.1
- @bamboocss/shared@1.55.1

## 1.55.0

### Patch Changes

- @bamboocss/config@1.55.0
- @bamboocss/generator@1.55.0
- @bamboocss/shared@1.55.0

## 1.54.2

### Patch Changes

- @bamboocss/config@1.54.2
- @bamboocss/generator@1.54.2
- @bamboocss/shared@1.54.2

## 1.54.1

### Patch Changes

- Updated dependencies [b541413]
  - @bamboocss/generator@1.54.1
  - @bamboocss/config@1.54.1
  - @bamboocss/shared@1.54.1

## 1.54.0

### Patch Changes

- Updated dependencies [353392c]
- Updated dependencies [8ae0339]
  - @bamboocss/generator@1.54.0
  - @bamboocss/shared@1.54.0
  - @bamboocss/config@1.54.0

## 1.53.1

### Patch Changes

- Updated dependencies [bf68418]
  - @bamboocss/generator@1.53.1
  - @bamboocss/config@1.53.1
  - @bamboocss/shared@1.53.1

## 1.53.0

### Patch Changes

- @bamboocss/config@1.53.0
- @bamboocss/generator@1.53.0
- @bamboocss/shared@1.53.0

## 1.52.0

### Patch Changes

- @bamboocss/config@1.52.0
- @bamboocss/generator@1.52.0
- @bamboocss/shared@1.52.0

## 1.51.6

### Patch Changes

- @bamboocss/config@1.51.6
- @bamboocss/generator@1.51.6
- @bamboocss/shared@1.51.6

## 1.51.5

### Patch Changes

- @bamboocss/config@1.51.5
- @bamboocss/generator@1.51.5
- @bamboocss/shared@1.51.5

## 1.51.4

### Patch Changes

- @bamboocss/config@1.51.4
- @bamboocss/generator@1.51.4
- @bamboocss/shared@1.51.4

## 1.51.3

### Patch Changes

- @bamboocss/config@1.51.3
- @bamboocss/generator@1.51.3
- @bamboocss/shared@1.51.3

## 1.51.2

### Patch Changes

- @bamboocss/config@1.51.2
- @bamboocss/generator@1.51.2
- @bamboocss/shared@1.51.2

## 1.51.1

### Patch Changes

- @bamboocss/config@1.51.1
- @bamboocss/generator@1.51.1
- @bamboocss/shared@1.51.1

## 1.51.0

### Patch Changes

- @bamboocss/config@1.51.0
- @bamboocss/generator@1.51.0
- @bamboocss/shared@1.51.0

## 1.50.1

### Patch Changes

- @bamboocss/generator@1.50.1
- @bamboocss/config@1.50.1
- @bamboocss/shared@1.50.1

## 1.50.0

### Patch Changes

- Updated dependencies [950df68]
  - @bamboocss/shared@1.50.0
  - @bamboocss/generator@1.50.0
  - @bamboocss/config@1.50.0

## 1.49.0

### Patch Changes

- @bamboocss/config@1.49.0
- @bamboocss/generator@1.49.0
- @bamboocss/shared@1.49.0

## 1.48.5

### Patch Changes

- @bamboocss/config@1.48.5
- @bamboocss/generator@1.48.5
- @bamboocss/shared@1.48.5

## 1.48.4

### Patch Changes

- @bamboocss/config@1.48.4
- @bamboocss/generator@1.48.4
- @bamboocss/shared@1.48.4

## 1.48.3

### Patch Changes

- @bamboocss/config@1.48.3
- @bamboocss/generator@1.48.3
- @bamboocss/shared@1.48.3

## 1.48.2

### Patch Changes

- @bamboocss/config@1.48.2
- @bamboocss/generator@1.48.2
- @bamboocss/shared@1.48.2

## 1.48.1

### Patch Changes

- @bamboocss/config@1.48.1
- @bamboocss/generator@1.48.1
- @bamboocss/shared@1.48.1

## 1.48.0

### Patch Changes

- Updated dependencies [49839f1]
  - @bamboocss/generator@1.48.0
  - @bamboocss/shared@1.48.0
  - @bamboocss/config@1.48.0

## 1.47.0

### Patch Changes

- Updated dependencies [74f06ce]
- Updated dependencies [960d098]
  - @bamboocss/generator@1.47.0
  - @bamboocss/config@1.47.0
  - @bamboocss/shared@1.47.0

## 1.46.3

### Patch Changes

- @bamboocss/generator@1.46.3
- @bamboocss/config@1.46.3
- @bamboocss/shared@1.46.3

## 1.46.2

### Patch Changes

- @bamboocss/config@1.46.2
- @bamboocss/generator@1.46.2
- @bamboocss/shared@1.46.2

## 1.46.1

### Patch Changes

- @bamboocss/config@1.46.1
- @bamboocss/generator@1.46.1
- @bamboocss/shared@1.46.1

## 1.46.0

### Patch Changes

- @bamboocss/generator@1.46.0
- @bamboocss/config@1.46.0
- @bamboocss/shared@1.46.0

## 1.45.5

### Patch Changes

- @bamboocss/generator@1.45.5
- @bamboocss/config@1.45.5
- @bamboocss/shared@1.45.5

## 1.45.4

### Patch Changes

- Updated dependencies [c49c838]
  - @bamboocss/generator@1.45.4
  - @bamboocss/config@1.45.4
  - @bamboocss/shared@1.45.4

## 1.45.3

### Patch Changes

- @bamboocss/config@1.45.3
- @bamboocss/generator@1.45.3
- @bamboocss/shared@1.45.3

## 1.45.2

### Patch Changes

- @bamboocss/generator@1.45.2
- @bamboocss/config@1.45.2
- @bamboocss/shared@1.45.2

## 1.45.1

### Patch Changes

- @bamboocss/config@1.45.1
- @bamboocss/generator@1.45.1
- @bamboocss/shared@1.45.1

## 1.45.0

### Minor Changes

- 8bfae14: New rule: `no-redundant-value`, reporting an edge or pair value written longer than it needs to be.

  Bamboo names an atomic class from the value as written, so two spellings of the same value are two classes and two
  rules. A production build measured for this carried one padding as `16px`, `16px 16px` and `16px 16px 0 16px`, and one
  box-shadow written four ways — 304 groups of atoms emitting byte-identical declarations, about 1.6% of the stylesheet
  under brotli.

  The rule covers the two families where CSS defines the omitted values as copies of the ones given: edge properties
  (`padding`, `margin`, `inset`, `borderWidth`, `borderColor`, `borderStyle`, `scrollMargin`, `scrollPadding`, and
  Bamboo's `p` and `m`) and pair properties (`gap`, `gridGap`, `overflow`, `overscrollBehavior`). A zero length is
  normalised first, since `0px` and `0` are otherwise two atoms — that alone quadrupled what the rule catches.

  It is an allowlist rather than a test on the shape of the value, because the shape is not enough to know a collapse is
  sound: `backgroundPosition: '0 0'` is left-top while `'0'` is left-centre, which is the same shape and a different
  element position. Values are split with parentheses respected, so `calc(1rem + 2px) calc(1rem + 2px)` reads as two
  identical edges; an unbalanced parenthesis declines.

  Autofixing, and the only rule in this plugin that is — every other one reports a preference and leaves the edit to the
  reader, whereas the two spellings here compute to the same thing. It is left out of `recommended` all the same:
  nothing renders wrongly, so this is cleanup rather than a defect. Every fix is asserted to be a fixed point, since
  `--fix` reruns until the source stops changing and a collapse that re-reported would loop.

  Measured against the build it was written from, it unifies 24 of those 304 groups. The larger remainder is a design
  token spelled against its own literal — `p: '4'` beside `p: '4px'` — which wants its own rule alongside
  `no-hardcoded-color`, since the advice there is "use the token" rather than "this is redundant".

### Patch Changes

- @bamboocss/config@1.45.0
- @bamboocss/generator@1.45.0
- @bamboocss/shared@1.45.0

## 1.44.1

### Patch Changes

- @bamboocss/config@1.44.1
- @bamboocss/generator@1.44.1
- @bamboocss/shared@1.44.1

## 1.44.0

### Patch Changes

- Updated dependencies [78b4de5]
  - @bamboocss/config@1.44.0
  - @bamboocss/generator@1.44.0
  - @bamboocss/shared@1.44.0

## 1.43.1

### Patch Changes

- @bamboocss/generator@1.43.1
- @bamboocss/config@1.43.1
- @bamboocss/shared@1.43.1

## 1.43.0

### Patch Changes

- Updated dependencies [1cef86c]
  - @bamboocss/generator@1.43.0
  - @bamboocss/config@1.43.0
  - @bamboocss/shared@1.43.0

## 1.42.0

### Minor Changes

- 7f7b249: `no-invalid-token-paths` now reports what the build reports, in the editor.

  Deleting the type-level narrowing took the red squiggle with it: `css({ color: 'mutedd' })` was a type error, and is
  now a build warning you see when you build. This closes that, by asking the resolver the same question rather than
  reimplementing it — the rule prints the build's own sentence, so the two cannot describe one mistake differently.

  ```ts
  css({ color: 'mutedd' }) //               reported
  css({ display: 'flexx' }) //              reported
  css({ top: 'navH' }) //                   reported, and says `navH` is a `sizes` token

  css({ display: 'flex' }) //               fine
  css({ animationName: 'fadeIn' }) //       fine
  css({ transitionProperty: 'color' }) //   fine
  css({ color: 'currentcolor' }) //         fine
  ```

  The existing check is kept alongside rather than replaced. It reads `token(…)` references out of a composite value —
  `token(sizes.4000) 20px` — where the value as a whole is ordinary CSS; the new one judges the value as a whole against
  its property, which is the only way a value with no dot in it is decidable at all. Neither subsumes the other.

  Nothing to configure: the rule was already on in the recommended set.

### Patch Changes

- Updated dependencies [6fa8d1a]
- Updated dependencies [b078253]
- Updated dependencies [5c33622]
- Updated dependencies [0ca4f32]
  - @bamboocss/generator@1.42.0
  - @bamboocss/config@1.42.0
  - @bamboocss/shared@1.42.0

## 1.41.1

### Patch Changes

- Updated dependencies [3b91dce]
  - @bamboocss/generator@1.41.1
  - @bamboocss/config@1.41.1
  - @bamboocss/shared@1.41.1

## 1.41.0

### Patch Changes

- Updated dependencies [9b15513]
  - @bamboocss/generator@1.41.0
  - @bamboocss/config@1.41.0
  - @bamboocss/shared@1.41.0

## 1.40.1

### Patch Changes

- @bamboocss/config@1.40.1
- @bamboocss/generator@1.40.1
- @bamboocss/shared@1.40.1

## 1.40.0

### Patch Changes

- Updated dependencies [3151b14]
- Updated dependencies [21fdf4c]
  - @bamboocss/config@1.40.0
  - @bamboocss/generator@1.40.0
  - @bamboocss/shared@1.40.0

## 1.39.1

### Patch Changes

- Updated dependencies [4734709]
  - @bamboocss/shared@1.39.1
  - @bamboocss/config@1.39.1
  - @bamboocss/generator@1.39.1

## 1.39.0

### Minor Changes

- ff9b74e: Say what decides between two `css()` calls, and add `no-descendant-selectors` to report the case that
  surprises people.

  Layers decide between rules in different layers. Two `css()` calls are always in the same one, where nothing has
  changed about CSS: specificity decides. A nested selector is more specific than a class, so `css({ '& p': … })` on an
  article outranks a `css()` applied to a paragraph inside it — the class is on the element, and the value that applies
  is the other one. Nothing reports it, and the docs' emphasis on layers reads as though it could not happen.

  The new rule reports a nested selector whose subject is not `&`, which is exactly the shape that reaches another
  element. `'.dark &'` and `'.group:hover &'` are not reported: they contain a combinator and still style the element
  itself, which is what conditions compile to. It warns in the `all` config and is off in `recommended`, since content
  whose markup you do not write — rendered markdown, a CMS body — has no other way to be styled.

  `no-unlayered-override` no longer presents a build-specific fix as a general one. Its advice to move component styles
  into `cva` assumed a `recipes` layer, which the Vite compiler does not emit — it resolves recipe selections into the
  same `utilities` atoms `css()` uses. Accepting a style object is the fix that holds either way, so that one is named
  first and the recipe one says which path it applies to.

### Patch Changes

- Updated dependencies [4d27ba4]
  - @bamboocss/generator@1.39.0
  - @bamboocss/config@1.39.0
  - @bamboocss/shared@1.39.0

## 1.38.0

### Patch Changes

- @bamboocss/config@1.38.0
- @bamboocss/generator@1.38.0
- @bamboocss/shared@1.38.0

## 1.37.13

### Patch Changes

- @bamboocss/config@1.37.13
- @bamboocss/generator@1.37.13
- @bamboocss/shared@1.37.13

## 1.37.12

### Patch Changes

- @bamboocss/config@1.37.12
- @bamboocss/generator@1.37.12
- @bamboocss/shared@1.37.12

## 1.37.11

### Patch Changes

- @bamboocss/config@1.37.11
- @bamboocss/generator@1.37.11
- @bamboocss/shared@1.37.11

## 1.37.10

### Patch Changes

- @bamboocss/config@1.37.10
- @bamboocss/generator@1.37.10
- @bamboocss/shared@1.37.10

## 1.37.9

### Patch Changes

- @bamboocss/config@1.37.9
- @bamboocss/generator@1.37.9
- @bamboocss/shared@1.37.9

## 1.37.8

### Patch Changes

- @bamboocss/config@1.37.8
- @bamboocss/generator@1.37.8
- @bamboocss/shared@1.37.8

## 1.37.7

### Patch Changes

- @bamboocss/config@1.37.7
- @bamboocss/generator@1.37.7
- @bamboocss/shared@1.37.7

## 1.37.6

### Patch Changes

- @bamboocss/config@1.37.6
- @bamboocss/generator@1.37.6
- @bamboocss/shared@1.37.6

## 1.37.5

### Patch Changes

- @bamboocss/config@1.37.5
- @bamboocss/generator@1.37.5
- @bamboocss/shared@1.37.5

## 1.37.4

### Patch Changes

- @bamboocss/config@1.37.4
- @bamboocss/generator@1.37.4
- @bamboocss/shared@1.37.4

## 1.37.3

### Patch Changes

- @bamboocss/config@1.37.3
- @bamboocss/generator@1.37.3
- @bamboocss/shared@1.37.3

## 1.37.2

### Patch Changes

- @bamboocss/config@1.37.2
- @bamboocss/generator@1.37.2
- @bamboocss/shared@1.37.2

## 1.37.1

### Patch Changes

- @bamboocss/config@1.37.1
- @bamboocss/generator@1.37.1
- @bamboocss/shared@1.37.1

## 1.37.0

### Patch Changes

- @bamboocss/config@1.37.0
- @bamboocss/generator@1.37.0
- @bamboocss/shared@1.37.0

## 1.36.5

### Patch Changes

- @bamboocss/config@1.36.5
- @bamboocss/generator@1.36.5
- @bamboocss/shared@1.36.5

## 1.36.4

### Patch Changes

- @bamboocss/config@1.36.4
- @bamboocss/generator@1.36.4
- @bamboocss/shared@1.36.4

## 1.36.3

### Patch Changes

- @bamboocss/config@1.36.3
- @bamboocss/generator@1.36.3
- @bamboocss/shared@1.36.3

## 1.36.2

### Patch Changes

- @bamboocss/config@1.36.2
- @bamboocss/generator@1.36.2
- @bamboocss/shared@1.36.2

## 1.36.1

### Patch Changes

- @bamboocss/config@1.36.1
- @bamboocss/generator@1.36.1
- @bamboocss/shared@1.36.1

## 1.36.0

### Patch Changes

- @bamboocss/config@1.36.0
- @bamboocss/generator@1.36.0
- @bamboocss/shared@1.36.0

## 1.35.5

### Patch Changes

- @bamboocss/config@1.35.5
- @bamboocss/generator@1.35.5
- @bamboocss/shared@1.35.5

## 1.35.4

### Patch Changes

- @bamboocss/config@1.35.4
- @bamboocss/generator@1.35.4
- @bamboocss/shared@1.35.4

## 1.35.3

### Patch Changes

- @bamboocss/config@1.35.3
- @bamboocss/generator@1.35.3
- @bamboocss/shared@1.35.3

## 1.35.2

### Patch Changes

- Updated dependencies [eb3025a]
  - @bamboocss/shared@1.35.2
  - @bamboocss/config@1.35.2
  - @bamboocss/generator@1.35.2

## 1.35.1

### Patch Changes

- @bamboocss/config@1.35.1
- @bamboocss/generator@1.35.1
- @bamboocss/shared@1.35.1

## 1.35.0

### Patch Changes

- Updated dependencies [9bfcf31]
  - @bamboocss/generator@1.35.0
  - @bamboocss/config@1.35.0
  - @bamboocss/shared@1.35.0

## 1.34.1

### Patch Changes

- Updated dependencies [e2ec2ae]
  - @bamboocss/generator@1.34.1
  - @bamboocss/config@1.34.1
  - @bamboocss/shared@1.34.1

## 1.34.0

### Patch Changes

- Updated dependencies [c49ab36]
- Updated dependencies [c527ea7]
- Updated dependencies [10bf63d]
- Updated dependencies [c49ab36]
- Updated dependencies [c49ab36]
- Updated dependencies [c527ea7]
  - @bamboocss/shared@1.34.0
  - @bamboocss/generator@1.34.0
  - @bamboocss/config@1.34.0

## 1.33.0

### Patch Changes

- Updated dependencies [f7bbc14]
  - @bamboocss/config@1.33.0
  - @bamboocss/generator@1.33.0
  - @bamboocss/shared@1.33.0

## 1.32.0

### Minor Changes

- f3a8b0d: Remove `defineParts`, leaving one way to model a multi-part component.

  A slot recipe is that way. Where you wanted the other thing `defineParts` offered — a single class on the root that
  reaches its children, so there is nothing to bind — that was never an API, only an object whose keys are selectors:

  ```ts
  defineRecipe({
    className: 'checkbox',
    base: {
      '& [data-part="root"]': {
        display: 'flex',
        alignItems: 'center',
        gap: '2',
      },
      '& [data-part="control"]': { borderWidth: '1px', borderRadius: 'sm' },
    },
  })
  ```

  `defineParts` only keyed that object by part name instead. It earned its place when the selectors came from a Zag or
  Ark `anatomy` and were tedious to spell out — `&[data-scope="card"][data-part="root"], & [data-scope=…]` per part.
  That case is still real, and still a few lines that belong in your codebase rather than in the framework:

  ```ts
  const toParts =
    <T extends Record<string, { selector: string }>>(anatomy: T) =>
    (config: Partial<Record<keyof T, SystemStyleObject>>): SystemStyleObject =>
      Object.fromEntries(Object.entries(config).map(([part, styles]) => [anatomy[part].selector, styles]))
  ```

  The `Part` and `Parts` types go with it, as does the `defineParts` declaration in the generated `styled-system/types`.

  `no-config-function-in-source` also picks up `defineMixins` and drops `defineLayerStyles` and `defineTextStyles`,
  which the preceding mixins change had left behind — writing `defineMixins` in a source file was not being flagged.

### Patch Changes

- Updated dependencies [c29044f]
- Updated dependencies [b0ed6dc]
- Updated dependencies [8a66bb9]
- Updated dependencies [2b84dfa]
- Updated dependencies [da792cc]
- Updated dependencies [1cc1860]
- Updated dependencies [b2b4173]
- Updated dependencies [f3a8b0d]
- Updated dependencies [c29044f]
  - @bamboocss/shared@1.32.0
  - @bamboocss/config@1.32.0
  - @bamboocss/generator@1.32.0

## 1.31.0

### Minor Changes

- 9fdce28: One way to reference a token from a string: `token(colors.red.300)`. The curly form is gone.

  ```ts
  // before — both worked, and meant the same thing
  css({ color: '{colors.red.300}' })
  css({ color: 'token(colors.red.300)' })

  // after
  css({ color: 'token(colors.red.300)' })
  ```

  The same everywhere a reference can appear: theme and semantic token values, conditions, media queries, style values.

  `token()` was kept rather than `{…}` because it is the readable one — it reads as what it is, it can be searched for,
  and it is already the name of the javascript api that does the same job. Keeping braces would have left the concept
  with two names, one of which is punctuation.

  It also had a hole that made the choice easy: in a theme or semantic token value, `token(colors.red.300)` was never
  expanded at all. It landed in the emitted stylesheet as literal text — invalid css, no warning. That is fixed. The
  fallback form in a theme value, `token(colors.red.300, blue)`, is still not expanded; that is unchanged by this
  release and remains a known gap.

  **Upgrading.** A curly reference left behind does not fail loudly. In a style value the declaration is dropped; in a
  theme value the literal text is emitted. Nothing warns, and config validation cannot report it either, since it is no
  longer a reference to check. Search your config and styles for `{` followed by a token path.

  Emitted css does not change. What changes is that a class name derived from a value containing a reference now spells
  it `token(…)`, since class names encode the value as authored. Verified byte-identical on two real projects, one of
  them a theme with 39 references.

  Token pruning had to be taught the difference between the two things now spelled `token(`. The gate that decides
  whether javascript can reach a token is a text scan, and a reference inside a css value —
  `css({ border: '1px solid token(colors.red.300)' })` — is not javascript reaching a token. Reading it as one turned
  pruning off wholesale, which measured 3.2x the stylesheet on a sandbox: 246 colour declarations where 11 were used. A
  `token(` that survives blanking every string literal is a call; one that does not was written inside a string.

  Config validation understands the new spelling too. It carries its own copy of the reference regex, because it is the
  thing that reports a missing or circular reference — a spelling only the dictionary understood would have been silence
  rather than an error.

  The fallback form is otherwise unchanged: `token(spacing.4, 4)` still means "this token, or this literal if there is
  no such token", which is how the `bleed`, `divider` and `container` patterns accept either a token name or a raw css
  value.

### Patch Changes

- Updated dependencies [8fb87ac]
- Updated dependencies [8fb87ac]
- Updated dependencies [8fb87ac]
- Updated dependencies [cd5954c]
- Updated dependencies [9c32b00]
- Updated dependencies [9fdce28]
- Updated dependencies [725223e]
- Updated dependencies [678bdee]
- Updated dependencies [a72eb09]
  - @bamboocss/config@1.31.0
  - @bamboocss/generator@1.31.0
  - @bamboocss/shared@1.31.0

## 1.30.1

### Patch Changes

- @bamboocss/config@1.30.1
- @bamboocss/generator@1.30.1
- @bamboocss/shared@1.30.1

## 1.30.0

### Minor Changes

- f9901f7: Add a `require-literal-token-path` rule.

  `token()` returns a css variable reference for every token, so a path the build cannot read could name any of them and
  every token declaration has to be kept — on the default preset, the difference between one declaration and several
  hundred. `pruneUnusedTokens` already reports this, and `pruneUnusedTokens: 'strict'` fails the build on it; the rule
  brings the finding forward to the call site, and fires whatever the flag is set to.

  It reads call sites, so it does not replace the build's check: a binding that escapes one — `const t = token`, a
  default import, `[token].map(…)` — is declined by the build and invisible here. A clean lint run is not a promise that
  `strict` will pass.

  Two messages, because the cases differ. A path with nothing knowable about it keeps everything. A template with a
  static head — ``token(`colors.${shade}`)`` — is bounded to that category, which is often what you want, so it is
  reported more mildly.

  Not in `recommended`: reaching for tokens dynamically is supported, and a docs site or theme browser will trip it on
  every call with no rewrite available. It is a size trade rather than a mistake.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies [242b24c]
  - @bamboocss/generator@1.30.0
  - @bamboocss/shared@1.30.0
  - @bamboocss/config@1.30.0

## 1.29.0

### Patch Changes

- Updated dependencies [f2c61d7]
- Updated dependencies [6114f6e]
- Updated dependencies [38393c4]
  - @bamboocss/generator@1.29.0
  - @bamboocss/config@1.29.0
  - @bamboocss/shared@1.29.0

## 1.28.1

### Patch Changes

- @bamboocss/config@1.28.1
- @bamboocss/generator@1.28.1
- @bamboocss/shared@1.28.1

## 1.28.0

### Patch Changes

- @bamboocss/config@1.28.0
- @bamboocss/generator@1.28.0
- @bamboocss/shared@1.28.0

## 1.27.0

### Patch Changes

- Updated dependencies [b975ba7]
  - @bamboocss/generator@1.27.0
  - @bamboocss/config@1.27.0
  - @bamboocss/shared@1.27.0

## 1.26.0

### Patch Changes

- @bamboocss/config@1.26.0
- @bamboocss/generator@1.26.0
- @bamboocss/shared@1.26.0

## 1.25.0

### Patch Changes

- Updated dependencies [94991ea]
  - @bamboocss/generator@1.25.0
  - @bamboocss/config@1.25.0
  - @bamboocss/shared@1.25.0

## 1.24.0

### Patch Changes

- @bamboocss/config@1.24.0
- @bamboocss/generator@1.24.0
- @bamboocss/shared@1.24.0

## 1.23.0

### Patch Changes

- Updated dependencies [087b884]
- Updated dependencies [3d141e5]
  - @bamboocss/generator@1.23.0
  - @bamboocss/shared@1.23.0
  - @bamboocss/config@1.23.0

## 1.22.0

### Patch Changes

- Updated dependencies [39c699f]
- Updated dependencies [41d9052]
- Updated dependencies [a1062c9]
- Updated dependencies [43ae8a7]
  - @bamboocss/generator@1.22.0
  - @bamboocss/shared@1.22.0
  - @bamboocss/config@1.22.0

## 1.21.0

### Patch Changes

- Updated dependencies [81f8789]
  - @bamboocss/shared@1.21.0
  - @bamboocss/generator@1.21.0
  - @bamboocss/config@1.21.0

## 1.20.4

### Patch Changes

- Updated dependencies [1f94d5a]
  - @bamboocss/generator@1.20.4
  - @bamboocss/config@1.20.4
  - @bamboocss/shared@1.20.4

## 1.20.3

### Patch Changes

- @bamboocss/generator@1.20.3
- @bamboocss/config@1.20.3
- @bamboocss/shared@1.20.3

## 1.20.2

### Patch Changes

- @bamboocss/config@1.20.2
- @bamboocss/generator@1.20.2
- @bamboocss/shared@1.20.2

## 1.20.1

### Patch Changes

- @bamboocss/config@1.20.1
- @bamboocss/generator@1.20.1
- @bamboocss/shared@1.20.1

## 1.20.0

### Patch Changes

- Updated dependencies [15e2d53]
- Updated dependencies [6512d6b]
- Updated dependencies [5d2c91c]
- Updated dependencies [10d7c9b]
- Updated dependencies [aa0f641]
- Updated dependencies [0e2cb31]
  - @bamboocss/generator@1.20.0
  - @bamboocss/shared@1.20.0
  - @bamboocss/config@1.20.0

## 1.19.0

### Patch Changes

- Updated dependencies [510cdd3]
  - @bamboocss/generator@1.19.0
  - @bamboocss/config@1.19.0
  - @bamboocss/shared@1.19.0

## 1.18.0

### Patch Changes

- Updated dependencies [21c6daa]
  - @bamboocss/shared@1.18.0
  - @bamboocss/generator@1.18.0
  - @bamboocss/config@1.18.0

## 1.17.3

### Patch Changes

- @bamboocss/config@1.17.3
- @bamboocss/generator@1.17.3
- @bamboocss/shared@1.17.3

## 1.17.2

### Patch Changes

- @bamboocss/config@1.17.2
- @bamboocss/generator@1.17.2
- @bamboocss/shared@1.17.2

## 1.17.1

### Patch Changes

- Updated dependencies [fc381ca]
  - @bamboocss/shared@1.17.1
  - @bamboocss/generator@1.17.1
  - @bamboocss/config@1.17.1

## 1.17.0

### Minor Changes

- b1f94f7: Add `require-recipe-class-name`, warning on a recipe whose class names depend on what the build could read.

  A `cva`/`sva` with no `className` is named by hashing its config, and that name is derived twice — the build hashes
  the config it could **read**, the browser hashes the one it **holds**. Anything the build cannot resolve makes those
  two objects differ, so the element carries classes no rule was emitted under and renders with no styles at all.

  ```jsx
  // ⚠️ the build cannot resolve the spread, so it hashes a different object
  const button = cva({ base: { ...getFocusRingStyles(), padding: '4' } })

  // ✅ the identity short-circuits on the name and never hashes the styles
  const button = cva({
    className: 'button',
    base: { ...getFocusRingStyles(), padding: '4' },
  })
  ```

  Naming the recipe removes the failure rather than banning the pattern: a declaration the build could not read then
  costs only itself, which is what it cost before recipes were named semantically. Readable class names come with it.

  `mode: 'dynamic-only'` — what `recommended` enables — narrows it to configs that are not plain static literals, which
  is where the divergence is possible. `mode: 'always'` requires a name everywhere.

  This is the editor-time half of the build warning for an unreadable recipe config. It needs no extraction, so it fires
  before a build runs and catches shapes the build check cannot see.

### Patch Changes

- Updated dependencies [3cdd0d1]
- Updated dependencies [29f9bbe]
- Updated dependencies [28463ce]
- Updated dependencies [6577023]
- Updated dependencies [d5347ab]
- Updated dependencies [c6154dc]
  - @bamboocss/generator@1.17.0
  - @bamboocss/shared@1.17.0
  - @bamboocss/config@1.17.0

## 1.16.1

### Patch Changes

- @bamboocss/config@1.16.1
- @bamboocss/generator@1.16.1
- @bamboocss/shared@1.16.1

## 1.16.0

### Minor Changes

- 091f2e1: **Breaking:** an inline `cva()`/`sva()` now emits the same kind of CSS as a recipe declared in
  `theme.recipes` — one class per variant, in the `recipes` cascade layer — instead of atomic classes in `utilities`.

  An inline recipe and a config recipe were the same declaration, evaluated by the same code, that produced different
  naming, a different layer and different override behaviour. Nothing about the two justified that: a config recipe is
  an inline one that happens to be declared somewhere with a name.

  ```js
  cva({
    base: { padding: '4' },
    variants: { size: { sm: { fontSize: 'sm' } } },
  })
  // before: 'p_4'                    in @layer utilities
  // now:    'cva_a1b2c3'             in @layer recipes
  //         'cva_a1b2c3--size_sm'    when size="sm"
  ```

  Three things follow.

  **A component written with `cva` is now reliably overridable.** Its classes are in `recipes`, so a consumer's `css()`
  in `utilities` wins by cascade layer in every build, without the consumer knowing how the component was declared. That
  was previously true only if you hoisted the styles into `theme.recipes`.

  **`cssMode: 'grouped'` no longer has an exception.** Recipes were extracted atomically whatever `cssMode` said,
  because a group class names a whole call and which variant combination a caller selects is not knowable at build time.
  That forced a second `css` instance — the internal `__atomicCss` — purely so their runtime could name classes the way
  the stylesheet did. Naming from the config is knowable in every mode, so `__atomicCss` is gone and `cva` no longer
  sprays atomic classes into grouped markup.

  **Compound variants are a compound selector.** `.btn--size_sm.btn--tone_a` rather than atomic classes joined at
  runtime, which puts them in the same layer as the rest of the recipe and leaves the runtime nothing to compute — the
  rule matches because both variant classes are already on the element.

  ### Naming

  The class prefix is derived from the config: `className` when you set one, otherwise a hash of the recipe's styles.

  ```js
  cva({ className: 'button', base: { padding: '4' } }) // .button, .button--size_sm
  cva({ base: { padding: '4' } }) //                      .cva_a1b2c3, .cva_a1b2c3--size_sm
  ```

  It has to come from the config because the build and the browser each derive it independently and never meet. Deriving
  it from the binding — `const button = cva(...)` — would need the build to rewrite the call, and a pipeline without
  that transform would then name classes differently from one with it.

  ### Faster at runtime

  Naming from the config means the runtime no longer resolves a style object to produce a class string. `cva()` used to
  run `mergeCss` per active variant and then name a class per property; it now walks the variant keys and concatenates.

  Measured with both shapes in one process, so the comparison cannot drift
  (`packages/generator/__tests__/cva.bench.ts`):

  ```
  cva() all-miss x10000   173.72 hz ±2.23%   (semantic)
                           33.38 hz ±0.91%   (the atomic shape this replaced)   → 5.2x
  cva() warm x10000      1,678    hz ±0.60%  (semantic)
                         1,720    hz ±0.51%  (atomic)                           → within noise
  ```

  All-miss is every call selecting a distinct variant combination, so nothing is reusable. Warm, both return from the
  memo without doing the work that distinguishes them, which is why they match. `raw()` is unchanged — it still resolves
  styles, because that is what it returns.

  ### The trade

  CSS grows. Two recipes that both set `padding: 4` no longer share one atomic rule, and a variant that repeats a
  declaration repeats it in each rule. In exchange the markup shrinks — a component carrying a recipe goes from a class
  per property to its base class plus one per active variant, which in this repo's own fixtures is 23 classes down to 2.

  ### Also fixed

  Two naming bugs that predate this change and affected config recipes too, both found by extending
  `checkNamingAgreement` to cover recipes:
  - A variant value containing a space named `--size-x\ large` in the stylesheet and `--size-x_large` in the browser.
    The build now applies `withoutSpace`, as the runtime always has.
  - Under `hash: true` the build reported a recipe's **base** class unhashed while emitting the rule under the hashed
    name, so `@bamboocss/vite` could fold a class literal no rule existed for.

  ### Upgrading

  Class names change for every `cva`/`sva` call site, so DOM snapshots and any CSS that targeted the generated atomic
  classes will need updating. Styles themselves are unchanged. If you were relying on a `cva` losing to a `css()` by
  stylesheet order, it now wins or loses by layer instead — which is the point, but it is a change in behaviour.

- f2d5df2: **Breaking:** remove the JSX factory. Bamboo no longer generates components, and is now framework-agnostic.

  `styled-system/jsx` is not emitted at all. `styled` / `bamboo`, style props, the `css` prop, `as`, `unstyled`,
  `createStyleContext`, `splitCssProps` and `isCssProperty` are gone, along with `jsxFramework`, `jsxFactory` and
  `jsxStyleProps`. There is no React, Vue, Solid, Preact or Qwik codegen left anywhere.

  ```tsx
  // before
  <styled.div color="red.300" padding="4">hi</styled.div>
  const Button = styled('button', buttonRecipe)

  // after
  <div className={css({ color: 'red.300', padding: '4' })}>hi</div>
  const Button = (props: ButtonProps) => {
    const [variantProps, rest] = buttonRecipe.splitVariantProps(props)
    return <button {...rest} className={cx(buttonRecipe(variantProps), props.className)} />
  }
  ```

  For an override to be deterministic the component's styles have to sit in a lower cascade layer, which means declaring
  them as a config recipe — an inline `cva()` is atomic and lands in `utilities` alongside the consumer. A component
  that instead accepts a style object and merges it with `css(base, props.css)` needs no layer at all.

  **Recipe JSX tracking is kept**, and no longer depends on `jsxFramework`. A recipe's `jsx: ['Button']` hint is how the
  build reads `<Button variant="danger">` on a component you wrote and emits `--variant_danger`; without it those
  variants would silently stop being generated. It costs no codegen — it is extraction only.

  **`createStyleContext` has no replacement in the box.** Compound components that need one slot to see the variant
  chosen at the root now write their own context; `docs/concepts/slot-recipes` documents the ~20-line version.

  What this removes beyond the API: the whole per-framework generator tree, `is-valid-prop` (a large module that shipped
  to the browser only to decide whether a prop was a style prop), `normalize-html`, the vite fold's JSX element path —
  which has nothing left to fold — and the per-framework test matrix.

  `@bamboocss/plugin-vue` and `@bamboocss/plugin-svelte` are unaffected: they transform source so the extractor can read
  it, which has nothing to do with the factory.

- 1dbeb84: **Breaking:** remove JSX pattern components.

  `styled-system/jsx` no longer emits a component per pattern — `<Stack>`, `<Box>`, `<HStack>` and the rest are gone,
  and `styled-system/jsx` now exports only the factory, `isCssProperty` and `createStyleContext`.

  Pattern **functions** are unchanged. Every pattern still ships from `styled-system/patterns`, and a pattern function
  passes arbitrary style props through, so the rewrite is mechanical and behaviour-preserving:

  ```tsx
  // before
  <Stack gap="4" mt="8">{children}</Stack>
  <Box p="4">{children}</Box>

  // after
  <div className={stack({ gap: '4', mt: '8' })}>{children}</div>
  <div className={css({ p: '4' })}>{children}</div>
  ```

  The `jsx`, `jsxName` and `jsxElement` fields on a pattern config are removed along with them — they only ever
  described a component bamboo generated. `jsx` on a **recipe** is untouched.

  Everything that existed to serve the component layer goes with it: the five per-framework pattern generators, the
  `jsx-patterns` artifact, the parser's `jsx-pattern` result type and `JsxEngine`'s pattern matcher, and the vite fold's
  pattern-element path. `Patterns.find`/`Patterns.filter` (both keyed by JSX name) are gone, and
  `StyleEncoder.processPattern` takes `(name, props, grouped)`.

  Two consequences worth knowing:
  - A component of your own named `Box` or `Stack` is no longer misread as bamboo's pattern. It extracts as an ordinary
    component, which is what it always was.
  - The `jsx-patterns-index` artifact is now `jsx-index`, since it no longer indexes patterns.

- 233ac01: Add `no-unlayered-override`, and correct what the docs claimed about which styles land in which layer.

  Now that `cx` joins rather than merges, a component that styles itself with `css()` and joins a `className` it was
  handed has both classes in the `utilities` layer — so which one applies is decided by stylesheet order, not by the
  caller. The new rule reports that shape and names the two fixes.

  The fix is to write the component with `cva`/`sva`:

  ```
  css()                → utilities   (atomic)
  inline cva() / sva() → recipes     (semantic)
  config recipe        → recipes     (semantic)
  ```

  Both kinds of recipe land in a lower layer, so a consumer's `css()` wins by cascade in every build. The rule reports
  `css()` joined with a class it cannot see, and stays quiet for either.

  The docs now also give the mechanism with no caveats at all — accept a style object rather than a class name, and
  merge it with `css(base, props.css)`. That resolves per property before any class name exists, so it behaves
  identically in every build and needs no layer.

### Patch Changes

- Updated dependencies [1be9171]
- Updated dependencies [ca558fb]
- Updated dependencies [645bb09]
- Updated dependencies [645bb09]
- Updated dependencies [645bb09]
- Updated dependencies [41ea189]
- Updated dependencies [645bb09]
- Updated dependencies [091f2e1]
- Updated dependencies [f2d5df2]
- Updated dependencies [1dbeb84]
- Updated dependencies [d7226f0]
- Updated dependencies [31d8577]
- Updated dependencies [99ab42f]
- Updated dependencies [2ab7f19]
- Updated dependencies [ca558fb]
  - @bamboocss/generator@1.16.0
  - @bamboocss/shared@1.16.0
  - @bamboocss/config@1.16.0

## 1.15.0

### Patch Changes

- Updated dependencies [3014989]
  - @bamboocss/generator@1.15.0
  - @bamboocss/shared@1.15.0
  - @bamboocss/config@1.15.0

## 1.14.0

### Patch Changes

- d0b7016: `no-escape-hatch` now looks inside `fallback(...)` candidates.

  The rule tests whether the value as a whole is an escape hatch, and a fallback wraps its candidates — so
  `fallback([stretch], 100%)` slipped past it even though `[stretch]` is exactly what the rule exists to catch. Each
  candidate is now checked on its own.

  No autofix is offered in that case: the existing suggestion rewrites the whole value to its unwrapped form, which for
  a fallback would be a no-op. The report still points at the value.

- Updated dependencies [7cc6235]
- Updated dependencies [b567114]
- Updated dependencies [3264da1]
- Updated dependencies [d1d05fc]
  - @bamboocss/generator@1.14.0
  - @bamboocss/shared@1.14.0
  - @bamboocss/config@1.14.0

## 1.13.2

### Patch Changes

- Updated dependencies [79c9872]
- Updated dependencies [61fe88c]
- Updated dependencies [ba60cf5]
- Updated dependencies [be3764d]
- Updated dependencies [7a63215]
- Updated dependencies [2130606]
  - @bamboocss/shared@1.13.2
  - @bamboocss/generator@1.13.2
  - @bamboocss/config@1.13.2

## 1.13.1

### Patch Changes

- @bamboocss/config@1.13.1
- @bamboocss/generator@1.13.1
- @bamboocss/shared@1.13.1

## 1.13.0

### Patch Changes

- Updated dependencies [9ffb84f]
- Updated dependencies [e482ab3]
- Updated dependencies [7bf6798]
- Updated dependencies [8a6c23e]
- Updated dependencies [17de3d0]
- Updated dependencies [cd76ba7]
- Updated dependencies [11c9409]
- Updated dependencies [9ffb84f]
- Updated dependencies [fd03a10]
- Updated dependencies [a07286f]
- Updated dependencies [a5cb5a8]
- Updated dependencies [9ffb84f]
- Updated dependencies [a966bae]
- Updated dependencies [5b16a67]
  - @bamboocss/generator@1.13.0
  - @bamboocss/shared@1.13.0
  - @bamboocss/config@1.13.0

## 1.12.3

### Patch Changes

- @bamboocss/generator@1.12.3
- @bamboocss/config@1.12.3
- @bamboocss/shared@1.12.3

## 1.12.2

### Patch Changes

- Fix rule prefix in exported configs from `@bamboocss/` to `bamboo/` to match the plugin name used by consumers in
  ESLint flat config and oxlint jsPlugins.
  - @bamboocss/config@1.12.2
  - @bamboocss/generator@1.12.2
  - @bamboocss/shared@1.12.2

## 1.12.1

### Patch Changes

- Fix runtime error caused by test fixtures being bundled into the production dist, which created a dependency on
  @bamboocss/types at runtime.
  - @bamboocss/config@1.12.1
  - @bamboocss/generator@1.12.1
  - @bamboocss/shared@1.12.1

## 1.12.0

### Minor Changes

- Add ESLint plugin for Bamboo CSS with 19 rules covering design token enforcement, property validation, and best
  practices.

### Patch Changes

- @bamboocss/config@1.12.0
- @bamboocss/generator@1.12.0
- @bamboocss/shared@1.12.0
