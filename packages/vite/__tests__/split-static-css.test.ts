import { esc } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'
import { splitStaticCss } from '../src/css-output-module'
import { createStaticCompilationSession } from '../src/static-session'

/**
 * The per-route split, on a sheet small enough to check by eye.
 *
 * Precedence lives in the sublayers, so a rule can move to another sheet as long as it keeps
 * its at-rule chain — the utilities layer, its sublayer, any query — and the sheet it lands in
 * opens with the same order statement. What decides where a rule goes is the ownership map:
 * an atom exclusive to a lazily loaded chunk goes with that chunk, everything else stays.
 */
const sheet =
  `@layer reset, base, tokens, utilities;` +
  `@layer utilities{@layer u0,u1,u2;` +
  `@layer u0{.d_flex{display:flex}.shared_only{color:red}.route-a_only{color:blue}}` +
  `@layer u1{@media (width>=48rem){.md\\:route-b_only{color:green}.md\\:shared{color:gray}}}` +
  `@layer u2{.route-a_hover:hover,.shared_hover:hover{opacity:1}}` +
  `}` +
  `:root{--made-with-bamboo:🌱}`

const ownership = new Map([
  ['route-a_only', 'assets/route-a.js'],
  ['route-a_hover', 'assets/route-a.js'],
  ['md:route-b_only', 'assets/route-b.js'],
])

describe('splitting the sheet per chunk', () => {
  test('moves each owned rule under its at-rule chain, and keeps the rest', () => {
    const { css, chunks, moved } = splitStaticCss(sheet, createStaticCompilationSession(), ownership)

    expect(css).not.toContain('route-a_only')
    expect(css).not.toContain('route-b_only')
    expect(css).not.toContain('route-a_hover')
    expect(css, 'a shared atom stays').toContain('.shared_only{color:red}')
    expect(css, 'the shared member of a split rule stays').toContain('.shared_hover:hover{opacity:1}')
    expect(css, 'the shared atom under the query stays').toContain('@media (width>=48rem){.md\\:shared{color:gray}}')
    expect(moved).toEqual(new Set(['route-a_only', 'route-a_hover', 'md:route-b_only']))

    const a = chunks.get('assets/route-a.js')!
    expect(a).toContain('@layer utilities{')
    expect(a, 'the layer order, then the sublayer order, come first in the chunk sheet').toMatch(
      /^@layer reset,base,tokens,utilities;\s*@layer utilities\{@layer u0,u1,u2;/,
    )
    expect(a).toContain('@layer u0{.route-a_only{color:blue}}')
    expect(a, 'its member of the split rule, alone').toContain('@layer u2{.route-a_hover:hover{opacity:1}}')
    expect(a).not.toContain('shared')

    const b = chunks.get('assets/route-b.js')!
    expect(b).toContain('@layer u1{@media (width>=48rem){.md\\:route-b_only{color:green}}}')
    expect(b).not.toContain('shared')
  })

  test('drops a wrapper the move emptied', () => {
    const only = new Map([
      ['md:route-b_only', 'b'],
      ['md:shared', 'b'],
    ])
    const { css } = splitStaticCss(sheet, createStaticCompilationSession(), only)

    expect(css).not.toContain('@layer u1')
    expect(css).not.toContain('@media')
  })

  test('rebuilds an order statement a minifier removed, in the entry as well as the chunk', () => {
    // LightningCSS, Vite 8's default minifier, keeps the order only as the order of the blocks.
    // Once `u1` has left the entry, nothing there would place it between `u0` and `u2`.
    const folded = sheet.replace('@layer u0,u1,u2;', '')
    const only = new Map([
      ['md:route-b_only', 'b'],
      ['md:shared', 'b'],
    ])
    const { css, chunks } = splitStaticCss(folded, createStaticCompilationSession(), only)

    expect(css).not.toContain('@layer u1{')
    expect(css, 'the entry still places the sublayer that left it').toContain('@layer utilities{@layer u0,u1,u2;')
    expect(chunks.get('b')).toMatch(/^@layer reset,base,tokens,utilities;\s*@layer utilities\{@layer u0,u1,u2;/)
  })

  test('opens a chunk sheet with the layers around the utilities, rebuilt where a minifier folded them', () => {
    // LightningCSS keeps a statement only for a layer with no block; the rest is the block order.
    const folded = sheet.replace('@layer reset, base, tokens, utilities;', '@layer reset;@layer base{a{color:inherit}}')
    const { chunks } = splitStaticCss(folded, createStaticCompilationSession(), ownership)

    expect(chunks.get('assets/route-a.js')).toMatch(/^@layer reset,base,utilities;\s*@layer utilities\{/)
  })

  test('declares no layer order in a chunk sheet when the utilities are the only layer', () => {
    const alone = sheet.replace('@layer reset, base, tokens, utilities;', '')
    const { chunks } = splitStaticCss(alone, createStaticCompilationSession(), ownership)

    expect(chunks.get('assets/route-a.js')).toMatch(/^@layer utilities\{/)
  })

  test('leaves the entry’s own layer order as it was', () => {
    const { css } = splitStaticCss(sheet, createStaticCompilationSession(), ownership)

    expect(css).toMatch(/^@layer reset, base, tokens, utilities;@layer utilities\{/)
    expect(css.match(/@layer reset/g)).toHaveLength(1)
  })

  test('keeps a statement that still carries the order, once', () => {
    const { css } = splitStaticCss(sheet, createStaticCompilationSession(), ownership)

    expect(css.match(/@layer u0,u1,u2;/g)).toHaveLength(1)
  })

  test('leaves a sheet with nothing to move byte-identical', () => {
    const { css, chunks } = splitStaticCss(sheet, createStaticCompilationSession(), new Map())

    expect(css).toBe(sheet)
    expect(chunks.size).toBe(0)
  })

  test('leaves a compound selector alone, since no single atom owns it', () => {
    const compound = `@layer utilities{@layer u0{.route-a_only.other{color:blue}}}` + `:root{--made-with-bamboo:🌱}`
    const { css, chunks } = splitStaticCss(compound, createStaticCompilationSession(), ownership)

    expect(css).toContain('.route-a_only.other{color:blue}')
    expect(chunks.size).toBe(0)
  })

  test('reads the escaped spelling of a class', () => {
    const escaped =
      `@layer utilities{@layer u0{.${esc('md:route-b_only')}{color:green}}}` + `:root{--made-with-bamboo:🌱}`
    const { chunks } = splitStaticCss(escaped, createStaticCompilationSession(), ownership)

    expect(chunks.get('assets/route-b.js')).toContain('route-b_only')
  })

  test('ignores a sheet that is not Bamboo’s', () => {
    const { css, chunks } = splitStaticCss(`.route-a_only{color:blue}`, createStaticCompilationSession(), ownership)

    expect(css).toBe(`.route-a_only{color:blue}`)
    expect(chunks.size).toBe(0)
  })
})
