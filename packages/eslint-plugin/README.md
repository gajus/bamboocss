# @bamboocss/eslint-plugin

ESLint rules for [Bamboo CSS](https://bamboocss.com), checked against the config your build reads: token paths that do
not exist, values the build cannot resolve, hardcoded colors, recipes the build cannot name.

## Usage

```bash
pnpm add -D @bamboocss/eslint-plugin
```

In flat config, ESLint 9 and later:

```js
// eslint.config.js
import bamboo from '@bamboocss/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [{ files: ['**/*.{ts,tsx}'], languageOptions: { parser: tsParser } }, bamboo.configs['flat/recommended']]
```

`bamboo.configs['flat/all']` turns on every rule except `prefer-shorthand-properties`, the opposite of
`prefer-longhand-properties`, and the deprecated `no-overridden-by-mixin`. The configs name no parser, so `.vue`,
`.svelte` and `.astro` files keep their own.

In `.eslintrc`, extend `plugin:bamboo/recommended` or `plugin:bamboo/all`, which need `@typescript-eslint/parser`
installed.

To read a config other than the `bamboo.config.ts` found from the file being linted, name it — or a directory to find
one from — relative to ESLint's working directory:

```js
export default [{ settings: { '@bamboocss/configPath': './path/to/bamboo.config.ts' } }]
```

The rules are documented in [`docs/rules`](./docs/rules), and the setup in the
[linting guide](https://bamboocss.com/docs/guides/linting).
