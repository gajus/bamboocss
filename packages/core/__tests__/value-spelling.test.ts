import { createContext, createRuleProcessor } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/**
 * One spelling of a value is one atom, because one spelling is one rule.
 *
 * The class name a declaration ships under comes from `Utility.transform`, which folds the
 * value to a canonical spelling first — `#ffffff` and `#fff` both become `.c_\#fff`. The
 * atom's *identity*, though, is the encoder's hash, and that used to be taken from the value
 * as written. So the two spellings were two atoms resolving to one rule, and which of them
 * positioned that rule depended on the order files happened to be read in.
 *
 * That is what un-styled `cx(base, variant)` in css-in-js-bench: the button's base wrote
 * `#ffffff` while other case files wrote `#fff`, so the base's rule was positioned by an
 * unrelated file and landed after the variants that were supposed to override it. No amount
 * of ordering could fix it, because below the ordering layer the two were not one atom.
 *
 * `canonical-value.ts` already existed for exactly this — it was simply applied on the
 * class-name path and not on the hashing path.
 */
describe('one spelling per value', () => {
  test('equivalent hex spellings are a single atom', () => {
    const ctx = createContext() as any
    for (const value of ['#ffffff', '#fff', '#FFF', '#FFFFFF']) ctx.encoder.processAtomic({ color: value })

    expect([...ctx.encoder.atomic]).toEqual(['color]___[value:#fff'])
  })

  test('equivalent numeric spellings are a single atom', () => {
    const ctx = createContext() as any
    for (const value of ['.5rem', '0.5rem', '0.50rem']) ctx.encoder.processAtomic({ padding: value })

    expect([...ctx.encoder.atomic]).toEqual(['padding]___[value:0.5rem'])
  })

  test('a spelling difference no longer splits one rule in two', () => {
    // The two files spell white differently. Before the fold they were two atoms for one
    // rule, and the second one to be decoded decided where that rule sat; the file that
    // declared it had no say. Now there is one atom, positioned once.
    const button = `
      import { css, cx } from 'styled-system/css'
      const base = css({ color: "#ffffff" })
      const variant = css({ color: "#6b7280" })
      export const B = (p) => cx(base, p.q && variant)
    `
    const elsewhere = `
      import { css } from 'styled-system/css'
      export const plain = css({ color: "#fff" })
    `

    const ctx = createContext() as any
    const files = { 'src/a-elsewhere.tsx': elsewhere, 'src/b-button.tsx': button }
    const paths = Object.keys(files).map((file) => ctx.runtime.path.abs(ctx.config.cwd, file))
    Object.values(files).forEach((source, index) => ctx.project.addSourceFile(paths[index], source))
    ctx.getFiles = () => paths
    ctx.parseFiles()
    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    const css = ctx.getCss(sheet) as string

    // One rule for white, and it keeps the position its declaring files agree on: both write
    // it before `#6b7280`, so the base still precedes the variant that overrides it.
    expect(css.match(/\.c_\\#fff\b/g)).toHaveLength(1)
    expect(css.indexOf('#fff')).toBeLessThan(css.indexOf('#6b7280'))
  })

  test('a recipe variant key that looks numeric is left as written', () => {
    // A variant value is a key of the `variants` object, not a CSS value. Folding `1.0` to
    // `1` here makes the decoder's lookup miss while the runtime still asks for `--size_1.0`.
    const classNames = createRuleProcessor()
      .cva({
        className: 'rt',
        variants: { size: { '1.0': { padding: '1' }, '.5': { padding: '2' } } },
      } as never)
      .getClassNames()
      .map((className: string) => className.replaceAll('\\', ''))

    expect(classNames).toContain('rt--size_1.0')
    expect(classNames).toContain('rt--size_.5')
  })

  test('the emitted declaration is unchanged by the fold', () => {
    const processor = createRuleProcessor()
    processor.css({ color: '#ffffff' })
    processor.css({ boxShadow: '0 2px 4px rgba(0,0,0,.02)' })
    const css = processor.toCss()

    expect(css).toContain('color: #fff')
    // The alpha was already written `0.02` in both the class name and the declaration; only
    // the hash disagreed.
    expect(css).toContain('rgba(0,0,0,0.02)')
  })
})
