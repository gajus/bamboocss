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
