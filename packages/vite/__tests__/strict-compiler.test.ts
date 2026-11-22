import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { bamboocss } from '../src/plugin'
import { compileVueSfc } from './fixture'

/**
 * The compiler has no runtime styling fallback. These cases pin the diagnostics for every
 * source shape that cannot be represented by the finite StyleSet model.
 */
const cwd = join(dirname(fileURLToPath(import.meta.url)), '../../../sandbox/codegen')

const hookOf = <T>(hook: T | { handler: T } | undefined): T | undefined =>
  typeof hook === 'function' ? hook : (hook as { handler: T } | undefined)?.handler

const run = async (code: string, file: string) => {
  const plugins = bamboocss({ cwd, reportSummary: false })
  const plugin = plugins.find((p) => p.name === 'bamboocss:compiler')!
  // A single-file component's compiled script is the post-order compiler's, as in a real build.
  const transformer = /\.(?:vue|svelte|astro)$/.test(file)
    ? plugins.find((p) => p.name === 'bamboocss:compiler-sfc')!
    : plugin

  await hookOf(plugin.buildStart)?.call({} as never, {} as never)
  await hookOf(transformer.transform)?.call({ addWatchFile: () => {} } as never, code, join(cwd, file), {} as never)
  // A real bundler calls buildEnd once. Cache that outcome so a test can match several parts of
  // one diagnostic without opening a second lifecycle after the failed generation rolled back.
  let finished = false
  let failure: unknown
  return () => {
    if (!finished) {
      finished = true
      try {
        hookOf(plugin.buildEnd)?.call({} as never, undefined as never)
      } catch (error) {
        failure = error
      }
    }
    if (failure !== undefined) throw failure
  }
}

const src = (body: string) => `import { css } from 'styled-system/css'\n${body}\n`

