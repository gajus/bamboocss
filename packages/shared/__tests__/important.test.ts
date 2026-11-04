import { FALLBACK_SEPARATOR } from '../src/fallback-value'
import { describe, expect, test } from 'vitest'
import { importantMark, isImportant, markImportant, sanitize, withoutImportant, withoutSpace } from '../src/important'

/**
 * These four run per style leaf on every `css()` cache miss and each carries a fast path for
 * the values that dominate real style objects. The cases below are the ones where the guard
 * could be wrong rather than merely slow — a value that needs the work but does not look like
 * it, and a value that needs only half of it.
 */
describe('important and space handling', () => {
  describe('isImportant', () => {
    test.each([
      ['red !important', true],
      ['red!important', true],
      ['red !IMPORTANT', true],
      // A bare trailing `!` is the short form of the mark.
      ['red!', true],
      ['red !important ', true],
      // Not a form the generated types accept, but one CSS reads as a mark, so the browser
      // would treat the declaration as important whether the class said so or not.
      ['red ! important', true],
      ['red !  IMPORTANT ', true],
      ['red !\timportant', true],
      ['red important', false],
      ['red !x important', false],
      // Any whitespace: the build writes each run of it as one space, so the browser reads a mark.
      ['red !\u00a0important', true],
      ['red !\u3000important', true],
      // A comment is not read: telling its `/*` from a string's or a url's is the tokenizer's job,
      // and each reading of them short of it lost marks or made them. Write the mark last.
      ['red !important /* c */', false],
      ['red !/**/important', false],
      ['red /* c */', false],
      ['red /* wow! /* x */', false],
      ['"!/*" */', false],
      // NUL goes as `sanitize` removes it, at either end of what the mark leaves.
      ['\u0000[a!]', true],
      ['fallback(\u0000[a!], b)', true],
      // NUL is removed with the whitespace by `sanitize`, so it is read as whitespace here.
      ['red !\u0000important', true],
      ['red !important\u0000', true],
      // A `!` ending a string, a bracket or an escape is the value's, and ` important` a word after it.
      ['"a!" important', false],
      ['[a!] important', false],
      // An escaped `!` is part of the identifier, `foo!`; an escaped backslash leaves the `!` a mark.
      ['foo\\! important', false],
      ['foo\\!important', false],
      ['red\\!', false],
      ['red\\\\!', true],
      // An escape hatch keeps its contents as written, so the mark sits inside the brackets.
      ['[absolute!]', true],
      ['[red !important]', true],
      ['[a!b]', false],
      ['[[a]!]', true],
      // Brackets that are not the whole value are no escape hatch: line names around a track.
      ['[a] [b!]', false],
      ['[a] 1fr [b!]', false],
      // The whole value, as the stylesheet unwraps one: with a comment after it, no escape hatch.
      ['[a!] /* x */', false],
      ['fallback([a!] /* c */, b)', false],
      // A mark ending a fallback candidate marks the declaration, as one after the call does.
      ['fallback(red !important, blue)', true],
      ['fallback(red, blue)!', true],
      ['fallback("a!", blue)', false],
      // A candidate that is an escape hatch holding the mark, as `[a!]` alone is.
      ['fallback([a!], b)', true],
      // Only a mark that ends the value is one: a `!` anywhere else is part of the value.
      ['a!b', false],
      ['"!"', false],
      ['"hello!"', false],
      ['"Foo!Bar", sans-serif', false],
      ['url("data:image/svg+xml,<svg><!-- x --></svg>")', false],
      ['red', false],
      ['1px solid red', false],
      ['', false],
    ])('%j -> %s', (value, expected) => {
      expect(isImportant(value)).toBe(expected)
    })

    test('a non-string is never important', () => {
      expect(isImportant(4)).toBe(false)
      expect(isImportant(true)).toBe(false)
    })
  })

  describe('importantMark', () => {
    test.each([
      ['red !important', '!important'],
      ['red ! IMPORTANT ', '! IMPORTANT'],
      ['red !important !', '!'],
      ['[absolute!]', '!'],
      ['[red ! important]', '! important'],
      // The candidate that carries it, not a `!` in a later one.
      ['fallback("a" !important, "b!")', '!important'],
      ['fallback([a!], b)', '!'],
      ['[a!] /* x */', undefined],
      ['"!"', undefined],
      ['red', undefined],
    ])('%j -> %j', (value, expected) => {
      expect(importantMark(value)).toBe(expected)
    })
  })

  // The fold names a class from the value sanitized; the stylesheet's decoder reads a config's
  // value as written. Both have to find the same mark, or a class names a rule that is not there.
  test.each([
    'red !\u00a0important',
    'red !\u2028important',
    'red\t!\u3000important',
    'red  !  important',
    'red ! important',
    'red !\u0000important',
    'red !important\u0000',
    '\u0000[a!]',
    'red \u0000!',
    '[a\u0000!]',
    ' red\u0000',
  ])('reads %j as sanitizing it reads it', (value) => {
    expect(isImportant(value)).toBe(isImportant(sanitize(value)))
    expect(withoutImportant(value)).toBe(withoutImportant(sanitize(value)))
  })

  describe('withoutImportant', () => {
    test('strips the marker', () => {
      expect(withoutImportant('red !important')).toBe('red')
      expect(withoutImportant('red!important')).toBe('red')
      expect(withoutImportant('red!')).toBe('red')
    })

    test('strips every mark that ends the value', () => {
      // Leaving one behind would come out as `red !important !important`, which is invalid.
      expect(withoutImportant('red !important !important')).toBe('red')
      expect(withoutImportant('red ! !')).toBe('red')
      expect(withoutImportant('red ! important ! important')).toBe('red')
    })

    test('strips a mark with whitespace inside it', () => {
      expect(withoutImportant('red ! important')).toBe('red')
      expect(withoutImportant('[absolute ! important]')).toBe('[absolute]')
    })

    test('strips a mark inside an escape hatch, keeping its brackets', () => {
      expect(withoutImportant('[absolute!]')).toBe('[absolute]')
      expect(withoutImportant('[red !important]')).toBe('[red]')
      expect(withoutImportant('[absolute!]!')).toBe('[absolute]')
      expect(withoutImportant('fallback([a!], b)')).toBe('fallback([a], b)')
    })

    test('leaves a `!` in brackets that are not the whole value', () => {
      expect(withoutImportant('[a] 1fr [b!]')).toBe('[a] 1fr [b!]')
    })

    test('leaves a comment where it is, and strips a mark written before it', () => {
      expect(withoutImportant('red !important /* c */')).toBe('red !important /* c */')
      expect(withoutImportant('red /* c */ !important')).toBe('red /* c */')
      expect(withoutImportant('[a!] /* x */')).toBe('[a!] /* x */')
    })

    test('strips a long run of marks', () => {
      // Read from the end, so this is one pass rather than a rescan per mark.
      expect(withoutImportant(`red${' !'.repeat(50_000)}`)).toBe('red')
      expect(withoutImportant(`red${' !important'.repeat(50_000)}`)).toBe('red')
    })

    test('strips a mark ending a fallback candidate', () => {
      expect(withoutImportant('fallback(red !important, blue)')).toBe('fallback(red, blue)')
      expect(withoutImportant('fallback(100dvh, 100vh)!')).toBe('fallback(100dvh, 100vh)')
    })

    test('a `!` before a long whitespace run is not a mark', () => {
      // The shape an anchored `\s*!…$` was quadratic on: it retried its leading `\s*` at every
      // position. The mark is now found from the last `!`, so this is one scan.
      const value = `a${' '.repeat(50_000)}!${' '.repeat(50_000)}b`

      expect(isImportant(value)).toBe(false)
      expect(withoutImportant(value)).toBe(value)
    })

    test('leaves a `!` that is part of the value', () => {
      expect(withoutImportant('"!"')).toBe('"!"')
      expect(withoutImportant('"hello!"')).toBe('"hello!"')
      expect(withoutImportant('"Foo!Bar", sans-serif')).toBe('"Foo!Bar", sans-serif')
      // Only the mark is removed, not an earlier `!` in the same value.
      expect(withoutImportant('"hello!" !important')).toBe('"hello!"')
    })

    test('still trims a value that carries no marker', () => {
      // The fast path skips the regex, which is a no-op without a `!` — but not the trim,
      // which is not.
      expect(withoutImportant('  red  ')).toBe('red')
      expect(withoutImportant('\n red \t')).toBe('red')
    })

    test('trims the unicode whitespace `trim` treats as whitespace', () => {
      expect(withoutImportant('\u00a0red\u00a0')).toBe('red')
    })

    test('leaves a clean value alone', () => {
      expect(withoutImportant('red')).toBe('red')
      expect(withoutImportant(4)).toBe(4)
    })
  })

  describe('sanitize', () => {
    test('collapses every run of whitespace to one space', () => {
      expect(sanitize('1px   solid    red')).toBe('1px solid red')
      expect(sanitize('a\n\tb')).toBe('a b')
    })

    test('treats unicode whitespace as whitespace, as the regex does', () => {
      // `\s` matches these, so the guard has to as well or the collapse is skipped.
      expect(sanitize('a\u00a0b')).toBe('a b')
      expect(sanitize('a\u2003\u00a0b')).toBe('a b')
      expect(sanitize('a b')).toBe('a b')

      // The far edge of the set, and the reason the guard is a regex rather than a hand
      // rolled scan: a range check that stops at U+3000 misses the BOM and still passes
      // every case above.
      expect(sanitize('a\ufeffb')).toBe('a b')
      expect(sanitize('a\u3000b')).toBe('a b')
    })

    test('leaves alone the near-whitespace the regex excludes', () => {
      // Neither is matched by `\s`, so collapsing them would rewrite a value the original
      // passed through untouched.
      expect(sanitize('a\u200bb')).toBe('a\u200bb')
      expect(sanitize('a\u00adb')).toBe('a\u00adb')
    })

    test('leaves a value with no whitespace alone', () => {
      expect(sanitize('red')).toBe('red')
      expect(sanitize('')).toBe('')
      expect(sanitize(4)).toBe(4)
    })

    // `content` and `grid-template-areas` show the spaces inside a quoted string, and the sheet
    // keeps them, so the class the compiler names has to keep them too.
    test('keeps the spaces inside a quoted string, collapsing only the runs outside it', () => {
      expect(sanitize('"a  b"')).toBe('"a  b"')
      expect(sanitize("'a  b'   'c'")).toBe("'a  b' 'c'")
      expect(sanitize('"My  Font",   serif')).toBe('"My  Font", serif')
      expect(sanitize('"a  b"')).toBe('"a  b"')
    })

    test('writes a tab or a line break inside a quoted string as a space, as no class can hold one', () => {
      expect(sanitize('"a\tb"')).toBe('"a b"')
      expect(sanitize('"a\r\nb"')).toBe('"a  b"')
    })

    test('reads an escaped quote as part of its string', () => {
      expect(sanitize('"a\\"  b"   x')).toBe('"a\\"  b" x')
      expect(sanitize('\\"  x')).toBe('\\" x')
    })
  })

  describe('withoutSpace', () => {
    test('replaces every space', () => {
      expect(withoutSpace('1px solid red')).toBe('1px_solid_red')
    })

    test('only the literal space, as before', () => {
      // Deliberately not `\s`: a tab reaches this only if `sanitize` did not run, and this
      // has never rewritten one.
      expect(withoutSpace('a\tb')).toBe('a\tb')
      expect(withoutSpace('red')).toBe('red')
      expect(withoutSpace(4)).toBe(4)
    })

    /** It meant a space, so `My Font` and `My_Font` named one class carrying both fonts. */
    test('spells a literal underscore apart from a space', () => {
      expect(withoutSpace('My Font')).toBe('My_Font')
      expect(withoutSpace('My_Font')).toBe('My\\_Font')
      // An escaped space, which would otherwise read as the underscore.
      expect(withoutSpace('My\\ Font')).toBe('My\\\\_Font')
    })

    /** Fractional spacing tokens and icon fonts write these, and their names did not change. */
    test('leaves a CSS escape alone', () => {
      expect(withoutSpace('var(--spacing-0\\.5)')).toBe('var(--spacing-0\\.5)')
      expect(withoutSpace('"\\f101"')).toBe('"\\f101"')
    })

    /** Every pair of these was one class under some earlier spelling. */
    test('gives every value its own spelling', () => {
      const values = ['a b', 'a_b', 'a\\ b', 'a\\_b', 'a\\b', 'a _b', 'a_ b', 'a__b', 'a  b', 'a\\\\b']
      const spelled = values.map(withoutSpace)

      expect(new Set(spelled).size).toBe(values.length)
      for (const name of spelled) expect(name).not.toContain(' ')
    })
  })
  describe('fallback candidates', () => {
    const SEP = FALLBACK_SEPARATOR

    test('markImportant marks every candidate, not just the winning one', () => {
      // Marking only the last would leave the fallbacks losing an important-priority fight
      // in exactly the browsers that have to use them.
      expect(markImportant({ height: `100vh${SEP}100dvh` })).toEqual({
        height: `100vh !important${SEP}100dvh !important`,
      })
    })

    test('markImportant leaves an ordinary value alone', () => {
      expect(markImportant({ height: '100vh' })).toEqual({ height: '100vh !important' })
    })

    test('sanitize strips a separator arriving from author input', () => {
      expect(sanitize(`100px${SEP}200px`)).toBe('100px200px')
    })
  })
})
