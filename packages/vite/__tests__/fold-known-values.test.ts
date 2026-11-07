import { withoutMergeCodes } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

/**
 * Values the build knows, which it used to fail the compile on as `dynamic`.
 *
 * Two shapes are everywhere in helper code. A default for an option the caller did not pass —
 * `o.display ?? 'block'` — reads a property that is not there, and `undefined` is as decided as
 * any value: falsy and nullish. And a property of a theme object is known whatever the object's
 * other properties are: `theme.radius` beside `shadow: computeShadow()`. Both failed the build
 * with nothing to say why.
 */
const withImport = (body: string) => `import { css } from 'styled-system/css'\n${body}\n`

const foldOf = (code: string, files?: Record<string, string>) => {
  const fixture = createFoldFixture()
  if (files) fixture.addFiles(files)
  const result = fixture.fold(code)
  return {
    classes: result.folded.map((entry) => withoutMergeCodes(entry.className)),
    skipped: result.skipped.map((entry) => entry.reason),
    css: withoutMergeCodes(fixture.getCss()),
  }
}

describe('a default for a value that is not there', () => {
  test.each([
    [
      '`??` on an option not passed',
      `const box = (o = {}) => ({ display: o.display ?? 'block' })\nexport const A = css(box())`,
    ],
    [
      '`||` on an option not passed',
      `const box = (o = {}) => ({ display: o.display || 'block' })\nexport const A = css(box())`,
    ],
    [
      '`??` on an argument not passed',
      `const box = (display) => ({ display: display ?? 'block' })\nexport const A = css(box())`,
    ],
    ['`??` on a property not there', `const opts = {}\nexport const A = css({ display: opts.display ?? 'block' })`],
    ['`??` on `undefined` itself', `export const A = css({ display: undefined ?? 'block' })`],
    [
      '`&&` short-circuiting on `undefined`',
      `const box = (o = {}) => ({ display: (o.hidden && 'none') ?? 'block' })\nexport const A = css(box())`,
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: ['d_block'], skipped: [] })
  })

  test('a choice on an option not passed takes the other arm', () => {
    const body = `const box = (o = {}) => ({ padding: o.dense ? '2' : '4' })\nexport const A = css(box())`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['p_4'], skipped: [] })
  })

  test('an `if` on an option not passed takes the other branch', () => {
    const body =
      `const box = (o = {}) => {\n  if (o.dense) return { padding: '2' }\n  return { padding: '4' }\n}\n` +
      `export const A = css(box())`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['p_4'], skipped: [] })
  })

  test('an option passed still wins', () => {
    const body = `const box = (o = {}) => ({ display: o.display ?? 'block' })\nexport const A = css(box({ display: 'flex' }))`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['d_flex'], skipped: [] })
  })
})

