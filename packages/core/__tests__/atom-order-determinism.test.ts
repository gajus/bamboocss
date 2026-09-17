import { createContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/**
 * The emitted sheet is a function of the source inventory, not of the order modules arrive in.
 *
 * Rules that agree on specificity, condition and property priority share a utility sublayer,
 * and within one sublayer the winner is still decided by source order. So the order atoms are
 * written in is part of the sheet's meaning, and anything that can vary between two builds of
 * one project can change which declaration wins.
 *
 * A bundler transform — the `parse` lane — arrives in whatever order the module graph is
 * walked, and that order differs between a client and an SSR environment of the same app.
 * Ranking owners by arrival therefore made the two environments emit the same atoms in
 * different orders: `cx(css({ color }), css({ color }))` resolved one way in the server's
 * sheet and the other way in the client's, which is what shipped unstyled variants to a
 * pre-hydration benchmark. Owners are ranked by their file's place in the inventory instead.
 */
const FILES = ['src/a.tsx', 'src/b.tsx', 'src/c.tsx', 'src/d.tsx']

const STYLES: Record<string, Record<string, string>> = {
  'src/a.tsx': { color: '#fff' },
  'src/b.tsx': { color: '#6b7280' },
  'src/c.tsx': { color: '#111827' },
  'src/d.tsx': { color: '#2563eb' },
}

/** Emit the sheet with the `parse` lane visiting files in `order`. */
const emit = (order: readonly string[], lane: 'parse' | 'extract' = 'parse') => {
  const ctx = createContext() as any
  // Both environments are handed the same, deterministic inventory.
  ctx.encoder.reconcileFileOwnerOrder('extract', FILES)
  for (const file of order) {
    ctx.encoder.withOwner(lane, file, () => ctx.encoder.processAtomic(STYLES[file]))
  }
  const sheet = ctx.createSheet()
  ctx.appendParserCss(sheet)
  return ctx.getCss(sheet) as string
}

describe('atom order is decided by the inventory, not by arrival', () => {
  test('two transform orders emit a byte-identical sheet', () => {
    const inOrder = emit(FILES)
    const shuffled = emit(['src/c.tsx', 'src/a.tsx', 'src/d.tsx', 'src/b.tsx'])

    expect(shuffled).toBe(inOrder)
  })

  test('every permutation of four modules agrees', () => {
    const permutations = (items: readonly string[]): string[][] =>
      items.length <= 1
        ? [[...items]]
        : items.flatMap((item, index) =>
            permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
          )

    const expected = emit(FILES)
    for (const order of permutations(FILES)) {
      expect(emit(order), `transform order ${order.join(', ')}`).toBe(expected)
    }
  })

  test('the sheet follows the inventory order it was given', () => {
    const reversed = [...FILES].reverse()
    const ctx = createContext() as any
    ctx.encoder.reconcileFileOwnerOrder('extract', reversed)
    for (const file of FILES) ctx.encoder.withOwner('parse', file, () => ctx.encoder.processAtomic(STYLES[file]))
    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    const css = ctx.getCss(sheet) as string

    // Reversing the inventory reverses the rules, whatever order the transform ran in — the
    // inventory is what decides, and it is still deciding.
    expect(css.indexOf('#2563eb')).toBeLessThan(css.indexOf('#fff'))
  })

  test('a cold inventory ranked before any contribution still decides', () => {
    // The staging half: a consumer reconciles before committing contributions, so discovery
    // and completion order cannot decide the sheet.
    const ctx = createContext() as any
    ctx.encoder.reconcileFileOwnerOrder('extract', FILES)
    for (const file of [...FILES].reverse()) {
      ctx.encoder.withOwner('parse', file, () => ctx.encoder.processAtomic(STYLES[file]))
    }
    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    const css = ctx.getCss(sheet) as string

    expect(css.indexOf('#fff')).toBeLessThan(css.indexOf('#6b7280'))
    expect(css.indexOf('#6b7280')).toBeLessThan(css.indexOf('#111827'))
  })

  test('a file added to the inventory later lands between its neighbours', () => {
    const ctx = createContext() as any
    ctx.encoder.reconcileFileOwnerOrder('extract', ['src/a.tsx', 'src/c.tsx'])
    ctx.encoder.withOwner('parse', 'src/a.tsx', () => ctx.encoder.processAtomic(STYLES['src/a.tsx']))
    ctx.encoder.withOwner('parse', 'src/c.tsx', () => ctx.encoder.processAtomic(STYLES['src/c.tsx']))
    // `src/b.tsx` appears between them on a rebuild; its rules belong between theirs.
    ctx.encoder.reconcileFileOwnerOrder('extract', ['src/a.tsx', 'src/b.tsx', 'src/c.tsx'])
    ctx.encoder.withOwner('parse', 'src/b.tsx', () => ctx.encoder.processAtomic(STYLES['src/b.tsx']))

    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    const css = ctx.getCss(sheet) as string

    expect(css.indexOf('#fff')).toBeLessThan(css.indexOf('#6b7280'))
    expect(css.indexOf('#6b7280')).toBeLessThan(css.indexOf('#111827'))
  })

  test('both lanes reading one file keep it in one place', () => {
    // A dev server reads a module twice, once per lane. The two readings are separate owners
    // over one path, so the second must land beside the first rather than after every file
    // the first lane ranked — otherwise one file's rules straddle another's.
    const ctx = createContext() as any
    ctx.encoder.reconcileFileOwnerOrder('extract', FILES)
    ctx.encoder.withOwner('extract', 'src/a.tsx', () => ctx.encoder.processAtomic(STYLES['src/a.tsx']))
    ctx.encoder.withOwner('extract', 'src/c.tsx', () => ctx.encoder.processAtomic(STYLES['src/c.tsx']))
    // The transform lane now reaches the file that sits between them.
    ctx.encoder.withOwner('parse', 'src/b.tsx', () => ctx.encoder.processAtomic(STYLES['src/b.tsx']))

    const sheet = ctx.createSheet()
    ctx.appendParserCss(sheet)
    const css = ctx.getCss(sheet) as string

    // b belongs between a and c, where the inventory puts it — not last, where it arrived.
    expect(css.indexOf('#fff')).toBeLessThan(css.indexOf('#6b7280'))
    expect(css.indexOf('#6b7280')).toBeLessThan(css.indexOf('#111827'))
  })
})
