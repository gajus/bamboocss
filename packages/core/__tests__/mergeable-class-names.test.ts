import { createContext, createRuleProcessor } from '@bamboocss/fixture'
import { allCssProperties } from '@bamboocss/is-valid-prop'
import { atomKey, atomKeyCode, createCss, createMergeCss } from '@bamboocss/shared'
import type { Config } from '@bamboocss/types'
import { describe, expect, test } from 'vitest'
import { checkNamingAgreement } from '../src/naming-agreement'

/**
 * Each utility atom is named after the property and conditions it sets, so the runtime `cx` can
 * keep the last class of each and a class passed in overrides a component's own.
 *
 * The stylesheet names a rule in `StyleDecoder`, the compiler names the class it writes into the
 * JavaScript in `createCss`, and the two only meet in the DOM. So everything here is about the
 * names: that both derivations agree under every option feeding them, and that a name carries the
 * structure the runtime reads — `_`, six characters for the property and conditions, `:`, then
 * the value's four characters or the readable name.
 */
const classNamesOf = (config: Config, style: Record<string, unknown>) =>
  createRuleProcessor(config)
    .css(style as never)
    .getClassNames()
    .map((className) => className.replaceAll('\\', ''))

const keyOf = (className: string) => className.replace(/^bam-/, '').slice(1, 7)

describe('mergeable class names', () => {
  const configs: Array<[string, Config]> = [
    ['readable', {}],
    ['hash', { hash: true }],
    ['prefix', { prefix: 'bam' }],
    ['hash + prefix', { hash: true, prefix: 'bam' }],
    ['separator', { separator: '-' }],
    ['hash + prefix + separator', { hash: true, prefix: 'bam', separator: '-' }],
  ]

  test.each(configs)('the stylesheet and the compiler agree: %s', (_name, config) => {
    expect(checkNamingAgreement(createContext(config) as never)).toBeUndefined()
  })

  test.each(configs)('every atom the compiler names has the rule the stylesheet emits: %s', (_name, config) => {
    const ctx = createContext(config)
    const style = { width: '480px', color: 'red.300', md: { width: '640px' }, _hover: { color: 'blue.500' } }
    const cssContext = {
      hash: Boolean(ctx.hash.className),
      conditions: { shift: ctx.conditions.shift, finalize: ctx.conditions.finalize },
      utility: {
        prefix: ctx.utility.prefix,
        hasShorthand: ctx.utility.hasShorthand,
        resolveShorthand: ctx.utility.resolveShorthand.bind(ctx.utility),
        transform: ctx.utility.transform.bind(ctx.utility),
      },
    }
    const compiled = createCss(cssContext as never)(createMergeCss(cssContext as never).mergeCss(style))
      .split(' ')
      .sort()

    expect(compiled).toEqual(classNamesOf(config, style).sort())
  })

  test('a readable name is the code for its property and conditions, then the name it had', () => {
    const [width, mdWidth] = classNamesOf({}, { width: '480px', md: { width: '640px' } })

    expect(width).toMatch(/^_[\w-]{6}:w_480px$/)
    expect(mdWidth).toMatch(/^_[\w-]{6}:md:w_640px$/)
  })

  test('a hashed name is the code for its property and conditions, a colon, then its value', () => {
    for (const className of classNamesOf({ hash: true }, { width: '480px', md: { width: '640px' } })) {
      expect(className).toMatch(/^_[\w-]{6}:[\w-]{5}$/)
    }
  })

  test('two values of one property under one set of conditions share their first code, and nothing else does', () => {
    const [a, b, md, hover, color] = classNamesOf({ hash: true }, {})
      .concat(classNamesOf({ hash: true }, { width: '480px' }))
      .concat(classNamesOf({ hash: true }, { width: '640px' }))
      .concat(classNamesOf({ hash: true }, { md: { width: '640px' } }))
      .concat(classNamesOf({ hash: true }, { _hover: { width: '640px' } }))
      .concat(classNamesOf({ hash: true }, { color: 'red.300' }))

    expect(keyOf(a!)).toBe(keyOf(b!))
    expect(a).not.toBe(b)
    expect(new Set([keyOf(a!), keyOf(md!), keyOf(hover!), keyOf(color!)]).size).toBe(4)
  })

  test('the code is the same in a readable and a hashed name, so either build merges alike', () => {
    const [readable] = classNamesOf({}, { md: { width: '640px' } })
    const [hashed] = classNamesOf({ hash: true }, { md: { width: '640px' } })

    expect(keyOf(readable!)).toBe(keyOf(hashed!))
  })

  test('a shorthand and the property it stands for are one key, as in `css()`', () => {
    const [short] = classNamesOf({ hash: true }, { w: '480px' })
    const [long] = classNamesOf({ hash: true }, { width: '480px' })

    expect(short).toBe(long)
  })

  test('the prefix comes first, ahead of the marker the runtime looks for', () => {
    for (const className of classNamesOf({ prefix: 'bam' }, { width: '480px', md: { width: '640px' } })) {
      expect(className).toMatch(/^bam-_[\w-]{6}:/)
    }
  })

  test('an important declaration keeps its `!`, after the name', () => {
    const [className] = createRuleProcessor({ hash: true })
      .css({ width: '480px !important' })
      .toCss()
      .match(/\.(_[\w-]{6}\\:[\w-]{5}\\!)/)!
      .slice(1)

    expect(className).toMatch(/^_[\w-]{6}\\:[\w-]{5}\\!$/)
  })

  test('refuses to give one merge code to two properties', () => {
    const { utility } = createContext()
    utility.claimAtomKeyCode('|width', 'aaaaaa')

    expect(() => utility.claimAtomKeyCode('|width', 'aaaaaa'), 'the same key again').not.toThrow()
    expect(() => utility.claimAtomKeyCode('|color', 'aaaaaa')).toThrow(/same merge code `aaaaaa`/)
  })

  /**
   * What a project writes without nesting conditions or defining its own: every property, CSS's
   * own and every utility, under no condition and under each condition the presets define. Two of
   * them sharing a code would fail any build that wrote both, and there is no other naming to
   * fall back to, so none may. Five characters had twelve such pairs here, the sixth comes from a
   * second hash seeded so that it has none. @see ATOM_KEY_LENGTH
   */
  test('no two keys a project writes without nesting or defining conditions share a code', () => {
    const ctx = createContext()
    const properties = new Set<string>()
    for (const property of [...Object.keys(ctx.utility.config), ...allCssProperties]) {
      properties.add(ctx.utility.resolveShorthand(property))
    }
    const conditions = new Set<string>()
    for (const condition of ctx.conditions.keys()) {
      const [finalized] = ctx.conditions.finalize([condition])
      if (finalized) conditions.add(finalized)
    }

    const claimed = new Map<string, string>()
    const collisions: string[] = []
    for (const property of properties) {
      for (const key of [
        atomKey([], property),
        ...[...conditions].map((condition) => atomKey([condition], property)),
      ]) {
        const code = atomKeyCode(key)
        const other = claimed.get(code)
        if (other === undefined) claimed.set(code, key)
        else collisions.push(`${other} and ${key}`)
      }
    }

    expect(claimed.size).toBeGreaterThan(150_000)
    expect(collisions).toEqual([])
  })
})