describe('one property of an object, whatever its siblings are', () => {
  test('beside a property the build cannot evaluate', () => {
    const body = `const theme = { px: compute(), w: '10' }\nexport const A = css({ width: theme.w })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('beside a property chosen at runtime, without that property’s rules', () => {
    const body =
      `const cond = Math.random() > 0.5\nconst theme = { px: cond ? '2' : '4', w: '10' }\n` +
      `export const A = css({ width: theme.w })`
    const { classes, skipped, css } = foldOf(withImport(body))

    expect({ classes, skipped }).toEqual({ classes: ['w_10'], skipped: [] })
    expect(css).not.toContain('.px_')
  })

  test('nested', () => {
    const body = `const theme = { sizes: { w: '10', h: compute() } }\nexport const A = css({ width: theme.sizes.w })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('read by a helper', () => {
    const body = `const theme = { px: compute(), w: '10' }\nconst size = () => ({ width: theme.w })\nexport const A = css(size())`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('imported from another module', () => {
    const files = { 'app/src/theme.ts': `export const theme = { px: compute(), sizes: { w: '10', h: compute() } }\n` }
    const code = withImport(`import { theme } from './theme'\nexport const A = css({ width: theme.sizes.w })`)

    expect(foldOf(code, files)).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test.each([
    [
      'destructured',
      `const theme = { px: compute(), w: '10' }\nconst { w } = theme\nexport const A = css({ width: w })`,
    ],
    [
      'destructured, nested and renamed',
      `const theme = { px: compute(), sizes: { w: '10' } }\nconst { sizes: { w: width } } = theme\nexport const A = css({ width })`,
    ],
    [
      'read with a literal key',
      `const theme = { px: compute(), w: '10' }\nexport const A = css({ width: theme['w'] })`,
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('destructured from an import', () => {
    const files = { 'app/src/theme.ts': `export const theme = { px: compute(), w: '10' }\n` }
    const code = withImport(`import { theme } from './theme'\nconst { w } = theme\nexport const A = css({ width: w })`)

    expect(foldOf(code, files)).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  test('after a spread the build cannot evaluate, which it overrides', () => {
    const body = `const theme = { ...other(), w: '10' }\nexport const A = css({ width: theme.w })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['w_10'], skipped: [] })
  })

  // A property the object holds shadows what its prototype has, and `null` sets none to inherit.
  test.each([
    ['beside a prototype the build cannot evaluate', 'const o = { zIndex: 1, __proto__: base() }'],
    ['beside a `null` prototype', 'const o = { zIndex: 1, __proto__: null }'],
    // An enum's members are its members, whichever the build cannot evaluate.
    ['of an enum beside a member the build cannot evaluate', 'enum o { zIndex = 1, B = f() }'],
  ])('%s', (_, definition) => {
    const body = `${definition}\nexport const A = css({ zIndex: o.zIndex })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['z_1'], skipped: [] })
  })
})

/**
 * `+` evaluates the way the source does at runtime. It used to concatenate whatever the operands
 * were, so `base + 1` compiled to `z_101` — a class and a rule that agreed with each other and
 * with nothing the author wrote.
 */
describe('arithmetic', () => {
  test.each([
    ['numbers add', `const base = 10\nexport const A = css({ zIndex: base + 1 })`, 'z_11', 'z-index: 11;'],
    ['inside a template literal', 'export const A = css({ width: `${2 + 3}px` })', 'w_5px', 'width: 5px;'],
    ['in a helper', `const layer = (n) => ({ zIndex: n + 1 })\nexport const A = css(layer(1))`, 'z_2', 'z-index: 2;'],
    [
      'a string operand concatenates',
      `const unit = 'px'\nexport const A = css({ width: 4 + unit })`,
      'w_4px',
      'width: 4px;',
    ],
    [
      'a numeric string concatenates too',
      `const base = '10'\nexport const A = css({ zIndex: base + 1 })`,
      'z_101',
      'z-index: 101;',
    ],
    // Written as `String(number)` writes it, which uses an exponent from 1e21 and below 1e-6.
    ['a sum from 1e21 up', 'export const A = css({ width: `${5e20 + 5e20}px` })', 'w_1e+21px', 'width: 1e+21px;'],
    ['a negative number from 1e21', 'export const A = css({ width: `${-1e21}px` })', 'w_-1e+21px', 'width: -1e+21px;'],
    [
      'an exponent with a fraction',
      'export const A = css({ width: `${1.2345e25}px` })',
      'w_1.2345e+25px',
      'width: 1.2345e+25px;',
    ],
    [
      'a fraction down to 1e-6',
      'export const A = css({ width: `${0.000001}px` })',
      'w_0.000001px',
      'width: 0.000001px;',
    ],
    ['a fraction below 1e-6', 'export const A = css({ width: `${1.5e-7}px` })', 'w_1.5e-7px', 'width: 1.5e-7px;'],
    // Past 2^53 the shortest digits are fewer than the exact ones, and the rest are zeros.
    [
      'an integer past 2^53',
      'export const A = css({ width: `${2 ** 60}px` })',
      'w_1152921504606847000px',
      'width: 1152921504606847000px;',
    ],
    [
      'a sum with no short form',
      'export const A = css({ width: `${0.1 + 0.2}px` })',
      'w_0.30000000000000004px',
      'width: 0.30000000000000004px;',
    ],
    ['negative zero', 'export const A = css({ width: `${-0 + -0}px` })', 'w_0px', 'width: 0px;'],
    [
      '`null` in a template literal',
      'export const A = css({ gridArea: `${null}x` })',
      'grid-area_nullx',
      'grid-area: nullx;',
    ],
    ['`null` plus a number', 'export const A = css({ zIndex: null + 1 })', 'z_1', 'z-index: 1;'],
    // Bitwise operators wrap to 32 bits and take a shift count modulo 32.
    ['a bitwise or past 32 bits', 'export const A = css({ zIndex: (2 ** 32) | 0 })', 'z_0', 'z-index: 0;'],
    ['a negative fraction to 32 bits', 'export const A = css({ zIndex: -1.5 | 0 })', 'z_-1', 'z-index: -1;'],
    [
      'a fraction past 2^31',
      'export const A = css({ zIndex: 2147483648.5 | 0 })',
      'z_-2147483648',
      'z-index: -2147483648;',
    ],
    ['an unsigned shift', 'export const A = css({ zIndex: -1 >>> 0 })', 'z_4294967295', 'z-index: 4294967295;'],
    ['a shift by 32', 'export const A = css({ zIndex: 1 << 32 })', 'z_1', 'z-index: 1;'],
    ['a negative shift count', 'export const A = css({ zIndex: 1 << -1 })', 'z_-2147483648', 'z-index: -2147483648;'],
    // An array index is the canonical form of an integer: `'01'` and `'+1'` are names no array has.
    ['an index written `01`', "const z = [1, 2]\nexport const A = css({ zIndex: z['01'] ?? 5 })", 'z_5', 'z-index: 5;'],
    ['an index written `+1`', "const z = [1, 2]\nexport const A = css({ zIndex: z['+1'] ?? 5 })", 'z_5', 'z-index: 5;'],
  ])('%s', (_, body, className, declaration) => {
    const result = foldOf(withImport(body))

    expect(result).toMatchObject({ classes: [className], skipped: [] })
    expect(result.css).toContain(declaration)
  })
})

/**
 * An element read by index. A hole and an `undefined` element are held as `null`, as a `null` one
 * is, so a read of one is known to be nullish without being known to be either: enough to decide
 * `??`, `||` and a test, where the two agree, and not to convert, where `null` is 0 and `"null"`
 * and `undefined` is `NaN` and `"undefined"` — below.
 */
describe('an array element', () => {
  test.each([
    ['a hole decides `??`', 'const z = [, 2]\nexport const A = css({ zIndex: z[0] ?? 1 })', 'z_1'],
    ['a hole decides `||`', 'const z = [, 2]\nexport const A = css({ zIndex: z[0] || 1 })', 'z_1'],
    ['a hole decides a test', 'const z = [, 2]\nexport const A = css({ zIndex: z[0] ? 1 : 2 })', 'z_2'],
    [
      'a hole in a nested array',
      'const theme = { z: [, 2] }\nexport const A = css({ zIndex: theme.z[0] ?? 3 })',
      'z_3',
    ],
    [
      'a `null` element',
      "const t = ['red.300', null]\nexport const A = css({ color: t[1] ?? 'blue.300' })",
      'c_blue.300',
    ],
    [
      'a `null` element written out',
      'const z = [null, 2]\nexport const A = css({ gridArea: `${z[0]}x` })',
      'grid-area_nullx',
    ],
    ['an element beside a hole', 'const theme = { z: [, 2] }\nexport const A = css({ zIndex: theme.z[1] })', 'z_2'],
    [
      'an element a rest takes beside a hole',
      'const [, ...r] = [1, , 3]\nexport const A = css({ zIndex: r[1] })',
      'z_3',
    ],
    ['holes joined', "const a = [1, , 2]\nexport const A = css({ gridArea: a.join('-') })", 'grid-area_1--2'],
    ['the length of an array with a hole', 'const a = [, 2]\nexport const A = css({ zIndex: a.length })', 'z_2'],
    ['a string by index', "export const A = css({ gridArea: 'abc'[1] })", 'grid-area_b'],
    ['a string past its end', "export const A = css({ gridArea: 'abc'[5] ?? 'z' })", 'grid-area_z'],
    [
      'a hole read in a helper',
      'const z = [, 2]\nconst f = () => z[0] ?? 4\nexport const A = css({ zIndex: f() })',
      'z_4',
    ],
    [
      'a hole through `Object.assign`',
      'const t = Object.assign({}, { s: [, 2] })\nexport const A = css({ zIndex: t.s[0] ?? 7 })',
      'z_7',
    ],
    [
      'an element beside one the build cannot evaluate',
      'const a = [compute(), 2]\nconst f = () => a[1]\nexport const A = css({ zIndex: f() })',
      'z_2',
    ],
    // A spread of unknown length moves what comes after it, not what came before.
    [
      'an element before a spread of unknown length',
      "const a = ['a', ...unknown()]\nconst f = () => a[0]\nexport const A = css({ gridArea: f() })",
      'grid-area_a',
    ],
    [
      'elements around one the build cannot evaluate, spread',
      "const inc = [compute(), 'x']\nconst a = ['a', ...inc]\nconst f = () => a[0] + a[2]\nexport const A = css({ gridArea: f() })",
      'grid-area_ax',
    ],
    [
      'a source of `Object.assign` after an unknown one',
      "const t = Object.assign({}, maybe(), { a: 'x' })\nconst f = () => t.a\nexport const A = css({ gridArea: f() })",
      'grid-area_x',
    ],
    [
      'a string by index before a space',
      "const f = () => 'a b'[0]\nexport const A = css({ gridArea: f() })",
      'grid-area_a',
    ],
    // An array opened by a spread of unknown length still says where its elements before it are.
    [
      'an element before a spread of unknown length, spread again',
      "const f = () => [...['a', ...unknown()]][0]\nexport const A = css({ gridArea: f() })",
      'grid-area_a',
    ],
    [
      'an element a rest takes from before a spread of unknown length',
      "const [x, ...r] = ['a', 'b', ...unknown()]\nconst f = () => r[0]\nexport const A = css({ gridArea: f() })",
      'grid-area_b',
    ],
    // `css()` drops a `null` and an `undefined` alike, so a hole is as exact as either there.
    [
      'a hole as a css() value',
      'const z = [, 2]\nconst f = () => z[0]\nexport const A = css({ zIndex: 1, color: f() })',
      'z_1',
    ],
    ['a hole as the whole css() value', 'const z = [, 2]\nexport const A = css({ zIndex: z[0] })', ''],
  ])('%s', (_, body, className) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [className], skipped: [] })
  })
})

/**
 * A property written as `undefined` replaces what was there, as at runtime: the value leaves the
 * key out, and it used to keep whatever an earlier property, spread or source put there, so
 * `{ ...defaults, size: undefined }` kept the default.
 */
describe('a property written as `undefined`', () => {
  test.each([
    ['by `Object.assign`', "const t = Object.assign({}, { a: 'x' }, { a: undefined })"],
    ['by a spread', "const t = { a: 'x', ...{ a: undefined } }"],
    ['by a later property', "const t = { a: 'x', a: undefined }"],
    ['over a default spread before it', "const defaults = { a: 'x' }\nconst t = { ...defaults, a: undefined }"],
    [
      'through a spread of a spread',
      "const inner = { a: undefined }\nconst mid = { ...inner }\nconst t = { a: 'x', ...mid }",
    ],
  ])('%s', (_, definition) => {
    const body = `${definition}\nconst f = () => t.a ?? 'q'\nexport const A = css({ gridArea: f() })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['grid-area_q'], skipped: [] })
  })

  // A spread whose record says which of its keys it did not know leaves the others known.
  test('a key beside one a spread could not evaluate', () => {
    const body =
      'const o = { x: 1, ...{ a: f(), b: 1 } }\nconst g = () => o.b + o.x\nexport const A = css({ zIndex: g() })'

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['z_2'], skipped: [] })
  })

  // What was not known was under the key the pattern took: the rest is known.
  test('a rest of what was known', () => {
    const body =
      'const { a, ...rest } = { a: f(), b: 1 }\nconst g = () => rest.b\nexport const A = css({ zIndex: g() })'

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['z_1'], skipped: [] })
  })

  // The rest is without the keys the pattern took, and says nothing of them.
  test('not the key a rest pattern took out', () => {
    const body =
      "const { a, ...rest } = { a: undefined, b: 'x' }\nconst t = { a: 'md', ...rest }\n" +
      "const f = () => t.a ?? 'q'\nexport const A = css({ gridArea: f() })"

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['grid-area_md'], skipped: [] })
  })

  // In the order JavaScript keeps the keys: the first written, wherever a later one removed one.
  test('keeping the order of the keys left', () => {
    const body = "export const A = css({ ...{ color: 'red.300', margin: '2', padding: '4' }, color: undefined })"

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['m_2 p_4'], skipped: [] })
  })
})

/**
 * A choice on a value the build only guessed: part of an object a spread it could not evaluate may
 * have written over. It used to decide on the guess and take the arm it chose for exact, so
 * `{ dense: false, ...props }` compiled `options.dense ? '2' : '4'` to `p_4` whatever the caller
 * passed.
 */
describe('a choice on a value only guessed', () => {
  const helper = (options: string, value: string) =>
    `const box = (o) => { const options = ${options}; return ${value} }\nexport const A = (props) => css(box(props))`

  test.each([
    ['a test', helper('{ dense: false, ...o }', "{ padding: options.dense ? '2' : '4' }")],
    ['`||`', helper("{ size: '', ...o }", "{ width: options.size || '10' }")],
    ['`??`', helper('{ size: null, ...o }', "{ width: options.size ?? '10' }")],
    ['`&&`', helper('{ on: true, ...o }', "{ width: options.on && '10' }")],
    ['`!`', helper('{ on: false, ...o }', '{ content: `"${!options.on}"` }')],
    ['`?.`', helper('{ theme: null, ...o }', "{ color: options.theme?.color ?? 'red.300' }")],
    [
      'an `if`',
      "const box = (o) => { const options = { dense: false, ...o }; if (options.dense) return { padding: '2' }; return { padding: '4' } }\nexport const A = (props) => css(box(props))",
    ],
    // An operator on a guess gives a guess.
    ['unary `-`', helper('{ size: 10, ...o }', '{ zIndex: -options.size }')],
    [
      '`typeof`',
      helper("{ size: 'md', ...o }", "{ color: typeof options.size === 'string' ? 'red.300' : 'blue.300' }"),
    ],
    // An object read where a spread may have written over it may not be one at all.
    ['an object read after a spread', helper('{ icon: {}, ...o }', "{ color: options.icon ? 'red.300' : 'blue.300' }")],
    // A hole read off an object rest is held as `null` though it is `undefined`, and is a guess
    // once stored: `-o.v` compiled to `z_0`, and `typeof` said `object`.
    [
      '`-` of a guess stored and read back',
      "const { ...r } = [, 'x']\nconst o = { v: r[0] }\nexport const A = css({ zIndex: -o.v })",
    ],
    [
      '`typeof` of a guess stored and read back',
      "const { ...r } = [, 'x']\nconst o = { v: r[0] }\nexport const A = css({ content: typeof o.v })",
    ],
    // A join over an element it could not decide writes that element as nothing, a guess: `+`
    // of it compiled to `z_3`, where the runtime has 13 or 23.
    [
      '`+` of a join over an element not decided',
      "export const A = (p) => css({ zIndex: +[p.on ? '1' : '2', '3'].join('') })",
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })

  // A value read off an array carries its siblings' choices for their rules, and decides all the same.
  test('a value read off an array decides', () => {
    const body =
      "const pick = (s) => (s[1] ? 2 : 3)\nexport const A = (p) => css({ zIndex: pick([p.compact ? '1' : '2', '4']) })"

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['z_2'], skipped: [] })
  })

  // Written after the spread, the default is what the object holds whatever the caller passed.
  test('a default written after the spread decides', () => {
    expect(
      foldOf(withImport(helper('{ ...o, dense: false }', "{ padding: options.dense ? '2' : '4' }"))),
    ).toMatchObject({
      classes: ['p_4'],
      skipped: [],
    })
  })

  // An object is an object however much of what it holds is known.
  test.each([
    ['truthy', "(t ? 'red.300' : 'blue.300')"],
    ['of `typeof` object', "(typeof t === 'object' ? 'red.300' : 'blue.300')"],
  ])('an object known in part is %s', (_, choice) => {
    const body = `const t = { a: compute() }\nconst f = () => ${choice}\nexport const A = css({ color: f() })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['c_red.300'], skipped: [] })
  })
})

/**
 * Beside a guess, what the build knows still decides. A spread it evaluated that writes nothing,
 * or only keys its source says, left every other key a guess once a choice needed a decided value:
 * `{ dense: false, ...o.overrides }` of an option not passed failed the build where 1.56.7 compiled
 * it. And an object known in part is surely not `null`.
 */
describe('what the build knows beside a guess', () => {
  const helper = (options: string, value: string) =>
    `const box = (o = {}) => { const options = ${options}; return ${value} }\nexport const A = (p) => css(box(p))`

  test.each([
    [
      'a spread of an option not passed',
      "const box = (o = {}) => { const options = { dense: false, ...o.overrides }; return { padding: options.dense ? '2' : '4' } }\nexport const A = css(box())",
      'p_4',
    ],
    [
      'a spread of `null`',
      "const extra = null\nconst box = () => { const options = { dense: false, ...extra }; return { padding: options.dense ? '2' : '4' } }\nexport const A = css(box())",
      'p_4',
    ],
    [
      'a spread of a guard that is false',
      "const box = ({ compact = false } = {}) => { const options = { dense: false, ...(compact && { gap: '1' }) }; return { padding: options.dense ? '2' : '4' } }\nexport const A = css(box())",
      'p_4',
    ],
    [
      'a spread of a guard not decided',
      helper("{ dense: false, ...(o.c && { gap: '1' }) }", "{ padding: options.dense ? '2' : '4' }"),
      'p_4',
    ],
    [
      'a spread of one of two objects',
      helper("{ dense: false, ...(o.compact ? { size: 'sm' } : {}) }", "{ padding: options.dense ? '2' : '4' }"),
      'p_4',
    ],
    [
      'a spread of one of two objects, holding a value not known',
      helper(
        "{ variant: 'solid', ...(o.size ? { size: o.size } : {}) }",
        "{ background: options.variant === 'solid' ? 'blue.500' : 'transparent' }",
      ),
      'bg_blue.500',
    ],
    [
      '`!= null` of an object known in part',
      "const options = { theme: { color: 'red.300', shadow: compute() } }\nconst f = () => (options.theme != null ? options.theme.color : 'blue.300')\nexport const A = css({ color: f() })",
      'c_red.300',
    ],
    [
      '`typeof` and `!== null` of an object known in part',
      "const options = { theme: { color: 'red.300', shadow: compute() } }\nconst f = () => (typeof options.theme === 'object' && options.theme !== null ? options.theme.color : 'blue.300')\nexport const A = css({ color: f() })",
      'c_red.300',
    ],
    // Written after the spread, the method is what the object holds.
    [
      'a method written after a spread',
      "const box = (o) => { const options = { ...o, color: () => 'red.300' }; return { color: options.color() } }\nexport const A = (p) => css(box(p))",
      'c_red.300',
    ],
    // A spread that surely writes no such key leaves the method as it is.
    [
      'a method past a spread of a literal without it',
      "const shared = { size: () => '4' }\nconst helpers = { color: () => 'red.300', ...shared }\nexport const A = css({ color: helpers.color() })",
      'c_red.300',
    ],
    [
      'a method past a key computed from a string',
      "const k = 'size'\nconst helpers = { color: () => 'red.300', [k]: 1 }\nexport const A = css({ color: helpers.color() })",
      'c_red.300',
    ],
    // What the build reads off a spread's value, or a key's: they write no such name.
    [
      'a method past a spread of what a call returns without it',
      "const make = () => ({ size: () => '4' })\nconst helpers = { color: () => 'red.300', ...make() }\nexport const A = css({ color: helpers.color() })",
      'c_red.300',
    ],
    [
      'a method past a spread of a binding declared without a value',
      "let shared\nconst helpers = { color: () => 'red.300', ...shared }\nexport const A = css({ color: helpers.color() })",
      'c_red.300',
    ],
    [
      'a method past keys computed otherwise',
      "const KEYS = { size: 'size' }\nconst helpers = { color: () => 'red.300', [`size`]: 1, [1]: 2, [KEYS.size]: 3, ['si' + 'ze']: 4 }\nexport const A = css({ color: helpers.color() })",
      'c_red.300',
    ],
    // A choice of objects, each without it, or a guard that is false where it gives no object.
    [
      'a method past a spread of one of two objects without it',
      "const dark = { bg: () => '1' }\nconst light = { fg: () => '2' }\nconst f = (p) => { const helpers = { color: () => 'red.300', ...(p.dark ? dark : light) }; return helpers.color() }\nexport const A = (p) => css({ color: f(p) })",
      'c_red.300',
    ],
    [
      'a method past a guarded spread without it',
      "const f = (p) => { const helpers = { color: () => 'red.300', ...(p.dense && { size: () => '2' }) }; return helpers.color() }\nexport const A = (p) => css({ color: f(p) })",
      'c_red.300',
    ],
    // Keys as written: two spaces are two, in a literal or a binding of one.
    [
      'a method of a name holding whitespace, written again under a key bound to it',
      "const k = 'a  b'\nconst helpers = { 'a  b': () => 'red.300', [k]: () => 'blue.300' }\nexport const A = css({ color: helpers['a  b']() })",
      'c_blue.300',
    ],
    [
      'a method past a key bound to a name holding other whitespace',
      "const k = 'a  b'\nconst helpers = { 'a b': () => 'red.300', [k]: () => 'blue.300' }\nexport const A = css({ color: helpers['a b']() })",
      'c_red.300',
    ],
    // The function a name's declarations describe: the last with a body.
    [
      'a function declared twice in a body, the second called',
      "const make = () => { function pick() { return { color: 'red.300' } } function pick() { return { color: 'blue.300' } } return pick() }\nexport const A = css(make())",
      'c_blue.300',
    ],
    [
      "a function's overloads, the implementation called",
      "function tone(t: string): any\nfunction tone(t: any) { return { color: t } }\nexport const A = css(tone('red.300'))",
      'c_red.300',
    ],
    // The last property of the name is the one called, as at runtime: 1.56.7 called the first.
    [
      'a method a later key computed to its name writes',
      "const KEYS = { color: 'color' }\nconst helpers = { color: () => 'red.300', [KEYS.color]: () => 'blue.300' }\nexport const A = css({ color: helpers.color() })",
      'c_blue.300',
    ],
    // Whichever branch, nothing is written: `rtl` is false.
    [
      'a spread of one of two values neither writing a key',
      "const rtl = false\nconst tab = (o) => ({ borderLeft: '1px solid', ...(o.selected ? (rtl ? { borderLeft: 'none' } : null) : null) })\nexport const A = (p) => css(tab(p))",
      'bd-l_1px_solid',
    ],
    // Every key the spread may write is written again: what it wrote is gone whichever it was.
    [
      'a spread of one of two objects, its key written again',
      "const box = (o) => ({ ...(o.c ? { color: 'blue.300' } : null), color: 'red.300' })\nexport const A = (p) => css(box(p))",
      'c_red.300',
    ],
    [
      'a spread of one of two objects, its key spread over',
      "const box = (o) => ({ ...(o.c ? { color: 'blue.300' } : null), ...{ color: 'red.300' } })\nexport const A = (p) => css(box(p))",
      'c_red.300',
    ],
  ])('%s', (_, body, className) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [className], skipped: [] })
  })

  // An import's value says which keys it holds, as a literal's source does.
  test.each([
    ['without it', `export const shared = { size: () => '4' }\n`, ['c_red.300'], []],
    ['holding it', `export const shared = { color: () => 'blue.300' }\n`, [], ['dynamic']],
  ])('a method past a spread of an import %s', (_, shared, classes, skipped) => {
    const body = `import { shared } from '../shared'\nconst helpers = { color: () => 'red.300', ...shared }\nexport const A = css({ color: helpers.color() })`

    expect(foldOf(withImport(body), { 'app/shared.ts': shared })).toMatchObject({ classes, skipped })
  })

  // What a guess may hold decides nothing, wherever it is read.
  test.each([
    // A branch of the spread may write the key itself.
    [
      'a spread of one of two objects writing the key',
      helper('{ dense: false, ...(o.c ? { dense: true } : {}) }', "{ padding: options.dense ? '2' : '4' }"),
    ],
    // `{ color: () => 'red.300', ...props }.color()` called the default whatever `props` held.
    [
      'a method a spread may replace',
      "const box = (o) => { const options = { color: () => 'red.300', ...o }; return { color: options.color() } }\nexport const A = (p) => css(box(p))",
    ],
    // It may not be an array at all.
    [
      '`length` in an array a spread may replace',
      helper('{ list: [], ...o }', "{ padding: 'length' in options.list ? '2' : '4' }"),
    ],
    // A branch's value leaves out a key it writes as `undefined`, and the build does not see a
    // branch it decided away, so what a spread of one of several writes is never known as a whole.
    [
      'a spread of one of two objects, one writing `undefined`',
      "const button = (o) => ({ bg: 'blue.500', ...(o.ghost ? { bg: undefined, borderWidth: '1px' } : null), borderWidth: '0' })\nexport const A = (p) => css(button(p))",
    ],
    // `bg` is written again, and `zIndex` may be written in a branch the build decided away.
    [
      'a spread of one of two values, holding an object decided away',
      "const F = false\nconst box = (o) => ({ zIndex: o.c ? 1 : 2, ...(o.x ? (F ? { zIndex: 3 } : { bg: 'blue.500' }) : null), bg: 'red.500' })\nexport const A = (p) => css(box(p))",
    ],
    [
      'a spread of one of two objects, a key of it not written again',
      "const box = (o) => ({ ...(o.c ? { color: 'blue.300', bg: 'blue.500' } : null), color: 'red.300' })\nexport const A = (p) => css(box(p))",
    ],
    // Read in its own initializer, the object is not there yet, and the walk for the method
    // evaluated the spread or key reading it again, and again, until the stack overflowed.
    [
      'a method past a spread its own initializer calls a method of',
      "const helpers = { color: () => 'red.300', ...helpers.more() }\nexport const A = css({ color: helpers.color() })",
    ],
    [
      'a method past a key its own initializer computes from a method of',
      "const helpers = { color: () => 'red.300', [helpers.key()]: 1 }\nexport const A = css({ color: helpers.color() })",
    ],
    [
      'a method past a spread calling one of an object whose own spread calls it',
      "const a = { color: () => 'red.300', ...b.more() }\nconst b = { more: () => ({}), ...a.color() }\nexport const A = css({ color: a.color() })",
    ],
    [
      'a method past a guarded spread that may write it',
      "const f = (p) => { const helpers = { color: () => 'red.300', ...(p.dark && { color: () => 'blue.300' }) }; return helpers.color() }\nexport const A = (p) => css({ color: f(p) })",
    ],
    // The build collapses each run of whitespace in a value, so a key it computes holding any may
    // be another than it reads.
    [
      'a method past a key computed to a name holding whitespace',
      "const helpers = { 'a b': () => 'red.300', [`a  b`]: () => 'blue.300' }\nexport const A = css({ color: helpers['a b']() })",
    ],
    [
      'a spread of one of two objects, its key computed again holding whitespace',
      "const box = (o) => ({ ...(o.c ? { '& span': { color: 'blue.300' } } : null), ['&  span']: { color: 'red.300' } })\nexport const A = (p) => css(box(p))",
    ],
    // Spread, it is the object declared last with a value: it writes `pick`.
    [
      'a method past a spread of a `var` declared again',
      "var shared = { size: '1' }\nvar shared = { pick: () => ({ color: 'blue.300' }) }\nconst helpers = { pick: () => ({ color: 'red.300' }), ...shared }\nexport const A = css(helpers.pick())",
    ],
    // Onto `null` or `undefined` it throws, whichever the choice gives.
    [
      '`Object.assign` onto one of `null` and `undefined`',
      "const f = (p) => Object.assign(p.x ? null : undefined, { color: 'red.300' })\nexport const A = (p) => css(f(p))",
    ],
    [
      '`Object.assign` onto one of `null` and a number',
      "const f = (p) => Object.assign(p.x ? null : 0, { color: 'red.300' })\nexport const A = (p) => css(f(p))",
    ],
    [
      'an object holding such a spread, spread again',
      "const s = (o) => ({ ...(o.reset ? { color: undefined, padding: '2' } : null), padding: '4' })\nconst box = (o) => ({ color: 'red.300', ...s(o) })\nexport const A = (p) => css(box(p))",
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })

  // Not the path the runtime looks up: the default's token, or none at all.
  test.each([
    [
      'a token path built from a default a spread may write over',
      "const badge = (o) => { const options = { tone: 'red', ...o }; return { color: token(`colors.${options.tone}.300`) } }\nexport const A = (p) => css(badge(p))",
    ],
    [
      'a token path joined from a part not decided',
      "export const A = (p) => css({ color: token(['colors', p.c, '500'].join('.')) })",
    ],
  ])('%s', (_, body) => {
    const { classes, skipped } = foldOf(`import { token } from 'styled-system/tokens'\n${withImport(body)}`)

    expect(classes).toEqual([])
    expect(skipped).toContain('dynamic')
  })
})

/**
 * An element read off an array, with the choices it carries and none of its siblings'. An array
 * held its elements' undecided values beside it with no index, so a read of one carried them all:
 * a decided element emitted its siblings' rules, and failed the build where a value has to be
 * decided — an array literal, a rest parameter — and one beside a key that is an index was not
 * known at all.
 */
describe('an element read off an array', () => {
  test('a decided element carries no rule of its undecided siblings', () => {
    const { classes, css } = foldOf(
      withImport(
        "const tones = ['red.300', Math.random() > 0.5 ? 'blue.300' : 'green.300']\nexport const A = css({ color: tones[0] })",
      ),
    )

    expect(classes).toEqual(['c_red.300'])
    expect(css).not.toContain('--colors-blue-300')
    expect(css).not.toContain('--colors-green-300')
  })

  test.each([
    [
      'given to a rest parameter, wrapped in an object',
      "const m = [Math.random() > 0.5 ? 'blue.300' : 'green.300', 'red.300']\nconst first = (...xs) => xs[0]\nexport const A = css(first({ color: m[1] }))",
      'c_red.300',
    ],
    [
      'placed in an array literal',
      "const m = [Math.random() > 0.5 ? 'blue.300' : 'green.300', 'red.300']\nexport const A = css({ color: [m[1]][0] })",
      'c_red.300',
    ],
    [
      'beside a sibling holding a key that is its index',
      "const c = Math.random() > 0.5\nconst arr2 = [{ k: 1 }, { 0: { z: c ? 1 : 2 } }]\nconst x = [arr2[0]]\nexport const A = css({ zIndex: ('z' in x[0]) + 1 })",
      'z_1',
    ],
  ])('a decided element %s is known', (_, body, className) => {
    expect(foldOf(withImport(body)).classes).toEqual([className])
  })

  // Moved by a spread or taken by a rest element, it still carries its own and none of its
  // siblings'. The compiler, which reads where an element is from the source, leaves a position a
  // spread decides to the evaluation it does not replace.
  test.each([
    [
      'past a spread of another array',
      "const head = [Math.random() > 0.5 ? 'blue.300' : 'green.300']\nconst all = [...head, 'red.300']\nexport const A = css({ color: all[1] })",
    ],
    [
      'taken by a rest element',
      "const [, ...rest] = [Math.random() > 0.5 ? 'blue.300' : 'green.300', 'red.300']\nexport const A = css({ color: rest[0] })",
    ],
  ])('a decided element %s carries no rule of its siblings', (_, body) => {
    const { css } = foldOf(withImport(body))

    expect(css).toContain('--colors-red-300')
    expect(css).not.toContain('--colors-blue-300')
    expect(css).not.toContain('--colors-green-300')
  })

  // Handed on under another name, an array may be reordered where the build cannot see it, so an
  // index says nothing of which element it reads: every element keeps all of the array's choices,
  // and the compiler leaves the read to the runtime.
  test.each([
    [
      'given to a function',
      "const tones = ['red.300', Math.random() > 0.5 ? 'blue.300' : 'green.300']\nflip(tones)\nexport const A = css({ color: tones[0] })",
    ],
    [
      'reversed through an alias of the object property holding it',
      "const theme = { tones: ['red.300', Math.random() > 0.5 ? 'blue.300' : 'green.300'] }\nconst list = theme.tones\nlist.reverse()\nexport const A = css({ color: theme.tones[0] })",
    ],
  ])('an element of an array %s carries every rule of its siblings', (_, body) => {
    const { classes, css } = foldOf(withImport(body))

    expect(classes).toEqual([])
    expect(css).toContain('--colors-red-300')
    expect(css).toContain('--colors-blue-300')
    expect(css).toContain('--colors-green-300')
  })
})

/**
 * A choice spread before a method of the name, decided, is the branch it takes, as evaluated. Read
 * from its branches alone, 1.57.0 failed the call wherever a branch wrote the name, though 1.56.7
 * compiled it, and evaluated the branch not taken: `big ? heavy() : {}` failed for a recursion in
 * `heavy`, where `big` is `false`.
 */
describe('a spread of a choice the build decides', () => {
  test.each([
    [
      'a variant compared',
      "const button = (variant) => { const tone = { color: () => 'red.300', ...(variant === 'ghost' ? { color: () => 'gray.300' } : {}) }; return tone.color() }\nexport const A = css({ color: button('solid') })",
      'c_red.300',
    ],
    [
      'a default the call leaves',
      "const styles = (variant = 'solid') => { const tone = { bg: () => 'blue.500', ...(variant === 'outline' ? { bg: () => 'transparent' } : {}) }; return { bg: tone.bg() } }\nexport const A = css(styles())",
      'bg_blue.500',
    ],
    [
      '`&&` on `false`',
      "const f = (dense) => { const helpers = { color: () => 'red.300', ...(dense && { color: () => 'blue.300' }) }; return helpers.color() }\nexport const A = css({ color: f(false) })",
      'c_red.300',
    ],
    [
      '`??` on an object',
      "const theme = { bg: 'x' }\nconst helpers = { color: () => 'red.300', ...(theme ?? { color: () => 'blue.300' }) }\nexport const A = css({ color: helpers.color() })",
      'c_red.300',
    ],
    [
      'bound to a name',
      "const dark = false\nconst extra = dark ? { color: () => 'blue.300' } : {}\nconst helpers = { color: () => 'red.300', ...extra }\nexport const A = css({ color: helpers.color() })",
      'c_red.300',
    ],
    [
      'whose branch not taken would be refused',
      "const fib = (n) => n < 2 ? 1 : fib(n - 1) + fib(n - 2)\nconst heavy = () => ({ size: fib(40) })\nconst f = (big) => { const helpers = { color: () => 'red.300', ...(big ? heavy() : {}) }; return helpers.color() }\nexport const A = css({ color: f(false) })",
      'c_red.300',
    ],
  ])('%s is the branch it takes', (_, body, className) => {
    expect(foldOf(withImport(body)).classes).toEqual([className])
  })
})

// A recipe takes a `null` variant for an explicit miss and `undefined` for its default, so a hole
// is never compiled as the one or the other: the selection is made where it runs.
test('a hole selecting a recipe variant selects at runtime', () => {
  const result = createFoldFixture().fold(
    `import { buttonStyle } from 'styled-system/recipes'\nconst sizes = ['sm', , 'lg']\nexport const A = buttonStyle({ size: sizes[1] })\n`,
  )

  expect(result.skipped).toEqual([])
  expect(result.code).toContain('cvaMap([sizes[1]]')
})

/**
 * `in`, exact where the key is surely there or surely not, and nowhere else. Plus one makes the
 * answer a value, which compiles only if the answer is exact: a choice in a helper decides on any
 * answer at all, exact or not.
 */
describe('which keys an object has', () => {
  const value = (test: string, definition: string) =>
    withImport(`const c = Math.random() > 0.5\n${definition}\nexport const A = css({ zIndex: (${test}) + 1 })`)

  test.each([
    ['a key written with one of two values', "'a' in o", "const o = { a: c ? 'x' : 'y' }", 'z_2'],
    ['such a key after a spread the build cannot read', "'a' in o", 'const o = { ...x(), a: c ? 1 : 2 }', 'z_2'],
    ['such a key in a nested object', "'x' in o.a", 'const o = { a: { x: c ? 1 : 2 } }', 'z_2'],
    ['a key held before a spread the build cannot read', "'a' in o", 'const o = { a: 1, ...x() }', 'z_2'],
    [
      'a key held before a spread of one of two objects',
      "'a' in o",
      'const o = { a: 1, ...(c ? { b: 2 } : {}) }',
      'z_2',
    ],
    ['a key not held, with a `null` prototype', "'dark' in o", 'const o = { __proto__: null, zIndex: 1 }', 'z_1'],
    ['a key not held, with a number for a prototype', "'dark' in o", 'const o = { __proto__: 5, zIndex: 1 }', 'z_1'],
    // A spread writes over what the object holds and removes none of it, a guess's included.
    [
      'a key held before a spread of a value that may be another',
      "'y' in { y: 0, ...o.a }",
      'const o = { a: { y: 1 }, ...x() }',
      'z_2',
    ],
    [
      'such a key, through `Object.assign`',
      "'y' in Object.assign({ y: 0 }, o.a)",
      'const o = { a: { y: 1 }, ...x() }',
      'z_2',
    ],
    // However much is known of what it holds, and whatever a spread the build could not read wrote
    // over it.
    [
      'a key held before a spread the build cannot read, and a guess after it',
      "'y' in { y: 0, ...x(), ...o.a }",
      'const o = { a: { y: 1 }, ...x() }',
      'z_2',
    ],
    [
      'such a key, through `Object.assign`, and a guess after it',
      "'y' in Object.assign({ y: 0 }, x(), o.a)",
      'const o = { a: { y: 1 }, ...x() }',
      'z_2',
    ],
    [
      'a key held with a value known in part, and a guess after it',
      "'y' in { y: { ...x() }, ...o.a }",
      'const o = { a: { y: 1 }, ...x() }',
      'z_2',
    ],
    ['a member of an enum not wholly known', "'A' in { ...E }", 'enum E { A = 1, B = f() }', 'z_2'],
  ])('%s', (_, test, definition, className) => {
    expect(foldOf(value(test, definition))).toMatchObject({ classes: [className], skipped: [] })
  })

  test.each([
    ['a key a branch of a spread may hold', "'a' in o", 'const o = { ...(c ? { a: 1 } : {}) }'],
    ['a key the prototype may hold', "'dark' in o", 'const o = { zIndex: 1, __proto__: base() }'],
    // `track()` may have written to `s`, and the build could not follow it.
    ['a key in a spread of a value code ran before', "'z' in { ...(track(), s) }", 'const s = { a: 1, b: f() }'],
    ['a key `Object.assign` takes from one', "'z' in Object.assign({}, (track(), s))", 'const s = { a: 1, b: f() }'],
    ['a key inside one', "'k' in { ...(track(), s).a }", 'const s = { a: { k: 1 }, b: f() }'],
    // Read where a spread may have written over it, `o.a` may be another object, or none.
    ['a key of a value a spread may have replaced', "'y' in { ...o.a }", 'const o = { a: { y: 1 }, ...x() }'],
    ['a key of one, through `Object.assign`', "'y' in Object.assign({}, o.a)", 'const o = { a: { y: 1 }, ...x() }'],
    [
      'a key of a value a branch may have replaced',
      "'x' in o.a",
      'const o = { a: { y: 1 }, ...(c ? { a: { x: 1 } } : {}) }',
    ],
    // It throws there.
    ['a key of `Object.assign` onto `null`', "'a' in Object.assign(null, { a: 1 })", ''],
    // A numeric member names its value too, which the build does not hold.
    ['a key an enum gives a numeric member', "'1' in E", 'enum E { A = 1, B = f() }'],
    // What a guess wrote, a later spread does not make surely there, nor what a branch wrote.
    ['a key two guesses may hold', "'y' in { ...o.a, ...o.b }", 'const o = { a: { y: 1 }, b: { y: 2 }, ...x() }'],
    ['a key a guess wrote, spread again', "'y' in { ...o.a, ...o.a }", 'const o = { a: { y: 1 }, ...x() }'],
    [
      'a key `Object.assign` takes from two guesses',
      "'y' in Object.assign({}, o.a, o.b)",
      'const o = { a: { y: 1 }, b: { y: 2 }, ...x() }',
    ],
    [
      'a key a branch wrote before a guess',
      "'y' in { ...(c ? { y: 1 } : {}), ...o.a }",
      'const o = { a: { y: 1 }, ...x() }',
    ],
  ])('not %s', (_, test, definition) => {
    expect(foldOf(value(test, definition))).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })

  // A helper's choice decides on any answer; `o.a` may be what a branch wrote, which may hold `x`
  // or not, so there is none to decide on.
  test('not a choice on a key of a value a branch may have replaced', () => {
    const body =
      `const c = Math.random() > 0.5\nconst o = { a: { y: 1 }, ...(c ? { a: { x: 1 } } : {}) }\n` +
      `const g = () => ('x' in o.a ? 1 : 2)\nexport const A = css({ zIndex: g() })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })
})

describe('what a call is given', () => {
  // An array whose record says where each element is passes them all, and nothing after them.
  test('past a spread of an array of known length, a parameter is given nothing', () => {
    const body = `const f = (a, b, c = 'red.300') => c\nexport const A = css({ color: f(...[1, g()]) })`

    expect(foldOf(withImport(body))).toMatchObject({ classes: ['c_red.300'], skipped: [] })
  })

  test('an enum exported from another module is read as one in the module itself', () => {
    const files = { 'app/src/tone.ts': 'export enum Tone { zIndex = 1 }\n' }
    const code = withImport(`import { Tone } from './tone'\nexport const A = css({ zIndex: Tone.zIndex })`)

    expect(foldOf(code, files)).toMatchObject({ classes: ['z_1'], skipped: [] })
  })

  // An element the call could not decide between is not known, and the others still are.
  test.each([
    [
      'an element of a rest parameter beside one holding one of two values',
      "const first = (...xs) => xs[0]\nexport const A = (p) => css(first({ color: 'red.300' }, { color: p.on ? 'green.300' : 'blue.300' }))",
      'c_red.300',
    ],
    [
      'how many elements a rest parameter holds, one holding one of two values',
      "const count = (...xs) => xs.length\nexport const A = (p) => css({ zIndex: count({ color: 'red.300' }, { color: p.on ? 'green.300' : 'blue.300' }) })",
      'z_2',
    ],
  ])('%s', (_, body, className) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [className], skipped: [] })
  })

  // An element holding values the build could not decide between is what its record says of it,
  // its undecided keys not known.
  test.each([
    [
      'a choice on a key surely in an undecided rest element',
      "const variant = (...args) => { if ('size' in args[0]) return { padding: '2' }; return { padding: '4' } }\nexport const A = (p) => css(variant({ size: p.big ? 'lg' : 'sm' }))",
      'p_2',
    ],
    [
      'a style chosen on such a key',
      "const has = (...styles) => ('color' in styles[0] ? { color: 'green.300' } : {})\nexport const A = (p) => css(has({ color: p.on ? 'red.300' : 'blue.300' }))",
      'c_green.300',
    ],
    [
      'a decided key of an undecided rest element',
      "const py = (...xs) => xs[0].py\nexport const A = (p) => css({ paddingY: py({ px: p.on ? '2' : '4', py: '1' }) })",
      'py_1',
    ],
    [
      'a decided key of an undecided array element',
      "const c = Math.random() > 0.5\nconst sizes = [{ px: c ? '2' : '4', py: '1' }]\nconst f = () => sizes[0].py\nexport const A = css({ paddingY: f() })",
      'py_1',
    ],
    [
      'a key surely in an undecided array element',
      "const c = Math.random() > 0.5\nconst a = [{ px: c ? '2' : '4' }]\nexport const A = css({ zIndex: ('px' in a[0]) + 1 })",
      'z_2',
    ],
    [
      'an index of an array holding an undecided element',
      "const c = Math.random() > 0.5\nconst a = [{ px: c ? '2' : '4' }]\nexport const A = css({ zIndex: (0 in a) + 1 })",
      'z_2',
    ],
    [
      'the length of an array inside one',
      "const c = Math.random() > 0.5\nconst a = [[{ px: c ? '2' : '4' }]]\nconst f = () => a[0].length\nexport const A = css({ zIndex: f() })",
      'z_1',
    ],
    [
      'a key it does not hold, standing in for a default',
      "const c = Math.random() > 0.5\nconst sizes = [{ px: c ? '2' : '4' }]\nconst f = (x = 'green.300') => x\nexport const A = css({ color: f(sizes[0].missing) })",
      'c_green.300',
    ],
  ])('%s', (_, body, className) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [className], skipped: [] })
  })

  // Read off an array, a value is what it is, whatever its siblings could be; and `==` converts.
  test.each([
    [
      'the length of an array holding an undecided element',
      "export const A = (p) => { const cols = [p.wide ? '1fr' : 'auto', '1fr']; return css({ zIndex: cols.length + 1 }) }",
      'z_3',
    ],
    [
      'a decided element beside an undecided one, converted',
      "export const A = (p) => { const sizes = [p.dense ? '1' : '2', '4']; return css({ padding: sizes[1] + 'px' }) }",
      'p_4px',
    ],
    [
      '`==` of a string and a number',
      "const gap = (n) => (n == 0 ? '0' : '4')\nexport const A = css({ padding: gap('0') })",
      'p_0',
    ],
    [
      '`==` of a number and a string padded with whitespace',
      "const f = (s) => (s == 1 ? 2 : 3)\nexport const A = css({ zIndex: f(' 1 ') })",
      'z_2',
    ],
    // A number is compared as a number, however it is held: a length or a bitwise result never
    // equalled a literal.
    [
      '`===` of a length and a number',
      "const f = (n) => (n === 2 ? 'red.300' : 'blue.300')\nexport const A = css({ color: f([1, 2].length) })",
      'c_red.300',
    ],
    [
      '`===` of a bitwise result and a number',
      "const f = (n) => (n === 1 ? 'red.300' : 'blue.300')\nexport const A = css({ color: f(1 | 0) })",
      'c_red.300',
    ],
    // Different once each run of whitespace is one space, two strings differ however it was written.
    [
      '`===` of a value holding a space and a keyword',
      "const border = (value = '1px solid') => ({ border: value === 'none' ? '0' : value })\nexport const A = css(border())",
      'bd_1px_solid',
    ],
    [
      '`!==` of a value holding a space and a keyword',
      "const t = (v = 'all 0.2s') => ({ transition: v !== 'none' ? v : 'none' })\nexport const A = css(t())",
      'trs_all_0.2s',
    ],
    // The elements before a spread are where they are written.
    ['`in` of an index before a spread', 'export const A = (p) => css({ zIndex: (0 in [p.x, ...p.ys]) + 1 })', 'z_2'],
    [
      '`in` of a later index before a spread',
      "export const A = (p) => css({ zIndex: (1 in ['a', p.x, ...p.ys]) + 1 })",
      'z_2',
    ],
    // A value read off an array carries its siblings' choices, and is one value wherever it is put.
    [
      'decided elements given to a rest parameter, joined',
      "const pad = (...xs) => xs.join(' ')\nexport const A = (p) => { const space = [p.compact ? '1' : '2', '4', '8']; return css({ padding: pad(space[1], space[2]) }) }",
      'p_4_8',
    ],
    [
      'a decided element read off a rest parameter',
      "const second = (...xs) => xs[1] + 'px'\nexport const A = (p) => { const space = [p.compact ? '1' : '2', '4', '8']; return css({ padding: second(space[1], space[2]) }) }",
      'p_8px',
    ],
    [
      'decided elements put in an array, joined',
      "const both = (a, b) => [a, b].join(' ')\nexport const A = (p) => { const space = [p.compact ? '1' : '2', '4', '8']; return css({ padding: both(space[1], space[2]) }) }",
      'p_4_8',
    ],
    // An object read off an array carries a sibling's choice of a value that is no object as it is.
    [
      'an object read off an array beside a choice of an object or `null`, given to a rest parameter',
      "const first = (...xs) => xs[0]\nexport const A = (p) => { const m = [p.x ? { color: 'blue.300' } : null, { color: 'red.300' }]; return css(first(m[1])) }",
      'c_red.300',
    ],
    // Past the end, an element is `undefined` whatever its siblings could be.
    [
      'an element past the end of an array holding a choice, joined',
      "const pad = (...ys) => ys.join('-')\nexport const A = (p) => { const xs = [p.x ? '1' : '2', '4']; return css({ padding: pad(xs[2], xs[1]) }) }",
      'p_-4',
    ],
    [
      'a default for an element past the end of an array holding a choice',
      "const f = (xs) => { const [size, variant = 'red.300'] = xs; return { color: variant } }\nexport const A = (p) => css(f([p.c ? 'sm' : 'md']))",
      'c_red.300',
    ],
    [
      'an element past the end of an array holding a choice, read with `??`',
      "const f = (xs) => xs[2] ?? '7'\nexport const A = (p) => css({ padding: f([p.x ? '1' : '2', '4']) })",
      'p_7',
    ],
    [
      '`undefined` given to a rest parameter, joined',
      "const pad = (...ys) => ys.join('-')\nexport const A = css({ padding: pad(undefined, '4') })",
      'p_-4',
    ],
    [
      'decided elements spread into a call',
      "const pad = (a, b) => a + ' ' + b\nexport const A = (p) => { const space = [p.compact ? '1' : '2', '4', '8']; return css({ padding: pad(...[space[1], space[2]]) }) }",
      'p_4_8',
    ],
    [
      'a key of a numeric enum it does not hold',
      "enum E { A = 1 }\nexport const A = css({ zIndex: ('B' in E) + 1 })",
      'z_1',
    ],
    [
      'a key of the reverse mapping',
      'enum Tone { zIndex = 1 }\nconst g = () => (1 in Tone) + 1\nexport const A = css({ zIndex: g() })',
      'z_2',
    ],
    // `null` that may be `undefined` is held as `null`, and is an argument like any other.
    [
      'a nullish read passed to a helper',
      "const { ...r } = [, 1]\nconst f = (a, b) => b\nexport const A = css({ color: f(r[0], 'red.300') })",
      'c_red.300',
    ],
  ])('%s', (_, body, className) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [className], skipped: [] })
  })

  // A namespace holding values adds the names it exports, and the enum's own members are known.
  test.each([
    [
      'a function',
      'enum Tone { zIndex = 1 }\nnamespace Tone { export function parse(value: string) { return value } }',
    ],
    ['a value', "enum Tone { zIndex = 1 }\nnamespace Tone { export const margin = '2' }"],
    ['declared before it', 'namespace Tone { export type X = string }\nenum Tone { zIndex = 1 }'],
  ])('an enum merged with a namespace holding %s', (_, tone) => {
    const code = withImport(`${tone}\nexport const A = css({ zIndex: Tone.zIndex })`)

    expect(foldOf(code)).toMatchObject({ classes: ['z_1'], skipped: [] })
  })

  // A namespace of types alone adds no member, and a `declare`d one says only of members the
  // program has from elsewhere: the enum's own are what they are.
  test.each([
    ['merged with a namespace of types', 'enum Tone { zIndex = 1 }\nnamespace Tone { export type X = string }'],
    ['merged with a `declare`d namespace', 'enum Tone { zIndex = 1 }\ndeclare namespace Tone { const margin: string }'],
    ['merged with a `declare`d enum', 'enum Tone { zIndex = 1 }\ndeclare enum Tone { lifted = 2 }'],
  ])('an enum %s', (_, tone) => {
    const code = withImport(`${tone}\nexport const A = css({ zIndex: Tone.zIndex })`)

    expect(foldOf(code)).toMatchObject({ classes: ['z_1'], skipped: [] })
  })

  test('an enum another module exports merged with a namespace of types', () => {
    const files = {
      'app/src/tone.ts':
        'export enum Tone { zIndex = 1 }\nexport namespace Tone { export type Key = keyof typeof Tone }\n',
    }
    const code = withImport(`import { Tone } from './tone'\nexport const A = css({ zIndex: Tone.zIndex })`)

    expect(foldOf(code, files)).toMatchObject({ classes: ['z_1'], skipped: [] })
  })

  // `compactStyles` leaves out what holds no style, and gives back one style object left alone.
  test.each([
    ['`undefined`', 'undefined'],
    ['`null`', 'null'],
    ['`false`', 'false'],
    ['an empty object', '{}'],
    ['an object holding only `undefined`', '{ color: undefined }'],
  ])('`css.raw` of one style object beside %s, in a module the compiler does not transform', (_, beside) => {
    const files = {
      'app/src/button.ts': `import { css } from 'styled-system/css'\nexport const button = css.raw({ color: 'red.300' }, ${beside})\n`,
    }
    const code = withImport(`import { button } from './button'\nexport const A = css(button)`)

    expect(foldOf(code, files)).toMatchObject({ classes: ['c_red.300'], skipped: [] })
  })
})

describe('what is still not known', () => {
  test.each([
    [
      'the property the build cannot evaluate',
      `const theme = { px: compute(), w: '10' }\nexport const A = css({ padding: theme.px })`,
    ],
    [
      'a property chosen at runtime',
      `const cond = Math.random() > 0.5\nconst theme = { px: cond ? '2' : '4' }\nexport const A = css({ padding: theme.px })`,
    ],
    [
      'a property a later spread may replace',
      `const theme = { w: '10', ...other() }\nexport const A = css({ width: theme.w })`,
    ],
    [
      'a property a later computed key may replace',
      `const theme = { w: '10', [key()]: '12' }\nexport const A = css({ width: theme.w })`,
    ],
    [
      'a property a spread may define',
      `const theme = { ...other() }\nexport const A = css({ width: theme.w ?? '10' })`,
    ],
    [
      'a property read through an accessor',
      `const theme = { get w() { return '10' } }\nexport const A = css({ width: theme.w })`,
    ],
    [
      'a property written later',
      `const theme = { w: '10', px: compute() }\ntheme.w = '12'\nexport const A = css({ width: theme.w })`,
    ],
    ['an option a caller passes at runtime', `export const f = (o) => css({ display: o.display ?? 'block' })`],
    [
      'a destructured property with a default standing in for it',
      `const theme = { px: compute() }\nconst { w = '10' } = theme\nexport const A = css({ width: w })`,
    ],
    // A hole reads as `undefined`, and `undefined + 1` is `NaN` — not a value to compile.
    ['`+` on an array hole', `const z = [, 2]\nexport const A = css({ zIndex: z[0] + 1 })`],
    ['`-` on an array hole', `const z = [, 2]\nexport const A = css({ zIndex: z[0] - 1 })`],
    ['`-` on an `undefined` element', `const z = [undefined, 2]\nexport const A = css({ zIndex: z[0] - 1 })`],
    ['an array hole in a template literal', 'const z = [, 2]\nexport const A = css({ gridArea: `${z[0]}x` })'],
    [
      'a hole in a nested array converted',
      'const theme = { z: [, 2] }\nexport const A = css({ zIndex: theme.z[0] - 1 })',
    ],
    ['a hole spread into an array', 'const z = [...[, 2]]\nexport const A = css({ zIndex: z[0] - 1 })'],
    ['a hole a rest element takes', 'const [, ...r] = [1, , 3]\nexport const A = css({ zIndex: r[0] - 1 })'],
    // A default stands in for `undefined`, and a hole read as `null` does not say it is one.
    ['a destructuring default on a hole', 'const [a = 1] = [, 2]\nexport const A = css({ zIndex: a ?? 3 })'],
    [
      'an element after a spread the build cannot evaluate',
      'const a = [...compute(), 2]\nexport const A = css({ zIndex: a[1] ?? 5 })',
    ],
    ['an element written later', 'const a = [1, 2]\na[0] = 5\nexport const A = css({ zIndex: a[0] ?? 1 })'],
    // An element the build cannot evaluate is held as `null` in its place, and decides nothing.
    [
      'an unknown element in a helper',
      "const z = [compute()]\nconst f = () => z[0] ?? 'red.300'\nexport const A = css({ color: f() })",
    ],
    [
      'an unknown element deciding a test',
      "const z = [compute()]\nexport const A = css({ content: 'a' + (z[0] ? 'b' : 'c') })",
    ],
    [
      'an element after a spread of unknown length',
      "const w = [...unknown(), 1]\nconst z = [...w, 'x']\nconst f = () => z[1]\nexport const A = css({ gridArea: f() })",
    ],
    // A hole wherever it is kept converts as neither `null` nor `undefined`.
    [
      'a hole passed for a parameter with a default',
      'const z = [, 2]\nconst f = (a = 1) => a ?? 2\nexport const A = css({ zIndex: f(z[0]) })',
    ],
    [
      'a hole through a rest parameter',
      'const f = (...a) => a[0] - 1\nconst z = [, 2]\nexport const A = css({ zIndex: f(z[0]) })',
    ],
    [
      'a hole kept in an object',
      'const z = [, 2]\nconst o = { a: z[0] }\nconst f = () => o.a - 1\nexport const A = css({ zIndex: f() })',
    ],
    [
      'a hole kept in an array',
      'const z = [, 2]\nconst y = [z[0]]\nconst f = () => y[0] - 1\nexport const A = css({ zIndex: f() })',
    ],
    [
      'a hole through `Object.assign` converted',
      'const t = Object.assign({}, { s: [, 2] })\nconst f = () => t.s[0] + 1\nexport const A = css({ zIndex: f() })',
    ],
    ['a hole as a computed key', "const f = () => ({ [[, 1][0]]: 'red.300' })\nexport const A = css(f())"],
    [
      'a hole as the separator of `join`',
      'const z = [, 2]\nconst f = () => [1, 2].join(z[0])\nexport const A = css({ gridArea: f() })',
    ],
    ['a property of a hole', 'const z = [, 2]\nconst f = () => z[0].x\nexport const A = css({ zIndex: f() })'],
    // A literal's whitespace is collapsed as it is read, so past a space an index is not known.
    ['a string index past a space', "const f = () => 'a  b'[2]\nexport const A = css({ gridArea: f() })"],
    ['the length of a string holding a space', "const f = () => 'a  b'.length\nexport const A = css({ zIndex: f() })"],
    // An array whose length is not known, kept in an object: nothing after it is where it is held.
    [
      'an element after an array of unknown length, through Object.assign',
      "const g = Object.assign({}, { l: ['a', ...unknown()] })\nconst a = [...g.l, 'z']\nconst f = () => a[1]\nexport const A = css({ gridArea: f() })",
    ],
    [
      'an element after an array of unknown length, from an object a spread opened',
      "const g = { l: ['a', ...unknown()], ...maybe() }\nconst a = [...g.l, 'z']\nconst f = () => a[1]\nexport const A = css({ gridArea: f() })",
    ],
    [
      'an element past what an open array said',
      "const f = () => [...['a', ...unknown()]][1] ?? 'q'\nexport const A = css({ gridArea: f() })",
    ],
    // A style object is walked with `for…in`, which reads what it inherits from its prototype.
    [
      'an object with a prototype',
      "const base = { color: 'red.300' }\nexport const A = css({ __proto__: base, bg: 'blue.300' })",
    ],
    // `css()` drops an argument whose values are all `undefined`, and keeps one holding `null`,
    // which overrides what came before: with more arguments than one, a hole is either.
    [
      'a hole among the arguments of css()',
      "const z = [, 2]\nexport const A = css({ color: 'red.300' }, { color: z[0] })",
    ],
    // `Object.assign` keeps a source's undecided values, as a spread does.
    [
      'a property `Object.assign` takes as one of two values',
      "const t = Object.assign({}, { a: c ? 'x' : 'y' })\nconst f = () => t.a ?? 'q'\nexport const A = css({ gridArea: f() })",
    ],
    [
      'an element after a spread of unknown length',
      "const a = ['a', ...unknown(), 'b']\nconst f = () => a[2]\nexport const A = css({ gridArea: f() })",
    ],
    [
      'an element the build cannot evaluate, spread',
      "const inc = [compute(), 'x']\nconst a = ['a', ...inc]\nconst f = () => a[1] ?? 'q'\nexport const A = css({ gridArea: f() })",
    ],
    [
      'a property `Object.assign` takes before an unknown source',
      "const t = Object.assign({}, { a: 'x' }, maybe())\nconst f = () => t.a\nexport const A = css({ gridArea: f() })",
    ],
    // What an object said of a property before a spread that may have written over it is gone.
    [
      'a hole a later spread may have replaced',
      'const o = { a: [, 2][0], ...unknown() }\nconst p = { b: o.a }\nconst f = () => p.b - 1\nexport const A = css({ zIndex: f() })',
    ],
    // A missing property is `undefined` unless the prototype has it.
    ['a property every object has', 'const o = {}\nexport const A = css({ zIndex: o.toString ? 1 : 2 })'],
    ['an array method', 'const s = [1, 2]\nexport const A = css({ zIndex: s.includes ? 1 : 2 })'],
    // The audit does not walk an operator's operands; the evaluator refuses these itself.
    ['`+` on a binding written later', `let base = 10\nbase = 20\nexport const A = css({ zIndex: base + 1 })`],
    ['`*` on a binding written later', `let base = 10\nbase = 20\nexport const A = css({ zIndex: base * 2 })`],
    [
      'a binding written later in a template literal',
      'let base = 10\nbase = 20\nexport const A = css({ width: `${base}px` })',
    ],
    [
      'a binding written later passed to a helper',
      `let base = 10\nbase = 20\nconst f = (n) => n\nexport const A = css({ zIndex: f(base) })`,
    ],
    [
      '`+` on a property written later',
      `const theme = { size: 10 }\ntheme.size = 20\nexport const A = css({ zIndex: theme.size + 1 })`,
    ],
    [
      '`-` on a property written later',
      `const theme = { size: 10 }\ntheme.size = 20\nexport const A = css({ zIndex: -theme.size })`,
    ],
    ['`-` on a parameter default', `export const C = (size = 10) => css({ zIndex: -size })`],
    ['`+` on a parameter default', `export const C = (size = 10) => css({ zIndex: size + 1 })`],
    // What runs before a comma may have written to the value after it, and the build could not
    // follow it.
    [
      'a property of a value code ran before',
      'const s = { zIndex: 1, b: f() }\nconst g = () => (track(), s).zIndex\nexport const A = css({ zIndex: g() })',
    ],
    // A rest parameter holding a value the call could not decide between holds it under no index.
    [
      'what a rest parameter held, spread on',
      "const merge = (...styles) => Object.assign({}, ...styles)\nexport const A = (p) => css(merge({ margin: '2' }, { color: p.on ? 'red.300' : 'blue.300' }))",
    ],
    [
      'an element of a rest parameter holding one of two values',
      "const first = (...xs) => xs[0]\nexport const A = (p) => css(first({ color: p.on ? 'red.300' : 'blue.300' }))",
    ],
    // How many a spread of an unknown length passes is not known, so neither is a parameter after it.
    [
      'a parameter after a spread of unknown length',
      "const second = (a, b) => b ?? 'red.300'\nexport const A = (props) => css({ color: second(...props.list) })",
    ],
    [
      'a rest pattern’s object taken from one',
      'const { b, ...rest } = (track(), { zIndex: 1, b: f() })\nconst g = () => rest\nexport const A = css(g())',
    ],
    // An undecided element of a rest parameter is not what it holds without its values.
    [
      '`typeof` of an element inside an undecided rest element',
      "const kind = (...xs) => (typeof xs[0][0] === 'string') + 1\nexport const A = (p) => css({ zIndex: kind([p.on ? 'a' : 'b']) })",
    ],
    [
      '`??` on an element inside an undecided rest element',
      "const first = (...xs) => xs[0][0] ?? 'green.300'\nexport const A = (p) => css({ color: first([p.on ? 'red.300' : 'blue.300']) })",
    ],
    // Past a spread of unknown length no parameter is known, however far past it.
    [
      'a parameter far past a spread of unknown length',
      "const pick = (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16) => a16 ?? 'blue.300'\nexport const A = (p) => css({ color: pick(...p.xs, 'red.300') })",
    ],
    [
      'a parameter past one, nothing after it',
      "const pick = (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16) => a16 ?? 'blue.300'\nexport const A = (p) => css({ color: pick(...p.xs) })",
    ],
    // A numeric enum also maps each value to its member's name, which the build does not hold.
    [
      'a read through an enum’s reverse mapping',
      "enum Area { main = 1 }\nexport const A = css({ color: 'red.300', gridArea: Area[Area.main] })",
    ],
    [
      'a reverse read of an enum merged with a namespace of types',
      "enum Tone { zIndex = 1 }\nnamespace Tone { export type K = keyof typeof Tone }\nexport const A = css({ color: 'red.300', gridArea: Tone[Tone.zIndex] })",
    ],
    // A namespace's export over an enum's member is not the member.
    [
      'a member a namespace exports over',
      'enum Tone { zIndex = 1 }\nnamespace Tone { export const zIndex = 5 }\nexport const A = css({ zIndex: Tone.zIndex })',
    ],
    // Converting an array reads all of it.
    [
      '`join` of an array holding an undecided element',
      `export const A = (p) => css({ gridTemplateAreas: [p.wide ? '"a b"' : '"a"', '"c c"'].join(' ') })`,
    ],
    [
      '`+` on an array holding an undecided element',
      "export const A = (p) => css({ gridArea: [p.on ? 'a' : 'b'] + 'x' })",
    ],
    [
      'a template literal of one, in a helper',
      "const t = (xs) => `${xs}x`\nexport const A = (p) => css({ gridArea: t([p.on ? 'a' : 'b']) })",
    ],
    // Converted as any value is, a key the build could not wholly read is not known.
    [
      'a computed key joined from an undecided part',
      "const sizes = { 'lg-x': '4', 'sm-x': '2' }\nconst sizeOf = (...parts) => sizes[parts.join('-')]\nexport const A = (p) => css({ padding: sizeOf(p.big ? 'lg' : 'sm', 'x') })",
    ],
    [
      'the key of `in`, an array holding an undecided element',
      "export const A = (p) => css({ zIndex: ([p.on ? 'a' : 'b'] in { a: 1, b: 2 }) + 1 })",
    ],
    // Two objects are the same only as one object, which the build does not say.
    ['`===` of two arrays', 'export const A = css({ zIndex: ([1] === [1]) + 1 })'],
    // The same once each run of whitespace is one space, two strings holding any may still differ:
    // the build collapses a literal's as it reads it, and keeps what a string built from others held.
    [
      '`===` of strings the same but for how their whitespace was written',
      "const same = (a, b) => (a === b ? 1 : 2)\nexport const A = css({ zIndex: same('a ' + ' b', 'a  b') })",
    ],
    [
      '`===` of a value holding a space and the same string',
      "const g = (t = '1fr 1fr') => ({ gridTemplateColumns: t === '1fr 1fr' ? 'auto' : t })\nexport const A = css(g())",
    ],
    // A fragment an array holds under the index read may be a sibling's, under a key that is it.
    // A default stands in for `undefined`, not for one of several values.
    [
      'a parameter default given one of two values',
      "const f = (x = 'green.300') => x\nexport const A = (p) => css({ color: f(p.on ? 'red.300' : 'blue.300') })",
    ],
    [
      'a destructuring default given one of two values',
      "const g = (a) => { const { color = 'green.300' } = a; return { color } }\nexport const A = (p) => css(g({ color: p.on ? 'red.300' : 'blue.300' }))",
    ],
    // Declared again, an enum holds what each declaration adds, not what the first does alone.
    [
      'a member another declaration of an enum adds',
      'enum Tone { zIndex = 1 }\nenum Tone { lifted = 2 }\nexport const A = css({ zIndex: Tone.lifted })',
    ],
    [
      'a member a `declare`d namespace says an enum has',
      "enum Tone { zIndex = 1 }\ndeclare namespace Tone { const margin: string }\nexport const A = css({ color: 'red.300', margin: Tone.margin })",
    ],
    [
      'a member a namespace adds to an enum',
      "enum Tone { zIndex = 1 }\nnamespace Tone { export const margin = '2' }\nexport const A = css({ color: 'red.300', margin: Tone.margin })",
    ],
  ])('%s', (_, body) => {
    expect(foldOf(withImport(body))).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })

  // Read as one in the module itself is, so not known where that one is not.
  test.each([
    [
      'written to by `Object.assign`',
      'export enum Tone { zIndex = 1 }\nObject.assign(Tone, { zIndex: 5 })\n',
      'css({ zIndex: Tone.zIndex })',
    ],
    [
      'written to through a cast',
      'export enum Tone { zIndex = 1 }\n;(Tone as any).zIndex = 5\n',
      'css({ zIndex: Tone.zIndex })',
    ],
    [
      'merged with a namespace',
      "export enum Tone { zIndex = 1 }\nexport namespace Tone { export const margin = '2' }\n",
      "css({ color: 'red.300', margin: Tone.margin })",
    ],
    [
      'declared twice',
      'export enum Tone { zIndex = 1 }\nexport enum Tone { lifted = 2 }\n',
      'css({ zIndex: Tone.lifted })',
    ],
  ])('an enum another module exports, %s', (_, tone, call) => {
    const files = { 'app/src/tone.ts': tone }
    const code = withImport(`import { Tone } from './tone'\nexport const A = ${call}`)

    expect(foldOf(code, files)).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })

  // One of several values may be `undefined`, which a choice keeps no branch for, so the default's
  // rules are written too.
  test("a default given one of several values writes the default's rules", () => {
    const body =
      "const f = (x = 'green.300') => x\nexport const A = (p) => css({ color: f(p.on ? undefined : 'red.300') })"
    const { classes, skipped, css } = foldOf(withImport(body))

    expect(classes).toEqual([])
    expect(skipped).toContain('dynamic')
    expect(css).toContain('green\\.300')
  })

  test("a destructuring default given one of several values writes the default's rules", () => {
    const body =
      "const g = (a) => { const { color = 'green.300' } = a; return { color } }\nexport const A = (p) => css(g({ color: p.on ? undefined : 'red.300' }))"
    const { classes, css } = foldOf(withImport(body))

    expect(classes).toEqual([])
    expect(css).toContain('green\\.300')
  })

  // A default that runs code is not run for this: a call the runtime never makes here could cut the
  // whole call short, and the given values' rules with it.
  test("a default that calls a helper leaves the given values' rules", () => {
    const body = "const f = (x = f()) => x\nexport const A = (p) => css({ color: f(p.on ? 'red.300' : 'blue.300') })"
    const { css } = foldOf(withImport(body))

    expect(css).toContain('red\\.300')
    expect(css).toContain('blue\\.300')
  })

  // Nor is one that reads a binding: reading it runs what the binding was given, which may call a
  // helper in turn.
  test('a default reading a binding is not run for one of several values', () => {
    const body =
      "const DEFAULT = 'gray.500'\nconst f = (x = DEFAULT) => ({ color: x })\nexport const A = (p) => css(f(p.on ? undefined : 'red.300'))"
    const { css } = foldOf(withImport(body))

    expect(css).toContain('red\\.300')
    expect(css).not.toContain('gray\\.500')
  })

  // It throws there.
  test('`css.raw` of an array, in a module the compiler does not transform', () => {
    const files = {
      'app/src/button.ts':
        "import { css } from 'styled-system/css'\nexport const button = css.raw([{ color: 'red.300' }])\n",
    }
    const code = withImport(`import { button } from './button'\nexport const A = css(button)`)

    expect(foldOf(code, files)).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })

  // Their merge is not the first of them.
  test.each([
    ['written out', "export const A = css(css.raw({ color: 'red.300' }, { margin: '2' }))"],
    [
      'passed through a helper',
      "const sx = (...styles) => css.raw(...styles)\nexport const A = css(sx({ color: 'red.300' }, { margin: '2' }))",
    ],
  ])('`css.raw` of more than one style object, %s', (_, body) => {
    const { classes, skipped } = foldOf(withImport(body))

    expect(classes).toEqual([])
    expect(skipped).toContain('dynamic')
  })

  // The object a rest pattern makes is without the key it took, and the reason that key was not
  // known goes with it: a call refused for what it still holds is not said to be for that.
  test('for a key a rest pattern did not take', () => {
    const make = 'const make = () => { compute()\nreturn 1 }\nconst o = { zIndex: 1, b: make() }\n'
    const refusalOf = (body: string) => createFoldFixture().fold(withImport(make + body)).skipped[0]?.refusal

    expect(refusalOf('export const A = css({ ...o, color: other() })')).toMatchObject({ helper: 'make' })
    expect(refusalOf('const { b, ...rest } = o\nexport const A = css({ ...rest, color: other() })')).toBeUndefined()
  })
})

describe('`fallback()`', () => {
  const withFallback = (body: string) => `import { css, fallback } from 'styled-system/css'\n${body}\n`

  // It was taken for `undefined`, and the property dropped.
  test('of a value the build cannot evaluate is not known', () => {
    const code = withFallback("export const A = (p) => css({ height: fallback(p.h, '100vh') })")

    expect(foldOf(code)).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })

  // Written as nothing, one of several values gave `fallback(, 100vh)`.
  test('of one of several values is not known', () => {
    const code = withFallback("export const A = (p) => css({ height: fallback(p.t ? '50vh' : '25vh', '100vh') })")

    expect(foldOf(code)).toMatchObject({ classes: [], skipped: ['dynamic'] })
  })

  // A value read off an array is what it is, whatever its siblings could be.
  test('of a value read off an array is known', () => {
    const code = withFallback(
      "export const A = (p) => { const sizes = [p.tall ? '50vh' : '25vh', '100vh']; return css({ height: fallback(sizes[1], '100dvh') }) }",
    )

    expect(foldOf(code)).toMatchObject({ classes: ['h_fallback(100vh,_100dvh)'], skipped: [] })
  })

  // As the runtime's `join` writes them, which the candidates are then read without.
  test.each([
    ['`undefined`', "fallback(undefined, '100vh')"],
    ['`null`', "fallback(null, '100vh')"],
    ['a hole spread into it', "fallback(...[, '100vh'])"],
  ])('writes %s as nothing', (_, call) => {
    const { classes, skipped, css } = foldOf(withFallback(`export const A = css({ height: ${call} })`))

    expect(skipped).toEqual([])
    expect(classes).toEqual(['h_fallback(,_100vh)'])
    expect(css).toContain('height: 100vh')
    expect(css).not.toContain('null')
  })
})
