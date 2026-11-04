import { collapseWhitespace } from '@bamboocss/shared'

/**
 * One spelling per value, so one atom per declaration.
 *
 * An atom's identity is derived from the value as it was *written*, while the stylesheet ships
 * the value as it was *optimized*. Those are not the same string, so two spellings of one value
 * mint two atoms that become byte-identical only after minification — by which point the class
 * names are already compiled into the bundle. Measured on one production sheet: 288 of 4,578
 * atoms were redundant this way, `background:#fff` carrying three class names and
 * `box-shadow:-2px 5px 12px #0000001a` five.
 *
 * So the value is folded to a canonical spelling once, before it becomes either a cache key or
 * a transform input. Both halves then agree by construction, and the emitted declaration does
 * not depend on which spelling the build happened to meet first.
 *
 * Deliberately *lexical* only. It rewrites spellings that denote the same token — case, hex
 * length, redundant zeros — and never converts between forms: `rgba(0 0 0 / 10%)` is left alone
 * rather than folded to `#0000001a`, and `150ms` is not folded to `.15s`. Those conversions
 * belong to the optimizer, whose choices differ between the PostCSS and Lightning CSS paths;
 * deriving a class name from them would make the name depend on which optimizer is installed.
 * The cost of that restraint is real — the `150ms`/`.15s` pair stays two atoms — and it buys a
 * canonicalization that cannot be wrong.
 */

/** Values whose interior is not CSS syntax and must survive byte for byte. */
const OPAQUE = /["']|\burl\(/

const HEX = /#([0-9a-fA-F]{3,8})\b/g

/** An integer written with a leading zero, `01`, which the decoder keeps as a string. */
const LEADING_ZERO = /^0\d+$/

/**
 * A number with a decimal point, as its own token.
 *
 * The leading boundary rejects a match inside an identifier — `--red-300`, `grid-1.5x` — where
 * the digits are part of a name rather than a quantity. The trailing side allows a unit, a
 * delimiter, or the end.
 */
const DECIMAL = /(^|[\s,(:/])([+-]?)(\d*)\.(\d+)(?=$|[\s,)/;]|[a-zA-Z%])/g

/** `#aabbcc` → `#abc`, and the alpha form, when every channel is a repeated pair. */
const contractHex = (digits: string) => {
  if (digits.length !== 6 && digits.length !== 8) return digits
  let out = ''
  for (let i = 0; i < digits.length; i += 2) {
    if (digits[i] !== digits[i + 1]) return digits
    out += digits[i]
  }
  return out
}

export const canonicalValue = (value: string): string => {
  // A quoted string or a url() carries bytes that are not CSS syntax — a font family, a path, a
  // `content` string. Nothing here can tell those apart from the value around them, so nothing
  // is rewritten but whitespace, folded as the compiler's `sanitize` folds it: each run one space
  // outside a quoted string, the spaces inside one kept. Left exactly as written, a value with a
  // run outside its quotes, or a tab inside them, was named one way here and another by the
  // compiler, and the element got a class with no rule.
  if (OPAQUE.test(value)) return collapseWhitespace(value).trim()

  let out = value.replace(HEX, (whole, digits: string) => {
    // Only the lengths that are colours. `#12345` is not one, and neither is a fragment
    // identifier that reached here; both are left as they are.
    if (![3, 4, 6, 8].includes(digits.length)) return whole
    return '#' + contractHex(digits.toLowerCase())
  })

  out = out.replace(DECIMAL, (_whole, lead: string, sign: string, int: string, frac: string) => {
    // `.5` → `0.5`, `1.50` → `1.5`, `1.0` → `1`.
    //
    // Toward the explicit leading zero rather than away from it. Either direction merges the
    // pair, but this one is also the spelling a readable class name wants — `p_0.5rem` reads,
    // `p_.5rem` looks like a typo — and it is the form already written almost everywhere, so
    // adopting it rewrites far fewer existing names. The optimizer strips the zero on the way
    // out regardless, so nothing reaches the browser larger for it.
    const trimmed = frac.replace(/0+$/, '')
    const head = int === '' ? '0' : int
    return `${lead}${sign}${trimmed ? `${head}.${trimmed}` : head}`
  })

  // Whitespace runs carry no meaning between CSS tokens, and a value written across two lines
  // in a style object arrives here with the newline in it.
  out = out.replace(/\s+/g, ' ').trim()

  // A number written as a string is the number it reads as. The decoder reads a value back with
  // `Number()` on the way into the sheet, so `'1e3'` was `p_1000` there while the compiler, which
  // names the value as written, put `p_1e3` on the element: a class with no rule behind it.
  // Folded here, under the decoder's own conditions, both name the number.
  if (out !== '' && !LEADING_ZERO.test(out)) {
    const number = Number(out)
    if (!Number.isNaN(number)) return String(number)
  }
  return out
}
