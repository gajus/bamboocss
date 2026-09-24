# Bamboo CSS System Architecture

## Overview

Bamboo CSS is a universal, build-time, type-safe, zero-runtime CSS-in-JS solution that extracts styles at compile time
and generates optimized CSS and TypeScript utilities. The system follows a modular architecture built as a pnpm monorepo
with distinct packages handling different aspects of the styling pipeline.

## Core Philosophy

- **Build-time extraction**: Styles are analyzed and extracted during the build process, not at runtime
- **Type safety**: Full TypeScript support with auto-generated types based on configuration
- **Zero runtime**: CSS is generated at build time, minimal JavaScript shipped to the browser
- **Framework agnostic**: Works with React, Vue, Svelte, Solid, Preact, Qwik, and more
- **Modern CSS**: Leverages CSS custom properties, cascade layers (`@layer`), and modern CSS features

## Repository Structure

```
bamboo/
├── packages/           # Core packages (published to npm)
├── sandbox/           # Framework integration examples
├── website/           # Documentation site
└── .changeset/        # Changeset-based versioning
```

## Package Architecture

### 1. User-Facing Packages

#### `@bamboocss/dev` (packages/cli)

- **Purpose**: Main entry point for end users
- **Exports**: CLI binary (`bamboo` command), presets
- **Key responsibilities**:
  - Command-line interface (init, codegen, build, analyze, debug)
  - Interactive setup wizard
  - Update notifications
- **Dependencies**: Orchestrates all other packages

### 2. Core Processing Packages

#### `@bamboocss/core` (packages/core)

- **Purpose**: Heart of the Bamboo system containing all core logic
- **Key classes**:
  - **Context**: Central orchestration class that manages all engines
  - **Utility**: CSS utility generation and processing
  - **Recipes**: Component recipe/variant system (like Stitches)
  - **Patterns**: Layout pattern generation (flex, grid, container, etc.)
  - **Conditions**: Responsive/conditional style handling (breakpoints, pseudo-classes)
  - **Stylesheet**: CSS generation and optimization
  - **StyleEncoder/StyleDecoder**: Style serialization and deserialization
  - **TokenDictionary**: Design token management
  - **JsxEngine**: JSX component analysis
  - **ImportMap**: Import tracking for bamboo functions
- **Key responsibilities**:
  - Style transformation and serialization
  - CSS optimization and minification
  - Layer management (`@layer` directives)
  - Selector parsing and manipulation
  - Color mixing utilities

#### `@bamboocss/native-extractor` (packages/native-extractor)

- **Purpose**: The only extraction engine — Rust/Oxc, loaded through N-API. Private; shipped inside `@bamboocss/node`'s
  `dist/native`
- **Exports**:
  - `analyzeMany(sources, entrypoints, options)`: stylesheet extraction for a whole batch of files in one call. Returns,
    per file, the matched calls (kind, imported name, evaluated arguments, losses, unresolved recipe keys), parse
    errors, and the modules the evaluation read (`dependencies`, `pendingCandidates`, `configurationFiles`)
  - `compileModules(sources, auxiliary, options)`: the Vite compiler's fold analysis (`src/fold/`). Returns plain facts
    per module — calls with their evaluated data and exactness, imports, references, imported recipes, dependencies —
    with UTF-16 offsets
  - `accountTokens(filename, source, tokenModules, pathMappings)`: the token paths a file asks for, for token pruning
    (`src/token_accounting.rs`)
- **Key responsibilities**:
  - Parsing TS/JS/JSX with Oxc and matching calls whose callee is bound to a Bamboo entrypoint import
  - Static evaluation of arguments (`src/evaluator.rs`: `ProjectEvaluator` for the batch, `FileEvaluator` per file),
    including cross-file import resolution (relative, tsconfig `paths`/`baseUrl`, package `exports`/`imports`)
  - Conditionals yield both branches as independent fragments; recipe/pattern `.raw(...)` and `token()` /
    `token.value()` are evaluated in place
  - Reporting what it could not evaluate as losses rather than guessing
- **Not here**: Vue and Svelte SFCs are not parsed natively. `@bamboocss/plugin-vue` / `@bamboocss/plugin-svelte`
  convert them to TSX in the `parser:before` hook before the source reaches Rust

#### `@bamboocss/generator` (packages/generator)