describe('strict compiler', () => {
  test('fails on a call the build could not resolve', async () => {
    const end = await run(src(`export const f = (p) => css({ ...p, color: 'red.300' })`), 'src/strict-spread.tsx')

    // The message has to name the file and the line, because the fix is at a call site and
    // a count alone leaves the user grepping for it.
    expect(end).toThrow(/could not be compiled/)
    expect(end).toThrow(/strict-spread\.tsx/)
    expect(end).toThrow(/dynamic/)
  }, 60_000)

  test('fails on css.raw, which returns a style object rather than a class', async () => {
    const end = await run(src(`export const r = css.raw({ color: 'red.300' })`), 'src/strict-raw.tsx')

    expect(end).toThrow(/raw-call/)
  }, 60_000)

  test('fails on keyframes() whose stops it cannot read, and says why', async () => {
    const end = await run(
      `import { keyframes } from 'styled-system/css'\nexport const fade = (to) => keyframes({ from: { opacity: 0 }, to: { opacity: to } })\n`,
      'src/strict-keyframes.tsx',
    )

    expect(end).toThrow(/keyframes\(\) — dynamic: the name it returns is a hash of its stops/)
    // Nothing was refused: the parameter is the caller's.
    expect(end).not.toThrow(/a helper's body may declare values/)
  }, 60_000)

  test('passes keyframes() whose stops it can read', async () => {
    const end = await run(
      `import { css, keyframes } from 'styled-system/css'\nconst fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })\nexport const toast = css({ animation: \`\${fadeIn} 0.2s\` })\n`,
      'src/strict-keyframes-static.tsx',
    )

    expect(end).not.toThrow()
  }, 60_000)

  test('fails on a responsive recipe selection, and says where the condition goes', async () => {
    const end = await run(
      `import { cva } from 'styled-system/css'\nconst badge = cva({ variants: { size: { sm: { fontSize: 'sm' }, lg: { fontSize: 'lg' } } } })\nexport const cls = badge({ size: { base: 'sm', md: 'lg' } })\n`,
      'src/strict-responsive-selection.tsx',
    )

    expect(end).toThrow(/badge\(\) — recipe-call: `size` is selected with an object/)
    expect(end).toThrow(/write the condition inside the variant's styles/)
  }, 60_000)

  test('fails on a runtime style leaf', async () => {
    const end = await run(src(`export const f = (tone) => css({ color: tone })`), 'src/strict-leaf.tsx')
    expect(end).toThrow(/dynamic|runtime-binding/)
  }, 60_000)

  test('fails on a nested key that is neither a property nor a condition, and says what it may have meant', async () => {
    const end = await run(
      src(
        `export const A = css({ _hovr: { color: 'red.300' } })\nexport const B = css({ has: { svg: { color: 'red.300' } } })`,
      ),
      'src/strict-unknown-condition.tsx',
    )

    expect(end).toThrow(/2: css\(\) — unknown-condition: `_hovr` is not a condition; did you mean `_hover`\?/)
    expect(end).toThrow(/3: css\(\) — unknown-condition: `has` is not a condition; did you mean `'&:has\(svg\)'`\?/)
    expect(end).toThrow(
      /`unknown-condition` is a key nested in a style object that is neither a property nor a condition/,
    )
    // The two fail as themselves, not as calls that stayed for another reason, and the advice for
    // values the build cannot know is not given for a typo.
    expect(end).toThrow(/^bamboocss: 2 call\(s\) could not be compiled\./)
    expect(end).not.toThrow(/— (dynamic|runtime-binding)|Make the values finite/)
  }, 60_000)

  // A `<script setup>` component as the dev server compiles it: the template's calls read off
  // `$setup`, and every import of a JavaScript `<script setup>` returned to the template as a getter.
  test('passes a Vue `<script setup>` component compiled for the dev server', async () => {
    const source =
      `<script setup>\nimport { css } from 'styled-system/css'\nconst local = css({ padding: '2' })\n</script>\n` +
      `<template>\n  <div :class="[css({ color: 'red.300' }), local]" />\n</template>\n`
    const end = await run(compileVueSfc(source, 'dev', join(cwd, 'src/strict-vue.vue')), 'src/strict-vue.vue')

    expect(end).not.toThrow()
  }, 60_000)

  describe('a call the evaluator refused', () => {
    test('says what the helper does that the compiler does not run, and where', async () => {
      const end = await run(
        src(
          `const tone = (t) => {\n  switch (t) { case 'a': return { color: 'red.300' } }\n  return {}\n}\nexport const A = css(tone('a'))`,
        ),
        'src/strict-refusal.tsx',
      )

      expect(end).toThrow(/`tone` uses a `switch` statement at src\/strict-refusal\.tsx:3:3/)
      expect(end).toThrow(/a helper's body may declare values, branch with `if` and return/)
    }, 60_000)

    test('says which binding is written after its declaration, and by what', async () => {
      const end = await run(
        src(`const base = { color: 'red.300' }\nbase.color = 'blue.300'\nexport const A = css(base)`),
        'src/strict-write.tsx',
      )

      expect(end).toThrow(
        /`base` is written after its declaration, by `base\.color = 'blue\.300'` at src\/strict-write\.tsx:3:1/,
      )
    }, 60_000)
  })

  /**
   * A call the evaluator refused nothing in still says what it cannot know, and where: the line
   * used to read `css() — dynamic` and stop, with advice about making values finite that fitted a
   * call holding finite values as badly as one holding a parameter.
   */
  describe('a call the build cannot know', () => {
    test.each([
      [
        'a parameter',
        `export const a = (h) => css({ height: h })`,
        /2: css\(\) — dynamic: `h` at src\/strict-unknown-a-parameter\.tsx:2:39 is a parameter, so only the caller knows its value/,
        /A value known only at runtime has no class to compile to/,
      ],
      [
        'a read of a parameter',
        `export const a = (props) => css({ color: props.tone })`,
        /`props\.tone` at src\/strict-unknown-a-read-of-a-parameter\.tsx:2:42 reads a parameter/,
        /belongs in the `style` attribute/,
      ],
      [
        'a parameter a declaration reads',
        `export const a = (props) => {\n  const tone = props.tone\n  return css({ color: tone })\n}`,
        // Where the value comes from, which is not where the call reads it.
        /4: css\(\) — dynamic: `props\.tone` at src\/strict-unknown-a-parameter-a-declaration-reads\.tsx:3:16 reads a parameter/,
        /A value known only at runtime/,
      ],
      [
        'an operand',
        `export const a = (n) => css({ width: n * 4 })`,
        /`n` at src\/strict-unknown-an-operand\.tsx:2:38 is a parameter/,
        /A value known only at runtime/,
      ],
      [
        'a lookup',
        `const pads = { sm: { px: '2' }, lg: { px: '6' } }\nexport const a = (size) => css(pads[size])`,
        /`pads\[size\]` at src\/strict-unknown-a-lookup\.tsx:3:32 reads a property by a key known only at runtime/,
        /declare them as a recipe's variant/,
      ],
      [
        'a choice inside a spread',
        `const on = { color: 'white' }\nconst off = { color: 'black' }\nexport const a = (active) => css({ ...(active ? on : off) })`,
        /`\.\.\.\(active \? on : off\)` at src\/strict-unknown-a-choice-inside-a-spread\.tsx:4:36 is a choice inside a spread, which does not compile/,
        /pass it as an argument of its own, `css\(base, active \? on : off\)`/,
      ],
      [
        'a spread',
        `export const a = (rest) => css({ color: 'red.300', ...rest })`,
        /`\.\.\.rest` at src\/strict-unknown-a-spread\.tsx:2:52 spreads what the build cannot enumerate/,
        /A spread has to resolve to an object the build can read/,
      ],
      [
        'a computed key',
        `export const a = (key) => css({ [key]: 'red.300' })`,
        /`key` at src\/strict-unknown-a-computed-key\.tsx:2:34 is a computed key the build cannot evaluate/,
        /a computed key has to evaluate/,
      ],
      [
        'too many choices',
        `export const a = (a, b, c, d, e, f) =>\n  css({ color: a ? 'red.300' : 'blue.300', bg: b ? 'red.300' : 'blue.300', p: c ? '1' : '2', m: d ? '1' : '2', gap: e ? '1' : '2', w: f ? '1' : '2' })`,
        /3: css\(\) — dynamic: its 6 choices give more combinations of answers than one call compiles to/,
        /One `css\(\)` call compiles to at most 32 combinations/,
      ],
      [
        'a test reading a Bamboo import',
        `import { cx } from 'styled-system/css'\nexport const a = () => css({ color: cx ? 'red.300' : 'blue.300' })`,
        /the test `cx` at src\/strict-unknown-a-test-reading-a-Bamboo-import\.tsx:3:37 reads a Bamboo import or a recipe, which the compiled call no longer holds/,
        /holds no Bamboo import or recipe for it to read/,
      ],
      [
        'a choice written with &&',
        `export const a = (active) => css({ color: active && 'red.300' })`,
        /`active && 'red\.300'` at src\/strict-unknown-a-choice-written-with-&&\.tsx:2:43 chooses with `&&`/,
        /write it as a ternary, `active \? 'red\.300' : undefined`/,
      ],
      [
        'a choice inside a value',
        `export const a = (compact) => css({ width: \`\${compact ? 2 : 4}px\` })`,
        /`compact \? 2 : 4` at src\/strict-unknown-a-choice-inside-a-value\.tsx:2:47 is a choice inside a value, where none compiles/,
        /lift it to the property/,
      ],
      [
        'a choice in a pattern',
        `import { flex } from 'styled-system/patterns'\nexport const a = (compact) => flex({ gap: compact ? '2' : '4' })`,
        /`compact \? '2' : '4'` at src\/strict-unknown-a-choice-in-a-pattern\.tsx:3:43 is a choice, which `flex\(\)` does not compile/,
        /choose between whole calls/,
      ],
      [
        'a global',
        `export const a = () => css({ width: window.innerWidth })`,
        /`window\.innerWidth` at src\/strict-unknown-a-global\.tsx:2:37 reads a global, which only the runtime knows/,
        /A value known only at runtime/,
      ],
      [
        'a destructuring default',
        `export const a = (props) => {\n  const { size = '2' } = props\n  return css({ p: size })\n}`,
        /`size` at src\/strict-unknown-a-destructuring-default\.tsx:4:19 comes from a destructuring default/,
        /A value known only at runtime/,
      ],
    ])(
      'says so of %s, and what to do about it',
      async (label, body, line, advice) => {
        const end = await run(src(body), `src/strict-unknown-${label.replaceAll(' ', '-')}.tsx`)

        expect(end).toThrow(line)
        expect(end).toThrow(advice)
        // Nothing was refused, and no rule written for a class makes a call compile.
        expect(end).not.toThrow(/a helper's body may declare values/)
        expect(end).not.toThrow(/staticCss/)
      },
      60_000,
    )

    test('says each kind of advice once, however many calls need it', async () => {
      const end = await run(
        src(`export const a = (h) => css({ height: h })\nexport const b = (w) => css({ width: w })`),
        'src/strict-unknown-twice.tsx',
      )

      expect(end).toThrow(/2: css\(\) — dynamic: `h`/)
      expect(end).toThrow(/3: css\(\) — dynamic: `w`/)
      let message = ''
      try {
        end()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message.split('A value known only at runtime').length).toBe(2)
    }, 60_000)

    test('says it of a token() path and of keyframes() stops', async () => {
      const token = await run(
        `import { token } from 'styled-system/tokens'\nexport const a = (path) => token(path)\n`,
        'src/strict-unknown-token.tsx',
      )
      const keyframes = await run(
        `import { keyframes } from 'styled-system/css'\nexport const fade = (to) => keyframes({ from: { opacity: 0 }, to: { opacity: to } })\n`,
        'src/strict-unknown-keyframes.tsx',
      )

      expect(token).toThrow(/token\(\) — dynamic: `path` at src\/strict-unknown-token\.tsx:2:34 is a parameter/)
      expect(keyframes).toThrow(
        /keyframes\(\) — dynamic: the name it returns is a hash of its stops, so they have to be known at build time: `to` at src\/strict-unknown-keyframes\.tsx:2:78 is a parameter/,
      )
    }, 60_000)
  })

  test('says nothing when every call folded', async () => {
    const end = await run(src(`export const cls = css({ color: 'red.300' })`), 'src/strict-static.tsx')

    expect(end).not.toThrow()
  }, 60_000)

  test('accepts a compile-time cva definition', async () => {
    const end = await run(
      `import { cva } from 'styled-system/css'\nexport const b = cva({ base: { color: 'red.300' } })\n`,
      'src/strict-cva.tsx',
    )

    expect(end).not.toThrow()
  }, 60_000)

  test('compiles static and finite dynamic calls of an inline recipe', async () => {
    const end = await run(
      `import { cva } from 'styled-system/css'\n` +
        `const badge = cva({ base: { color: 'red.300' }, variants: { tone: { a: { color: 'blue.300' } } } })\n` +
        `export const cls = badge({ tone: 'a' })\n` +
        `export const make = (tone) => badge({ tone })\n`,
      'src/strict-cva-call.tsx',
    )

    expect(end).not.toThrow()
  }, 60_000)

  describe('a wrapper whose variants arrive as props', () => {
    test('compiles a config recipe and keeps an unknown external class as a cx join', async () => {
      const end = await run(
        `import { cx } from 'styled-system/css'
import { button } from 'styled-system/recipes'
export const B = (props) => {
  const [variantProps, rest] = button.splitVariantProps(props)
  return <button className={cx(button(variantProps), rest.className)} />
}
`,
        'src/strict-config-recipe-wrapper.tsx',
      )

      expect(end).not.toThrow()
    }, 60_000)

    test('passes when a config recipe is the complete class expression', async () => {
      const end = await run(
        `import { button } from 'styled-system/recipes'
export const B = (props) => {
  const [variantProps, rest] = button.splitVariantProps(props)
  return <button {...rest} className={button(variantProps)} />
}
`,
        'src/strict-config-recipe-compiled.tsx',
      )

      expect(end).not.toThrow()
    }, 60_000)

    test('compiles an inline recipe composed with an unknown external class', async () => {
      const end = await run(
        `import { cva, cx } from 'styled-system/css'
const button = cva({ base: { color: 'red.300' }, variants: { visual: { solid: { bg: 'blue.300' } } } })
export const B = (props) => {
  const [variantProps, rest] = button.splitVariantProps(props)
  return <button className={cx(button(variantProps), rest.className)} />
}
`,
        'src/strict-inline-recipe-wrapper.tsx',
      )

      expect(end).not.toThrow()
    }, 60_000)

    /** Unaffected: a config recipe call whose selection resolves folds like anything else. */
    test('passes for a config recipe call the build can resolve', async () => {
      const end = await run(
        `import { button } from 'styled-system/recipes'\nexport const cls = button({ visual: 'solid' })\n`,
        'src/strict-config-recipe-static.tsx',
      )

      expect(end).not.toThrow()
    }, 60_000)
  })

  /**
   * The ledger only holds calls something recognised, so a guarantee built on it is worth
   * what the recogniser is — and these are the shapes nothing recognises. Each folds nothing,
   * reports nothing, and keeps the module live unless the final binding scan rejects it.
   */
  describe('a binding the rewrite left behind', () => {
    /**
     * A module whose only bamboo usage is a bare reference. Nothing records it, so the ledger
     * is empty and so is the parser result — which meant the module was skipped before the
     * fold ever saw it before the final binding scan existed.
     */
    test('a binding passed on rather than called', async () => {
      const end = await run(
        `import { css } from 'styled-system/css'
export const pass = css
`,
        'src/strict-reexport.tsx',
      )

      expect(end).toThrow(/could not be compiled/)
      expect(end).toThrow(/runtime-binding/)
      expect(end).toThrow(/strict-reexport\.tsx/)
    }, 60_000)

    test('a binding handed to something the build cannot follow', async () => {
      const end = await run(
        `import { css } from 'styled-system/css'
const apply = (fn, v) => fn(v)
export const f = (p) => apply(css, p)
`,
        'src/strict-indirect.tsx',
      )

      expect(end).toThrow(/runtime-binding/)
    }, 60_000)

    /** Compiler-added helpers must not be mistaken for retained styling bindings. */
    test('is not reported for the helpers the fold itself adds', async () => {
      const end = await run(
        `import { css } from 'styled-system/css'
export const f = (p) => css({ color: 'red.300' }, p)
`,
        'src/strict-helpers.tsx',
      )

      // The call is still dynamic. What must not appear is a second complaint about a
      // compiler helper.
      expect(end).toThrow(/dynamic/)
      expect(end).not.toThrow(/runtime-binding/)
    }, 60_000)
  })

  /**
   * The module the fold threw on — the blind spot the ledger cannot see by construction.
   *
   * A throw in `transform` was caught, logged, and returned `null`, so the module contributed
   * to neither the folded column nor the skipped one and the survivor check saw a file that did
   * not exist. That is the same silence this option was added to close, one level up: a build
   * whose whole point is "nothing still calls `css()`" cannot make that claim about a module
   * nobody checked. A retired token spelling inside a `cva` is what reaches it — a recipe's
   * styles are resolved while the file is parsed, so the throw lands inside the fold.
   */
  describe('a module the fold threw on', () => {
    const BROKEN =
      `import { cva } from 'styled-system/css'\n` +
      `export const t = cva({ base: { boxShadow: '0 0 0 2px {colors.red.300/35}' } })\n`

    test('counts as a survivor rather than as nothing', async () => {
      const end = await run(BROKEN, 'src/strict-threw.tsx')

      expect(end).toThrow(/could not be compiled/)
      expect(end).toThrow(/compile-failed/)
      expect(end).toThrow(/strict-threw\.tsx/)
    }, 60_000)

    /** The advice for a declined call site does not apply, so the message says where to look. */
    test('points at the error that was logged for it', async () => {
      const end = await run(BROKEN, 'src/strict-threw-why.tsx')

      expect(end).toThrow(/see the error logged for it above/)
    }, 60_000)
  })
})

/**
 * A `token()` or `keyframes()` call inside a recipe config goes with the declaration the compiler
 * erases. It used to be rewritten in place first, which left the declaration standing and
 * reported the `cva` import as `runtime-binding` at it, a diagnostic naming neither the config nor
 * the call.
 */
describe('a call inside a recipe config', () => {
  const withToken = (body: string) =>
    `import { cva, keyframes } from 'styled-system/css'\nimport { token } from 'styled-system/tokens'\n${body}\n`

  test('token() compiles', async () => {
    const end = await run(
      withToken(`const badge = cva({ base: { color: token('colors.red.300') } })\nexport const cls = badge()`),
      'src/strict-recipe-token.tsx',
    )

    expect(end).not.toThrow()
  }, 60_000)

  test('the string form compiles', async () => {
    const end = await run(
      withToken(`const badge = cva({ base: { color: 'token(colors.red.300)' } })\nexport const cls = badge()`),
      'src/strict-recipe-token-string.tsx',
    )

    expect(end).not.toThrow()
  }, 60_000)

  test('keyframes() compiles', async () => {
    const end = await run(
      withToken(
        `const spinner = cva({ base: { animation: \`\${keyframes({ to: { rotate: '360deg' } })} 1s linear infinite\` } })\nexport const cls = spinner()`,
      ),
      'src/strict-recipe-keyframes.tsx',
    )

    expect(end).not.toThrow()
  }, 60_000)
})

/**
 * `token(path) ?? '#fff'` is how the docs say to write a path that may name nothing, now the
 * fallback argument is retired. Every build failed it whatever the token: the style around it as
 * `dynamic`, and the call as `unresolved-token` where the path named none.
 */
describe('a token() call whose result is tested or defaulted', () => {
  const withToken = (body: string) =>
    `import { css } from 'styled-system/css'\nimport { token } from 'styled-system/tokens'\n${body}\n`

  test('compiles, in a style and standing alone, whether or not the token exists', async () => {
    const end = await run(
      withToken(
        [
          `export const named = css({ color: token('colors.red.300') ?? '#fff' })`,
          `export const unnamed = css({ color: token('colors.brand') ?? '#fff' })`,
          `export const alone = token('colors.brand') ?? '#fff'`,
        ].join('\n'),
      ),
      'src/strict-token-default.tsx',
    )

    expect(end).not.toThrow()
  }, 60_000)

  test('a call naming no token whose result is used as it is still fails', async () => {
    const end = await run(
      withToken(`export const unnamed = css({ color: token('colors.brand') })`),
      'src/strict-token-unguarded.tsx',
    )

    expect(end).toThrow(/unresolved-token/)
    expect(end).toThrow(/`token\('colors\.brand'\)` names no token/)
  }, 60_000)
})

/**
 * A `token.value()` of a number, `zIndex.modal` in the default preset, failed every build standing
 * alone as `token() — unresolved-token`, a token that exists: the compiler wrote string literals only.
 */
describe('a token.value() of a number', () => {
  test('compiles to the number', async () => {
    const end = await run(
      [
        `import { token } from 'styled-system/tokens'`,
        `export const modal = token.value('zIndex.modal')`,
        `export const hidden = token.value('zIndex.hide')`,
      ].join('\n'),
      'src/strict-token-number.tsx',
    )

    expect(end).not.toThrow()
  }, 60_000)
})

/**
 * A value holding the retired `token(path, fallback)` form, or a curly reference, is a literal the
 * stylesheet cannot write, and `bamboo cssgen` says so with what to write instead. The compiler
 * said `css() — dynamic`, and to make the values finite.
 */
describe('a value holding a retired token reference', () => {
  test.each([
    [
      'the fallback form',
      `'token(colors.red.300, #fff)'`,
      'css() — dynamic: `token(colors.red.300, #fff)` in the value `token(colors.red.300, #fff)` uses the retired `token(path, fallback)` form. Write `token(colors.red.300)` instead.\n',
    ],
    [
      'the curly form',
      `'{colors.red.300}'`,
      'css() — dynamic: `{colors.red.300}` in the value `{colors.red.300}` is the retired token reference syntax. Write `token(colors.red.300)` instead.\n',
    ],
  ])(
    'fails in the build’s own words: %s',
    async (label, value, line) => {
      const end = await run(
        src(`export const a = css({ color: ${value} })`),
        `src/strict-retired-${label.replaceAll(' ', '-')}.tsx`,
      )

      expect(end).toThrow(line)
      // Which is not code the compiler refused to run.
      expect(end).not.toThrow(/a helper's body may declare values/)
    },
    60_000,
  )
})
