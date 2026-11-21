import { describe, expect, test } from 'vitest'
import { specifierAfterComments } from '../src/module-specifier'

/** Where the first comment in `code` opens, as a scan's pattern hands it over. */
const read = (code: string) => specifierAfterComments(code, code.search(/\/[*/]/))

describe('the specifier after a comment', () => {
  test.each([
    ['a block comment', `from /* the recipe */ './recipes'`],
    ['a line comment', `from // the recipe\n  './recipes'`],
    ['several, with whitespace between', `from /* a */\n// b\n  /* c */ "./recipes"`],
    ['a dynamic import', `import(/* @vite-ignore */ './recipes')`],
    ['a comment before the parenthesis', `import /* lazily */ ('./recipes')`],
  ])('is read past %s', (_label, code) => {
    expect(read(code)).toBe('./recipes')
  })

  // The keyword was a word: what follows the comments is code, not a string.
  test.each([
    ['a sentence that wraps after "from"', `// the schema is derived from\n// the API's own\nexport const schema = 1`],
    ['Array.from( and a comment before its argument', `Array.from(\n  // one row per letter\n  title,\n)`],
    ['a comment that never closes', `from /* the recipe './recipes'`],
    ['a string that does not close on its line', `from /* the recipe */ './recipes\n'`],
  ])('is not found after %s', (_label, code) => {
    expect(read(code)).toBeUndefined()
  })

  // Escapes are the caller's to judge, as they are in a string its own pattern caught.
  test('keeps an escape as written, an escaped quote included', () => {
    expect(read(`from /* c */ './recipe\\u0073'`)).toBe('./recipe\\u0073')
    expect(read(`from /* c */ './it\\'s'`)).toBe("./it\\'s")
  })
})
