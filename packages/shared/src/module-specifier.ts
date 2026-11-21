/**
 * The module specifier a comment stands in front of, where a scan for imports met one.
 *
 * Two scans decide without parsing whether a module can reach bamboo: the Vite compiler's
 * (`importsSourceModule`), which skips a module that cannot, and extraction's
 * (`selectExtractable`), which leaves it unread. Both read a specifier as the string straight
 * after `from`, `import`, `import(` or `require(`, so a comment in that place hid it:
 * `from /* the recipe *\/ './recipes'` read as no import at all, and the recipe call in the
 * module shipped uncompiled, to throw when it was loaded. Each scan's pattern also takes a comment
 * there and hands where it opens to this, so the two read the same specifier past it.
 *
 * Past the comments, the whitespace between them and at most one `(`: the text of the string that
 * follows, escapes and all, for the caller to treat as it treats a string its pattern caught. Or
 * `undefined` when something else follows, as it does where the keyword was a word in a comment,
 * `// taken from` above `// the spec`, or `Array.from(` takes a comment before its argument.
 */
export const specifierAfterComments = (code: string, start: number): string | undefined => {
  let index = start
  let paren = false
  while (index < code.length) {
    const char = code[index]!
    if (char === '/' && code[index + 1] === '*') {
      const end = code.indexOf('*/', index + 2)
      if (end === -1) return undefined
      index = end + 2
    } else if (char === '/' && code[index + 1] === '/') {
      const end = code.indexOf('\n', index + 2)
      if (end === -1) return undefined
      index = end + 1
    } else if (char === '(' && !paren) {
      paren = true
      index++
    } else if (/\s/.test(char)) {
      index++
    } else {
      break
    }
  }

  const quote = code[index]
  if (quote !== "'" && quote !== '"') return undefined
  for (let end = index + 1; end < code.length; end++) {
    const char = code[end]
    // Stepped over, so an escaped quote or a line continuation does not end the string early.
    if (char === '\\') end++
    else if (char === quote) return code.slice(index + 1, end)
    // A string cannot span a line, so this one is not a specifier.
    else if (char === '\n') return undefined
  }
  return undefined
}
