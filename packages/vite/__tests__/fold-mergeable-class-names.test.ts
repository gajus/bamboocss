import { generateCx } from '../../generator/src/artifacts/js/cx'
import { esc } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

/**
 * Class names `cx` merges, end to end: a component styling itself with `css()` and forwarding the
 * `className` it is handed, folded by the compiler, then run against the `cx` the build emits.
 *
 * The class passed in has to win where it sets what the component sets, keep the component's
 * other classes, and name only classes the stylesheet has a rule for — in a readable build and a
 * hashed one alike, since dev and production are those two and disagreeing between them is how the
 * first merging `cx` failed.
 */
const MODULE = `import { css, cx } from 'styled-system/css'
export const card = (className) => cx(css({ width: '480px', color: 'red.300', md: { width: '600px' } }), className)
export const wide = css({ width: '640px' })
export const tall = css({ height: '320px' })
`

const run = (hash: boolean) => {
  // Class names only: hashed variables would make a readable and a hashed declaration differ.
  const fixture = createFoldFixture({ hash: { className: hash } })
  const result = fixture.fold(MODULE)
  const { js } = generateCx(fixture.ctx as never)
  const cx = new Function(js.replace(/^import[^\n]*\n/m, '').replace(/export\s*\{[^}]*\}/, 'return { cx }'))().cx as (
    ...args: unknown[]
  ) => string
  const exports = new Function(
    'cx',
    `${result.code.replace(/^import .*$/gm, '').replaceAll('export const ', 'const ')}\nreturn { card, wide, tall }`,
  )(cx) as { card: (className?: string) => string; wide: string; tall: string }
  const css = fixture.getCss()
  /** The declaration each class has a rule for, by the rule's selector. */
  const declarationOf = (className: string) => {
    const rule = new RegExp(`\\.${esc(className).replace(/[\\[\]().:!]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
    return rule?.[1]?.trim().replace(/;$/, '')
  }
  return { exports, declarationOf }
}

describe.each([
  ['readable', false],
  ['hashed', true],
])('mergeable class names, %s', (_name, hash) => {
  test("a class passed in overrides the component's own, and keeps the rest", () => {
    const { exports, declarationOf } = run(hash)
    const merged = exports.card(exports.wide).split(' ')

    expect(merged).toContain(exports.wide)
    // The 480px it set itself is gone; its colour and its `md` width are not.
    expect(merged.map(declarationOf).sort()).toEqual(['color: var(--colors-red-300)', 'width: 600px', 'width: 640px'])
  })

  test('a class of another property is added beside them', () => {
    const { exports, declarationOf } = run(hash)
    const merged = exports.card(exports.tall).split(' ')

    expect(merged).toHaveLength(4)
    expect(merged.map(declarationOf)).toContain('height: 320px')
    expect(merged.map(declarationOf)).toContain('width: 480px')
  })

  test('every class the merge returns has a rule', () => {
    const { exports, declarationOf } = run(hash)
    for (const className of exports.card(exports.wide).split(' '))
      expect(declarationOf(className), className).toBeTruthy()
  })
})

test('a readable and a hashed build keep the same declarations', () => {
  const declarationsOf = (hash: boolean) => {
    const { exports, declarationOf } = run(hash)
    return exports.card(exports.wide).split(' ').map(declarationOf).sort()
  }

  expect(declarationsOf(false)).toEqual(declarationsOf(true))
})

/**
 * A `cx()` means one thing whether or not the compiler can see every argument. Where it can, it
 * composes them before a class exists; where one is a class passed in, the runtime `cx` merges the
 * classes. Composed like `css(a, b)`, a later `{ p: '3' }` replaced an earlier `{ p: { base: '2',
 * md: '4' } }` outright, dropping the `md` padding the runtime merge keeps: the same two styles
 * rendered differently once one of them came through a prop. So the compiler composes the way the
 * runtime merges, by property and conditions, and these pairs, each a shape where the two used to
 * disagree or might, have to put the same classes on the element both ways.
 */
describe('a cx() the compiler composes merges as the runtime cx does', () => {
  const PAIRS: Array<[string, string]> = [
    // A later plain value beside an earlier one per condition.
    [`{ padding: { base: '2', md: '4' } }`, `{ padding: '3' }`],
    // A later value under a condition beside an earlier plain one.
    [`{ color: 'red' }`, `{ color: { _hover: 'blue' } }`],
    // One property under one condition, nested both ways.
    [`{ md: { padding: '4' } }`, `{ padding: { md: '5' } }`],
    // The later wins, important or not.
    [`{ color: 'red.300!' }`, `{ color: 'blue.300' }`],
    // An alias and the property it stands for.
    [`{ bg: 'red.300' }`, `{ background: 'blue.300' }`],
    // A condition both write, setting different properties under it.
    [`{ _hover: { color: 'red' }, padding: '2' }`, `{ _hover: { bg: 'blue.300' } }`],
    // A longhand beside its shorthand is another property, ranked by the cascade.
    [`{ padding: '2' }`, `{ paddingTop: '3' }`],
  ]

  const MODULE_OF_PAIRS = [
    `import { css, cx } from 'styled-system/css'`,
    ...PAIRS.flatMap(([a, b], index) => [
      `export const composed${index} = cx(css(${a}), css(${b}))`,
      `export const chosen${index} = (on) => cx(css(${a}), on && css(${b}))`,
      `export const own${index} = css(${a})`,
      `export const passed${index} = css(${b})`,
    ]),
  ].join('\n')

  const compile = (hash: boolean) => {
    const fixture = createFoldFixture({ hash: { className: hash } })
    const result = fixture.fold(MODULE_OF_PAIRS)
    const { js } = generateCx(fixture.ctx as never)
    const cx = new Function(js.replace(/^import[^\n]*\n/m, '').replace(/export\s*\{[^}]*\}/, 'return { cx }'))().cx as (
      ...args: unknown[]
    ) => string
    const names = PAIRS.flatMap((_, index) => [`composed${index}`, `chosen${index}`, `own${index}`, `passed${index}`])
    const exports = new Function(
      'cx',
      `${result.code.replace(/^import .*$/gm, '').replaceAll('export const ', 'const ')}\nreturn { ${names.join(', ')} }`,
    )(cx) as Record<string, string | ((on: boolean) => string)>
    return { cx, exports }
  }

  const classes = (value: string) => value.split(' ').filter(Boolean).sort()

  describe.each([
    ['readable', false],
    ['hashed', true],
  ])('%s', (_name, hash) => {
    test.each(PAIRS.map((pair, index) => [index, ...pair] as const))('pair %i: %s then %s', (index) => {
      const { cx, exports } = compile(hash)
      const merged = cx(exports[`own${index}`], exports[`passed${index}`])
      const chosen = exports[`chosen${index}`] as (on: boolean) => string

      expect(classes(exports[`composed${index}`] as string), 'composed').toEqual(classes(merged))
      expect(classes(chosen(true)), 'chosen').toEqual(classes(merged))
      expect(classes(chosen(false)), 'not chosen').toEqual(classes(exports[`own${index}`] as string))
    })
  })
})

// A recipe lookup the compiler cannot answer is compiled to one complete class string per answer,
// each merged with the `cx()` arguments beside it, and has to merge as the runtime would too.
test.each([
  ['readable', false],
  ['hashed', true],
])('a recipe lookup a cx() composes merges as the runtime cx does, %s', (_name, hash) => {
  const fixture = createFoldFixture({ hash: { className: hash } })
  const result = fixture.fold(`import { css, cva, cx } from 'styled-system/css'
const card = cva({
  base: { padding: { base: '2', md: '4' } },
  variants: { tone: { quiet: { color: 'gray.300' }, loud: { color: 'red.300' } } },
})
export const composed = (tone) => cx(card({ tone }), css({ padding: '3' }))
export const own = (tone) => card({ tone })
export const passed = css({ padding: '3' })
`)
  const { js } = generateCx(fixture.ctx as never)
  const helpers = new Function(
    js.replace(/^import[^\n]*\n/m, '').replace(/export\s*\{[^}]*\}/, 'return { cx, cvaMap }'),
  )()
  const code = result.code.replace(/^import .*$/gm, '').replaceAll('export const ', 'const ')
  const exports = new Function('cx', 'cvaMap', `${code}\nreturn { composed, own, passed }`)(
    helpers.cx,
    helpers.cvaMap,
  ) as {
    composed: (tone: string) => string
    own: (tone: string) => string
    passed: string
  }
  const classes = (value: string) => value.split(' ').filter(Boolean).sort()

  expect(code, 'the lookup is compiled, not left to the runtime').not.toContain('cva(')
  for (const tone of ['quiet', 'loud']) {
    expect(classes(exports.composed(tone)), tone).toEqual(classes(helpers.cx(exports.own(tone), exports.passed)))
  }
})