- **Purpose**: Code generation for styled-system output
- **Directory structure**:
  ```
  artifacts/
  ├── css/           # CSS generation (tokens, reset, static, global, keyframes)
  ├── js/            # JavaScript utility functions
  ├── types/         # TypeScript type definitions
  └── generated/     # Generated helper files
  ```
- **Key responsibilities**:
  - Generating the `styled-system` directory
  - Type definition generation for autocomplete
  - CSS utility classes
  - Pattern and recipe types/functions

There is no `jsx/` artifact directory. The JSX factory was removed, so `styled-system/jsx` is not generated and there
are no framework-specific factories to emit — a class name comes from a call the compiler can see, or from `staticCss`,
which pre-generates rules with no call site.

### 3. Configuration & Setup

#### `@bamboocss/config` (packages/config)

- **Purpose**: Configuration loading and merging
- **Key responsibilities**:
  - Finding and loading `bamboo.config.ts/js`
  - Dynamic config import with bundle-n-require
  - Merging user config with presets
  - Config diffing for incremental updates
  - TypeScript path mapping resolution

#### `@bamboocss/preset-*` (packages/preset-\*)

- **Available presets**:
  - `preset-base`: Minimal foundation preset
  - `preset-bamboo`: Default preset with design system tokens
  - `preset-atlaskit`: Atlassian design system integration
  - `preset-open-props`: Open Props design tokens
- **Purpose**: Shareable configuration and design tokens

### 4. Orchestration & Build

#### `@bamboocss/node` (packages/node)

