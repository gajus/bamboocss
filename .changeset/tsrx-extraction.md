---
'@bamboocss/plugin-tsrx': patch
'@bamboocss/vite': patch
---

`.tsrx` files using TSRX template syntax — `@{ }` bodies, `@if`/`@for`/`@switch`/`@try`, `<style>` blocks, `{attr}`
shorthand and `<{expr}>` tags — are now extracted instead of failing with "could not be extracted". The conversion is
provided by the opt-in `@bamboocss/plugin-tsrx`. Install it alongside `@tsrx/core` (its optional parser peer), add
`pluginTsrx()` to `plugins` in `bamboo.config.ts`, and include your `.tsrx` files. Plain TSX-shaped `.tsrx` files
continue to extract without the plugin.

The compiler still folds what the bundler hands it, so the TSRX framework plugin (`octane()`, `@tsrx/vite-plugin-react`,
…) must come before `bamboocss()` in `plugins`. When a `.tsrx` module reaches the compiler uncompiled, the compiler's
error now says so and names the plugin order to fix. The dev server fails the request with it; a build logs it before
the bundler's own parse error fails the build.
