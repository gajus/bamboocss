---
'@bamboocss/node': patch
'@bamboocss/vite': patch
'@bamboocss/plugin-vue': patch
---

Compile style calls in `<script setup>` templates, the shape the Vue guide shows.

- A production build compiles a template's `css({ … })` to `unref(css)({ … })`, which failed the build as a read of the
  binding. The dev server compiles it to `$setup.css({ … })`, which was left uncompiled and threw when rendered. Both
  now compile, for `css`, patterns and config recipes alike.
- In dev, `setup()` returns every import of a JavaScript `<script setup>` to its template as `get css() { return css }`,
  which failed the build even when the template never called it. Once every `$setup.css` the template reads is compiled,
  the getter returns `undefined` instead.
- An event handler of statements, `@click="open = false; emit('close')"`, no longer fails extraction of the whole
  component.