- **Purpose**: Node.js runtime and build orchestration
- **Key classes/functions**:
  - **BambooContext** (`create-context.ts`): Extended context with build-time features. Owns the native boundary:
    `prepareNativeExtraction` batches files into one `analyzeMany` call, `parseFile` turns a file's native result into a
    `ParserResult`, `compileModules` serves the Vite compiler, `accountTokens` serves token pruning, and
    `getNativeDependents` / `getNativeDependencyLedger` expose the dependency ledger
  - **ParserResult** (`parser-result.ts`): What extraction found in one file. Its setters (`set`, `setPattern`,
    `setRecipe`, `setToken`, `setViewTransition`) record the items and call the encoder; nothing in it reads source
  - **SourceProject** (`source-project.ts`, `ctx.project`): The source view every engine reads — disk with
    caller-supplied overlays (e.g. a single-file component's compiled script), the `resolutionOptions`
    (`baseUrl`/`paths`) handed to the native resolver, and `parseJson` for restoring encoder dumps listed in `include`
  - **Builder**: Incremental build system with file watching
  - **DiffEngine**: Detects configuration changes
  - **OutputEngine**: Manages file writing
- **Key responsibilities**:
  - File watching (chokidar)
  - Incremental builds (dependents selected from the native dependency ledger)
  - Config change detection
  - Git ignore management
  - CSS generation and optimization
  - oxfmt formatting integration

### 5. Utilities & Infrastructure

#### `@bamboocss/token-dictionary` (packages/token-dictionary)

- **Purpose**: Design token processing
- **Key responsibilities**:
  - Token transformation and references
  - Semantic token resolution
  - CSS variable generation
  - Token categorization (colors, spacing, typography, etc.)
- **Critical API distinction**:
  - `get(path)`: Returns raw token values (e.g., `"#ef4444"`, `"1rem"`)
  - `getVar(path)`: Returns CSS variable references (e.g., `"var(--colors-red-500)"`)
  - Use `getVar()` for RuleProcessor and string pattern expansion
  - Both halves are handed to the native evaluator as its token table (`BambooContext.nativeTokens`): `token()` reads
    the `getVar()` half, `token.value()` the `get()` half

#### `@bamboocss/types` (packages/types)

- **Purpose**: Shared TypeScript types
- **Build process**: Generates complex conditional types from csstype
- **Exports**: All type definitions used across packages

#### `@bamboocss/shared` (packages/shared)

- **Purpose**: Shared utility functions
- **Examples**: Object manipulation, string utilities, memoization, pattern functions

#### `@bamboocss/is-valid-prop` (packages/is-valid-prop)

- **Purpose**: Validates CSS property names
- **Used by**: Core and generator for prop filtering

#### `@bamboocss/logger` (packages/logger)

- **Purpose**: Centralized logging with log levels
- **Features**: Colored output, timing utilities, debug mode

#### `@bamboocss/reporter` (packages/reporter)

- **Purpose**: User-friendly error and warning messages

#### `@bamboocss/vite` (packages/vite)

- **Purpose**: Vite plugin — emits the stylesheet and compiles `css()`, pattern and recipe calls into globally shared
  atomic classes at build time
- **Key responsibilities**: strict whole-program compilation, finite recipe decision tables, graph pruning and the
  virtual `virtual:bamboo.css` module

#### `@bamboocss/mcp` (packages/mcp)

- **Purpose**: MCP server exposing tokens, recipes, patterns and usage reports to AI assistants

#### `@bamboocss/eslint-plugin` (packages/eslint-plugin)

- **Purpose**: Lint rules (e.g. `no-dynamic-styling`, `no-config-function-in-source`, `require-literal-token-path`)

#### `@bamboocss/plugin-*` (packages/plugin-lightningcss, plugin-vue, plugin-svelte)

- **Purpose**: Optional plugins. `vue` and `svelte` are auto-injected for their file types; `lightningcss` is installed
  and listed by the user.

#### `@bamboocss/fixture` (packages/fixture)

- **Purpose**: Shared test fixtures and context factories (`createContext`, `createRuleProcessor`). Private — not
  published to npm.

## System Flow

### 1. Initialization Flow (`bamboo init`)

```
User runs `bamboo init`
    ↓
CLI (packages/cli)
    ↓
Interactive wizard or flag parsing
    ↓
setupConfig() - Creates bamboo.config.ts
    ↓
loadConfigAndCreateContext() - Loads and validates config
    ↓
codegen() - Generates styled-system directory
    ↓
setupGitIgnore() - Updates .gitignore
```

### 2. Build/Watch Flow (`bamboo` or `bamboo --watch`)

```
User runs `bamboo`
    ↓
CLI (packages/cli)
    ↓
Builder.setup()
    ├─→ Find config (packages/config)
    ├─→ Load config with presets
    ├─→ Create Context (packages/core)
    │   ├─→ Initialize TokenDictionary
    │   ├─→ Initialize Utility engine
    │   ├─→ Initialize Recipes
    │   ├─→ Initialize Patterns
    │   └─→ Initialize Conditions
    ↓
Builder.emit() - Generate baseline CSS & JS
    ↓
Builder.extract() - Scan source files
    ├─→ Fast-glob finds files; extractableFiles() keeps those that can reach an entrypoint
    ├─→ ctx.prepareNativeExtraction(files) (packages/node)
    │   ├─→ parser:before hook per file (e.g. Vue/Svelte SFC → TSX)
    │   └─→ One analyzeMany() call (packages/native-extractor, Rust/Oxc)
    ├─→ ctx.parseFile(file) for each file
    │   ├─→ Native result → ParserResult → StyleEncoder
    │   └─→ parser:after hook
    └─→ Record per-file dependencies for the next incremental pass
    ↓
Generator (packages/generator)
    ├─→ Generate artifacts
    │   ├─→ CSS files (tokens, utilities, reset)
    │   ├─→ JS files (css, cva, sva, patterns)
    │   └─→ TypeScript types
    ↓
Builder.write() - Write files to styled-system
    ↓
Optimize CSS (postcss plugins)
    └─→ Format with oxfmt
```

### 3. Extraction Flow

```
Source files (e.g., App.tsx, Button.vue)
    ↓
BambooContext.prepareNativeExtraction(files) (packages/node/src/create-context.ts)
    ├─→ Read each file through SourceProject (overlay, else disk)
    ├─→ parser:before hook - may rewrite content (plugin-vue / plugin-svelte → TSX)
    ├─→ Build entrypoints from ImportMap: css (css, cva, sva, cx, fallback, viewTransition),
    │   token, recipe (config recipe names), pattern (config pattern names)
    └─→ One analyzeMany(sources, entrypoints, { baseUrl, paths, tokens, jsx }) call
    ↓
native-extractor (Rust/Oxc, packages/native-extractor/src/lib.rs)
    ├─→ Parse with Oxc, collect imports bound to an entrypoint
    ├─→ Classify each matched call: css | recipe | pattern | token | tokenValue | dead
    │   (cx and fallback are skipped — they contribute no rules)
    ├─→ Evaluate arguments statically (src/evaluator.rs)
    │   ├─→ Local bindings, cross-file imports (relative, tsconfig paths/baseUrl,
    │   │   package exports/imports)
    │   ├─→ Conditionals → both branches as independent fragments
    │   ├─→ recipe/pattern .raw(...), token() / token.value() against the token table
    │   └─→ What cannot be evaluated → losses / unresolvedKeys, not guesses
    ├─→ JSX recipe components (when `jsx.isEnabled`) - opening elements reported as `jsx` calls
    └─→ Per file: calls, errors, dependencies, pendingCandidates, configurationFiles
    ↓
BambooContext.parseFile(file) → parseNativeFile()
    ├─→ kind css (css/cva/sva)  → result.set(name, item)
    ├─→ kind css (viewTransition) → result.setViewTransition(item)
    ├─→ kind pattern            → result.setPattern(name, item)
    ├─→ kind recipe             → result.setRecipe(name, item, unresolvedKeys)
    ├─→ kind jsx                → jsx.isJsxTagRecipe(tag) → result.setRecipe(...) - a recipe
    │                             component the project wrote itself, driven by a recipe's
    │                             `jsx` key, not by a styled factory
    ├─→ kind token / tokenValue → result.setToken(item, kind)
    ├─→ kind dead               → result.deadCalls (reported by assertNoDeadCalls)
    └─→ losses                  → result.unresolved (reported by reportUnresolvedStyles)
    ↓
ParserResult (packages/node/src/parser-result.ts) setters call the encoder
    ├─→ processAtomic / processAtomicRecipe / processAtomicSlotRecipe
    ├─→ processPattern / processRecipe / processViewTransition
    ↓
parser:after hook - receives { filePath, result }
    ↓
StyleEncoder - Encode to atomic classes
    ├─→ Store in StyleDecoder
    └─→ Return extracted styles
```

`.json` files in `include` skip the native engine: `SourceProject.parseJson` restores the encoder dump they hold.

**Token Extraction Details**: When `token()` is encountered:

1. The `token` entrypoint (modules from `ImportMap`, name `token`) is part of every `analyzeMany` call, alongside the
   token table `BambooContext.nativeTokens` — one `{ path, value, variable }` entry per token, where `value` is
   `tokens.view.get(path)` and `variable` is `tokens.view.getVar(path)`
2. The Rust analysis classifies `token(path)` as `token` and `token.value(path)` as `tokenValue`
3. Where the call sits inside another call's argument (`css({ color: token('colors.red.500') })`), the evaluator
   (`src/evaluator.rs`) replaces it with the table entry: `token()` → `variable`, `token.value()` → `value`. A path the
   table does not hold evaluates to `undefined`
4. The token call itself is also reported; `parseNativeFile` stores it with `result.setToken(item, kind)`. It encodes no
   CSS, but its path feeds token accounting
5. In the Vite compiler, `packages/vite/src/fold.ts` replaces a `token()` / `token.value()` call whose path is an exact
   literal with the variable reference / value

### 3b. Vite Compile Flow

```
Vite transform (packages/vite/src/plugin.ts)
    ├─→ Skip modules outside include/exclude, and rewrites that reach nothing bamboo
    ↓
ctx.compileModules([{ filename, source }], { references })
    ├─→ Other modules read the way extraction reads them (parser:before output, overlays, disk)
    └─→ native-extractor compileModules → src/fold/ analysis
        └─→ Facts: calls (evaluated data + exactness), imports, references,
            imported recipes, dependencies — with UTF-16 offsets
    ↓
packages/vite/src/fold.ts - policy
    ├─→ Class allocation from the global atom pool
    ├─→ Recipe decision tables
    ├─→ cx composition
    ├─→ token() / token.value() → variable reference / value
    └─→ MagicString rewrite of the module
```

Rules deciding whether an evaluated value may _replace_ source live in `src/fold/exact.rs`: extraction is deliberately
optimistic, the fold is not.

### 4. Code Generation Flow

```
Generator.getArtifacts()
    ↓
generateArtifacts() dispatches to:
    ├─→ CSS Artifacts
    │   ├─→ generateResetCss() - Preflight/reset
    │   ├─→ generateTokenCss() - CSS variables
    │   ├─→ generateStaticCss() - Static utilities
    │   ├─→ generateGlobalCss() - Global styles
    │   └─→ generateKeyframeCss() - @keyframes
    ├─→ JS Artifacts
    │   ├─→ css.mjs - Main styling API
    │   ├─→ cva.mjs - Component variants
    │   ├─→ sva.mjs - Slot variants
    │   ├─→ patterns/*.mjs - Layout patterns
    │   └─→ recipes/*.mjs - Recipe functions
    └─→ Type Artifacts
        ├─→ style-props.d.ts
        ├─→ pattern.d.ts
        └─→ recipes/types.d.ts
```

## Key Design Patterns

### 1. Context Pattern

- **Context** class is the central orchestrator
- All engines (Utility, Recipes, Patterns, etc.) are initialized in Context
- Context is passed down to all subsystems
- Provides unified access to configuration, tokens, and utilities

### 2. Engine Pattern

- Specialized engines handle different concerns:
  - **Utility**: CSS utility generation
  - **Recipes**: Component recipes
  - **Patterns**: Layout patterns
  - **JsxEngine**: JSX analysis
  - **PathEngine**: File path management
  - **FileEngine**: File template management

### 3. Builder Pattern

- **Builder** class manages incremental builds
- Tracks file changes and config diffs
- Coordinates setup → extract → generate → write cycle
- Handles file watching and HMR

### 4. Encoder/Decoder Pattern

- **StyleEncoder**: Converts style objects to atomic class names
- **StyleDecoder**: Collects all encoded styles for CSS generation
- Enables atomic CSS with automatic deduplication

### 5. Static Evaluation (native-extractor)

- **ProjectEvaluator**: One per native call; holds the supplied sources, resolution options (`baseUrl`/`paths`) and the
  token table, resolves imports across files and records which modules each file's evaluation read
- **FileEvaluator**: Evaluates expressions within one file to JSON values
- Conditionals produce every enumerable branch as an independent fragment; spreads, computed keys and values it cannot
  see are reported as losses
- Only compact records cross into JavaScript — ASTs stay in Rust

### 6. Token Resolution Strategy

Bamboo CSS has a dual-mode token resolution system that handles tokens differently based on context:

#### Call Mode (Native Evaluation)

When `token()` / `token.value()` is **called** as a function imported from the tokens entrypoint:

```typescript
// Template literal interpolation with a call
const styles = css({
  border: `1px solid ${token('colors.yellow.100')}`, // token() is called
})
```

**Resolution**: The Rust evaluator (`packages/native-extractor/src/evaluator.rs`) evaluates the call **at build time**
against the token table `BambooContext.nativeTokens` passes in, mirroring the generated runtime
(`packages/generator/src/artifacts/js/token.ts`):

- **`token(path)`** → the CSS variable reference, for every token (e.g., `"var(--colors-yellow-100)"`)
- **`token.value(path)`** → the resolved literal for a base token (e.g., `"#fef9c3"`); a virtual or conditional token
  has no single literal, so it still yields its `var()`
- A path the table does not hold evaluates to `undefined`; a non-literal path cannot be evaluated

The Vite compiler (`packages/vite/src/fold.ts`) replaces such a call in the module with the same variable reference /
value when the path is an exact literal and any trailing arguments are inert.

**Key files**:

- `packages/native-extractor/src/evaluator.rs` - Evaluates token calls against the token table
- `packages/node/src/create-context.ts` - `nativeTokens` builds the table from `view.get()` / `view.getVar()`
- `packages/token-dictionary/src/dictionary.ts` - `get()` returns raw values, `getVar()` returns CSS variables

#### String Pattern Mode (RuleProcessor)

When `token(...)` appears as a **string pattern** (not executed as a function):

```typescript
// String literal with token pattern
const styles = css({
  border: '1px solid token(colors.yellow.100)', // Plain string, no call
})
```

**Resolution**: The RuleProcessor pattern-matches the string **after parsing** via `expandReferenceInValue()`:

- Finds pattern: `token(path.to.token)`
- Always resolves to CSS variable: `"var(--path-to-token)"`

**Key files**:

- `packages/token-dictionary/src/dictionary.ts` - `expandReferenceInValue()` method
- `packages/core/src/utility.ts` - `getToken()` uses `getVar()` for CSS variable output
- `packages/core/src/utility.ts` - `defaultTransform()` uses `getVar()` for CSS custom properties

#### Critical Distinction

| Context                        | Example                                         | Resolution                    | Output                                 |
| ------------------------------ | ----------------------------------------------- | ----------------------------- | -------------------------------------- |
| **Template literal + token()** | `` `1px solid ${token('colors.yellow.100')}` `` | Native evaluation → variable  | `"1px solid var(--colors-yellow-100)"` |
| **String pattern (no call)**   | `"1px solid token(colors.yellow.100)"`          | RuleProcessor → CSS variable  | `"1px solid var(--colors-yellow-100)"` |
| **Object property + token()**  | `{ color: token('colors.red.500') }`            | Native evaluation → variable  | `{ color: "var(--colors-red-500)" }`   |
| **Object property + value()**  | `{ color: token.value('colors.red.500') }`      | Native evaluation → raw value | `{ color: "#ef4444" }`                 |

#### Why This Design?

This dual-mode system exists because:

1. **Calls** execute at runtime too, so build-time evaluation must match what the generated `token()` / `token.value()`
   return — which is why both halves of the evaluator's table come from the same `view.get()` / `view.getVar()` the
   generator reads
2. **String patterns** are processed by Bamboo's RuleProcessor and can be transformed to CSS variables for dynamic
   theming
3. **Semantic tokens** (with conditions) must always use CSS variables to support responsive/conditional values
4. `token()` returns the variable reference for every token, so the result does not change kind when a theme adds a
   condition; the literal has to be asked for with `token.value()`

## Build Optimization

### Incremental Builds

- **File tracking**: Tracks modified times of source and config files
- **Dependency graph**: Knows which files affect what artifacts
- **Native dependency ledger**: Each native analysis reports the modules its evaluation read (`dependencies`), missing
  candidates whose appearance would change resolution (`pendingCandidates`) and the `package.json`/tsconfig files that
  selected an import (`configurationFiles`). `Builder` (`packages/node/src/builder.ts`) re-extracts a changed file's
  dependents via `getNativeDependents` and orders the pass from `getNativeDependencyLedger`
- **Smart invalidation**: Only regenerates changed artifacts
- **Config diffing**: Detects specific config changes to minimize regeneration

### CSS Optimization

- **Atomic CSS**: Each unique style gets one class
- **Layer ordering**: Uses `@layer` for predictable cascade
- **PostCSS pipeline** (the default; `packages/core/src/optimize.ts` dispatches, the plugin order lives in
  `packages/core/src/plugins/optimize-postcss.ts`):
  - `nested()` - Unwrap nested rules
  - `dedupeNodes()` - Remove duplicate rules (local, not `postcss-discard-duplicates`)
  - `mergeRules()` - Merge duplicate selectors (inlined as `packages/core/src/plugins/merge-rules.ts`, so core does not
    depend on browserslist or caniuse-api)
  - `discardEmpty()` - Drop empty rules
  - then `normalizeWhiteSpace()` + `minifySelectors()` under `minify`, else `prettify()`
- **LightningCSS** - an opt-in _alternative_ to that pipeline, not a stage in it. Install
  `@bamboocss/plugin-lightningcss` and list `pluginLightningcss()` in `plugins`; it answers the `css:optimize` hook.

### Code Splitting

- Separate artifacts for different concerns
- Lazy-loadable pattern and recipe functions
- Tree-shakeable exports

## Type System

### Generated Types

```typescript
// Utility props
css({ color: 'red.500' }) // Autocomplete for 'red.500'

// Pattern props
flex({ gap: '4' }) // Autocomplete for spacing tokens

// Recipe variants
button({ size: 'lg', variant: 'solid' }) // Autocomplete variants
```

### Type Generation Flow

```
User config (theme.tokens)
    ↓
TokenDictionary processes tokens
    ↓
Generator creates type definitions
    ├─→ Token paths as string literals
    ├─→ Recipe variant types
    ├─→ Pattern prop types
    └─→ Utility prop types
    ↓
TypeScript provides autocomplete
```

## Framework Integration

### One Authoring API Across Frameworks

There is no JSX factory and no style props. Every framework authors styles the same way — a `css()`, pattern or recipe
call whose result is a class string — so nothing framework-specific is generated:

```tsx
import { css } from './styled-system/css'
;<div className={css({ color: 'red.500' })} />
```

That is what makes whole-program compilation possible: the call is visible to `@bamboocss/vite`, which resolves its
declarations into the global atom pool and replaces it with the resulting compact class value. See `packages/vite` and
the source-compilation guide.

### Framework-Specific Parsing

- **React/Preact**: Standard JSX
- **Vue**: `@bamboocss/plugin-vue` converts the SFC to TSX (`@vue/compiler-sfc`) in `parser:before`
- **Svelte**: `@bamboocss/plugin-svelte` converts the component to TSX in `parser:before`
- **Solid**: JSX with Solid-specific patterns

## Plugin System

### Hooks API

Bamboo provides a hookable API for extensibility. Hooks register through `plugins` only — there is no top-level `hooks`
config option, and setting one is a hard error:

```typescript
plugins: [
  {
    name: 'my-app',
    hooks: {
      'tokens:created': (args) => {
        /* Modify tokens */
      },
      'parser:before': (args) => {
        /* Return rewritten file content before native extraction (e.g. SFC → TSX) */
      },
      'parser:after': (args) => {
        /* Receives { filePath, result: ParserResult } */
      },
      'cssgen:done': (args) => {
        /* Post-CSS generation */
      },
      'codegen:prepare': (args) => {
        /* Pre-codegen */
      },
    },
  },
]
```

### Plugin Architecture

Plugins can:

- Modify token dictionary
- Add custom utilities
- Transform generated code
- Integrate with build tools

## Testing Strategy

### Test Infrastructure

- **Vitest**: Test runner with globals
- **Happy-dom**: Browser environment simulation
- **Unit tests**: Per-package in `__tests__` directories
- **Integration tests**: In sandbox directories
- **Fixtures**: Sample projects in `packages/fixture`

### Test Coverage Areas

1. **Config loading**: Various config formats and merging
2. **Token processing**: Token transformation and references
3. **Extraction**: native extraction accuracy (`packages/node/__tests__/extraction/`,
   `packages/native-extractor/__tests__/`) and the fold (`packages/vite/__tests__/fold-*`)
4. **Generator**: Artifact generation correctness
5. **CSS output**: Style transformation and optimization
6. **Type generation**: TypeScript type correctness

## Development Workflow

### Local Development

```bash
pnpm install              # Install dependencies
pnpm build-fast          # Quick build without types
pnpm dev                 # Watch mode for packages
```

### Package Scripts

- `build`: Full build with types
- `build-fast`: Quick build, no type generation
- `dev`: Watch mode
- `test`: Run tests
- `typecheck`: TypeScript validation

### Release Process

1. Changes tracked with Changesets (`.changeset/`)
2. Run `pnpm changeset` to document changes
3. Changesets generates changelog and version bumps
4. `pnpm release` publishes to npm

## Performance Considerations

### Build Performance

- **Lazy imports**: Delays loading until needed
- **Parallel processing**: Uses `pnpm --parallel` for multi-package builds
- **Batched native extraction**: A whole pass is one `analyzeMany` call; ASTs stay in Rust and only compact records
  cross into JavaScript. Files that cannot reach a Bamboo entrypoint are not parsed (`extractableFiles`)
- **Incremental re-extraction**: Only changed files and their dependents from the native dependency ledger are
  re-analyzed
- **Fast glob**: Efficient file scanning

### Runtime Performance

- **Zero runtime**: All styles generated at build time
- **Minimal JS**: Only necessary utility functions shipped
- **CSS variables**: Dynamic theming without JS
- **Tree-shaking**: Unused utilities eliminated

### Memory Management

- **Memoization**: Expensive computations cached
- **Streaming**: Large file processing in chunks
- **Context cleanup**: Proper disposal of resources

## Error Handling

### User-Facing Errors

- **Reporter package**: Formatted, helpful error messages
- **Logger levels**: debug, info, warn, error, silent
- **Stack traces**: Preserved for debugging
- **Suggestions**: Actionable error messages

### Error Categories

1. **Config errors**: Invalid configuration
2. **Parse errors**: Malformed source code
3. **Generation errors**: Failed artifact creation
4. **File system errors**: Permission/access issues

## Common Pitfalls & Debugging

### Token Resolution Issues

**Pitfall**: Using `tokens.view.get()` when CSS variables are needed

```typescript
// ❌ WRONG - Returns raw value when CSS variable needed
const tokenValue = this.tokens.view.get(path) // Returns "#ef4444"

// ✅ CORRECT - Returns CSS variable for RuleProcessor
const tokenValue = this.tokens.view.getVar(path) // Returns "var(--colors-red-500)"
```

**When to use each**:

- Use `get()`: Only for the literal half of the native token table (`BambooContext.nativeTokens` → `token.value()`), and
  wherever a raw value is genuinely wanted (e.g. generated token maps)
- Use `getVar()`: When processing string patterns in RuleProcessor (expandReferenceInValue, getToken, defaultTransform),
  and for the variable half of the native token table (`token()`)

**Common locations that need `getVar()`**:

- `packages/core/src/utility.ts` - `getToken()` method
- `packages/core/src/utility.ts` - `defaultTransform()` method
- `packages/token-dictionary/src/dictionary.ts` - `expandReferenceInValue()` method

### Entrypoint Kinds

**Pitfall**: Assuming a name is matched because it is exported from an entrypoint module

Native extraction only matches the names listed per entrypoint kind in `prepareNativeExtraction`
(`packages/node/src/create-context.ts`): `css` (`css`, `cva`, `sva`, `cx`, `fallback`, `viewTransition`), `token`
(`token`), `recipe` (the config's recipe names) and `pattern` (the config's pattern names). Each kind's modules come
from `packages/core/src/import-map.ts`. `compileModules` builds the same list for the Vite compiler in
`packages/native-extractor/src/lib.rs`. A call to a recipe or pattern name the entrypoint no longer exports comes back
as a `dead` call, not as nothing.

### Template Literal vs String Pattern

**Pitfall**: Confusing template literal interpolation with string patterns

```typescript
// Template literal with a token() call - resolved by the native evaluator
border: `1px solid ${token('colors.yellow.100')}`
// → Result: "1px solid var(--colors-yellow-100)" (token() is always the reference)

// Template literal with token.value() - resolved by the native evaluator
border: `1px solid ${token.value('colors.yellow.100')}`
// → Result: "1px solid #fef9c3" (raw value)

// String pattern - Resolved by RuleProcessor
border: '1px solid token(colors.yellow.100)'
// → Result: "1px solid var(--colors-yellow-100)" (CSS variable)
```

**Debugging tip**: Check whether `token` is a call (inside `${}` or as a property value) or plain text in the string,
and whether the call is `token()` or `token.value()`.

### Missing Extraction Handlers

**Pitfall**: Adding new function types to ImportMap but forgetting to handle them through the native pipeline

**Checklist when adding new function types**:

1. ✅ Add to `packages/core/src/import-map.ts` and to the native entrypoints built in `prepareNativeExtraction`
   (`packages/node/src/create-context.ts`)
2. ✅ Handle the kind in the native analysis in `packages/native-extractor/src/lib.rs` (and in
   `packages/native-extractor/src/fold/` if the Vite compiler should lower it)
3. ✅ Map it in `parseNativeFile` (`packages/node/src/create-context.ts`) to a `ParserResult` setter
   (`packages/node/src/parser-result.ts`, e.g. `setToken()`)
4. ✅ Add result type to `packages/types/src/parser.ts` if needed
5. ✅ Write tests in `packages/node/__tests__/extraction/` and `packages/native-extractor/__tests__/`

### Debugging Token Resolution

**Enable debug logging**:

```bash
BAMBOO_DEBUG=* bamboo
```

`BAMBOO_DEBUG` takes a comma-separated list of log types (globs), e.g. `BAMBOO_DEBUG=file:extract`.

Look for these log messages:

- `file:extract` - Which files were selected for extraction and each file parsed
- `vite:transform` - How many calls the Vite compiler folded per module
- For what extraction produced, inspect the `ParserResult` (e.g. from a `parser:after` hook): token calls are in
  `result.token`, and `css()` data shows the evaluated token values

**Test both modes**:

- Write tests for call evaluation (`packages/node/__tests__/extraction/token.test.ts`)
- Write tests for string pattern resolution (RuleProcessor / token-dictionary tests)
- Ensure semantic and virtual tokens resolve to CSS variables

## Future Architecture Considerations

### Extensibility Points

- Custom pattern definitions
- Plugin marketplace
- Framework adapters
- Build tool integrations

### Scalability

- Multi-threaded parsing for large codebases
- Distributed caching for monorepos
- Incremental type checking
- Remote artifact caching

## Conclusion

Bamboo CSS architecture emphasizes:

- **Modularity**: Clear separation of concerns across packages
- **Performance**: Build-time optimization and zero runtime overhead
- **Type safety**: Full TypeScript integration with generated types
- **Flexibility**: Framework-agnostic with multiple integration points
- **Developer experience**: Autocomplete, helpful errors, and visual tools

The system is designed to scale from small projects to large monorepos while maintaining fast build times and excellent
developer experience.
