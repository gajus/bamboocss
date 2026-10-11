import { describe, expect, test } from 'vitest'
import { pluginVue } from '../../plugin-vue/src'
import { compileVueSfc as compileSfc, createFoldFixture, selectorsFor } from './fixture'

/**
 * A `<script setup>` component, compiled as Vue compiles it, and then by Bamboo.
 *
 * Vue's template reaches a script import through `unref(css)(…)` when it is inlined into
 * `setup()`, which production builds do, and through `$setup.css(…)` when it becomes a render
 * function of its own, which the dev server does, with `setup()` returning the import as
 * `get css() { return css }`. Neither spells a call of `css`, so the first failed the build as a
 * read of the binding, the second threw when rendered, and the getter alone — which plain
 * JavaScript `<script setup>` writes for every import — failed the dev build.
 *
 * The module is assembled the way `@vitejs/plugin-vue` assembles its output: the compiled script
 * and, in dev, the compiled template's render function beside it.
 */
const sfc = (template: string, { lang = 'ts', script = '' } = {}) =>
  `<script setup${lang ? ` lang="${lang}"` : ''}>\n` +
  `import { css } from 'styled-system/css'\nimport { buttonStyle } from 'styled-system/recipes'\n${script}</script>\n` +
  `<template>\n  ${template}\n</template>\n`

/** Compile the component for `mode`, fold it strictly, and check its classes against the sheet. */
const build = (source: string, mode: 'build' | 'dev') => {
  const fixture = createFoldFixture({ plugins: [pluginVue()] })
  // The stylesheet reads the component itself, through the Vue plugin's conversion; the compiler
  // reads Vue's output under the path the plugin gives it (`compilerParsePath`).
  fixture.addFiles({ 'app/src/Comp.vue': source })
  const compiled = compileSfc(source, mode)
  const result = fixture.foldStrict(compiled, 'app/src/Comp.vue.__bamboo__.ts')
  const css = fixture.getStyleSetCss()
  return {
    code: result.code,
    classes: result.folded.flatMap((entry) => entry.classNames),
    skipped: result.skipped.map((entry) => [entry.name, entry.reason]),
    missing: result.folded
      .flatMap((entry) => entry.classNames)
      .flatMap(selectorsFor)
      .filter((selector) => !css.includes(selector)),
  }
}

describe.each(['build', 'dev'] as const)('a `<script setup>` template, compiled for %s', (mode) => {
  test('a `css()` call compiles, to classes the sheet has rules for', () => {
    const result = build(sfc(`<div :class="css({ color: 'red.300' })" />`), mode)

    expect(result.skipped).toEqual([])
    expect(result.classes).toContain('c_red.300')
    expect(result.missing).toEqual([])
    expect(result.code).not.toMatch(/\bcss\(\{|\$setup\.css|_unref\(css\)/)
  })

  test('a config recipe call compiles too', () => {
    const result = build(sfc(`<button :class="buttonStyle({ size: 'sm' })" />`), mode)

    expect(result.skipped).toEqual([])
    expect(result.classes.length).toBeGreaterThan(0)
    expect(result.missing).toEqual([])
  })

  test('beside a call in the script', () => {
    const result = build(
      sfc(`<div :class="[css({ color: 'red.300' }), local]" />`, {
        script: `const local = css({ padding: '2' })\n`,
      }),
      mode,
    )

    expect(result.skipped).toEqual([])
    expect(result.classes).toEqual(expect.arrayContaining(['c_red.300', 'p_2']))
    expect(result.missing).toEqual([])
  })

  test('a call the build cannot know still fails, as itself', () => {
    const result = build(
      sfc(`<div :class="css({ color: tone })" />`, { script: `const tone = defineProps<{ tone: string }>().tone\n` }),
      mode,
    )

    expect(result.skipped).toContainEqual(['css', 'dynamic'])
  })

  test('`css.raw` is reported, not compiled', () => {
    const result = build(sfc(`<div :style="css.raw({ color: 'red.300' })" />`), mode)

    expect(result.skipped).toContainEqual(['css', 'raw-call'])
  })
})

describe('plain JavaScript `<script setup>`, compiled for dev', () => {
  // Vue returns every import of a JavaScript `<script setup>` to its template, used there or not.
  test('an import the template never calls does not fail the build', () => {
    const result = build(
      sfc(`<div :class="local" />`, { lang: '', script: `const local = css({ padding: '2' })\n` }),
      'dev',
    )

    expect(result.skipped).toEqual([])
    expect(result.classes).toEqual(['p_2'])
    expect(result.code).toMatch(/get css\(\) \{ return undefined \}/)
  })
})
