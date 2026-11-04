---
'@bamboocss/plugin-tsrx': patch
'@bamboocss/node': patch
'@bamboocss/vite': patch
---

`.tsrx` files using TSRX template syntax — `@{ }` bodies, `@if`/`@for`/`@switch`/`@try`, `<style>` blocks, `{attr}`
shorthand and `<{expr}>` tags — are now extracted instead of failing with "could not be extracted". The conversion is
provided by `@bamboocss/plugin-tsrx`, auto-injected like the Svelte and Vue plugins. It parses with `@tsrx/core`, an
optional peer: install it alongside the TSRX framework plugin your project already has, and `.tsrx` files under
`include` just work. Without it, a `.tsrx` file is read as the plain TSX most of them are, and a file that does use
template syntax fails as before.

The compiler still folds what the bundler hands it, so the TSRX framework plugin (`octane()`, `@tsrx/vite-plugin-react`,
…) must come before `bamboocss()` in `plugins`. When a `.tsrx` module reaches the compiler uncompiled, the compiler's
error now says so and names the plugin order to fix. The dev server fails the request with it; a build logs it before
the bundler's own parse error fails the build.
