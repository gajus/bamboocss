import { withoutMergeCodes } from '@bamboocss/fixture'
import { getRecipeIdentity, viewTransitionClassName } from '@bamboocss/shared'
import { describe, expect, test } from 'vitest'
import { createFoldFixture, selectorsFor } from './fixture'

describe('static style-set folding', () => {
  test('an inline recipe and css share the same declaration atom across files', () => {
    const fixture = createFoldFixture()

    const recipe = fixture.foldStyleSets(
      `
      import { cva } from 'styled-system/css'
      const layout = cva({ base: { display: 'flex' } })
      export const className = layout()
    `,
      'app/src/recipe.ts',
    )

    const utility = fixture.foldStyleSets(
      `
      import { css } from 'styled-system/css'
      export const className = css({ display: 'flex' })
    `,
      'app/src/utility.ts',
    )

    expect(recipe.folded).toHaveLength(2)
    expect(utility.folded).toHaveLength(1)
    expect(recipe.folded[0]!.className).toBe(utility.folded[0]!.className)

    const css = fixture.getStyleSetCss()
    for (const selector of selectorsFor(recipe.folded[0]!.className)) {
      expect(css).toContain(selector)
      expect(css.split(selector)).toHaveLength(2)
    }
  })

  test('a static recipe selection is composed before its atoms are allocated', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { cva } from 'styled-system/css'
      const badge = cva({
        base: { display: 'flex', color: 'red.300' },
        variants: { tone: { quiet: { color: 'gray.500' } } },
        compoundVariants: [{ tone: 'quiet', css: { opacity: 0.8 } }],
      })
      export const className = badge({ tone: 'quiet' })
    `)

    expect(result.folded).toHaveLength(2)
    expect(result.folded[0]!.className).toBe(fixture.runtimeCss({ display: 'flex', color: 'gray.500', opacity: 0.8 }))
  })

  test('recipe axis precedence follows declaration order, not call-site object order', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { cva } from 'styled-system/css'
      const badge = cva({
        variants: {
          tone: { quiet: { color: 'gray.500' } },
          size: { sm: { color: 'blue.500' } },
        },
      })
      export const a = badge({ tone: 'quiet', size: 'sm' })
      export const b = badge({ size: 'sm', tone: 'quiet' })
    `)

    const expected = fixture.runtimeCss({ color: 'blue.500' })
    expect(result.folded.filter((entry) => entry.kind === 'class').map((entry) => entry.className)).toEqual([
      expected,
      expected,
    ])
  })

  test('an undeclared variant value cannot activate a compound selector with no backing class', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { cva } from 'styled-system/css'
      const badge = cva({
        base: { display: 'flex' },
        variants: { tone: { quiet: { color: 'gray.500' } } },
        compoundVariants: [{ tone: 'missing', css: { color: 'red.500' } }],
      })
      export const className = badge({ tone: 'missing' })
    `)

    expect(result.folded.find((entry) => entry.kind === 'class')?.className).toBe(
      fixture.runtimeCss({ display: 'flex' }),
    )
  })

  test('compound matching follows the emitted variant class key coercion', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { cva } from 'styled-system/css'
      const badge = cva({
        variants: { selected: { false: { opacity: 0.5 } } },
        compoundVariants: [{ selected: 'false', css: { color: 'red.500' } }],
      })
      export const className = badge({ selected: false })
    `)

    expect(result.folded.find((entry) => entry.kind === 'class')?.className).toBe(
      fixture.runtimeCss({ opacity: 0.5, color: 'red.500' }),
    )
  })

  test('cx composes recipe and css declarations before either becomes a class string', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { css, cva, cx } from 'styled-system/css'
      const badge = cva({ base: { display: 'flex', color: 'red.300' } })
      export const className = cx(
        badge(),
        css({ display: 'flex', color: 'blue.500' }),
      )
    `)

    const expected = fixture.runtimeCss({ display: 'flex', color: 'blue.500' })
    expect(result.code).toContain(JSON.stringify(expected))
    expect(result.code).not.toContain('cx(')
    expect(result.code).not.toContain(fixture.runtimeCss({ color: 'red.300' }))
    expect(result.folded.some((entry) => entry.name === 'cx' && entry.className === expected)).toBe(true)
  })

  test('cx preserves static third-party classes while composing Bamboo styles', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { css, cx } from 'styled-system/css'
      export const className = cx('external', css({ color: 'red.300' }), 'selected')
    `)

    expect(result.code).toContain(JSON.stringify(`external ${fixture.runtimeCss({ color: 'red.300' })} selected`))
  })

  test('cx recursively composes statically analyzable arrays', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { css, cx } from 'styled-system/css'
      export const className = cx(['external', [css({ color: 'red.300' }), false]], css({ color: 'blue.500' }))
    `)

    expect(result.code).toContain(JSON.stringify(`external ${fixture.runtimeCss({ color: 'blue.500' })}`))
    expect(result.skipped).not.toContainEqual(expect.objectContaining({ name: 'cx', reason: 'dynamic' }))
  })

  test('a finite dynamic recipe becomes a reduced lookup of complete shared StyleSets', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { cva } from 'styled-system/css'
      const badge = cva({
        base: { display: 'flex', color: 'red.300' },
        variants: {
          tone: {
            quiet: { color: 'gray.500' },
            loud: { color: 'red.500' },
          },
        },
        defaultVariants: { tone: 'quiet' },
        compoundVariants: [{ tone: 'loud', css: { opacity: 0.8 } }],
      })
      export const className = (tone) => badge({ tone })
    `)

    expect(result.skipped).not.toContainEqual(expect.objectContaining({ reason: 'recipe-call' }))
    expect(result.code).toContain('cvaMap([tone]')
    expect(result.code).not.toMatch(/cva_[a-z0-9]+--tone/)

    const quiet = fixture.runtimeCss({ display: 'flex', color: 'gray.500' })
    const loud = fixture.runtimeCss({ display: 'flex', color: 'red.500', opacity: 0.8 })
    const miss = fixture.runtimeCss({ display: 'flex', color: 'red.300' })
    expect(result.code).toContain(JSON.stringify(quiet).slice(1, -1))
    expect(result.code).toContain(JSON.stringify(loud).slice(1, -1))
    expect(result.code).toContain(JSON.stringify(miss).slice(1, -1))
    expect(result.folded[0]!.classNames).toEqual(
      expect.arrayContaining([...quiet.split(' '), ...loud.split(' '), ...miss.split(' ')]),
    )
  })

  test('bounds an exact dynamic recipe table before enumerating its Cartesian product', () => {
    const fixture = createFoldFixture()
    const source = `
      import { cva } from 'styled-system/css'
      const badge = cva({
        variants: {
          tone: { quiet: { color: 'gray.500' }, loud: { color: 'red.500' } },
          size: { sm: { padding: '2' }, md: { padding: '4' } },
        },
      })
      export const className = (tone, size) => badge({ tone, size })
    `

    // Each axis has miss, undefined, and two declared values: 4 * 4 = 16 exact states.
    expect(() => fixture.foldStyleSets(source, 'app/src/state-limit.ts', 15)).toThrow('would inspect 16 selections')
    expect(() => fixture.foldStyleSets(source, 'app/src/state-limit.ts', 16)).not.toThrow()
  })

  test('composes static cx styles into every runtime StyleSet leaf', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { css, cva, cx } from 'styled-system/css'
      const badge = cva({ variants: { tone: { quiet: { color: 'gray.500' } } } })
      export const className = (tone) => cx(badge({ tone }), css({ color: 'blue.500' }))
    `)

    expect(result.skipped).not.toContainEqual(expect.objectContaining({ name: 'cx', reason: 'dynamic' }))
    const cx = result.folded.find((entry) => entry.name === 'cx')
    expect(withoutMergeCodes(cx?.classNames)).toContain('c_blue.500')
    expect(withoutMergeCodes(cx?.classNames)).not.toContain('c_gray.500')
    // The later static color makes every recipe state identical, so the reduced map itself
    // disappears instead of shipping a one-leaf runtime lookup.
    expect(withoutMergeCodes(result.code)).toContain('=> "c_blue.500"')
    expect(result.code).not.toContain('cvaMap(')
  })

  test('inline sva slot accesses share atoms with css, including finite runtime variants', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { css, sva } from 'styled-system/css'
      const field = sva({
        slots: ['root', 'label'],
        base: { root: { display: 'flex' }, label: { color: 'red.300' } },
        variants: {
          tone: {
            quiet: { root: { opacity: 0.8 }, label: { color: 'gray.500' } },
            loud: { root: { opacity: 1 }, label: { color: 'red.500' } },
          },
        },
      })
      export const root = field({ tone: 'quiet' }).root
      export const label = (tone) => field({ tone }).label
      export const utility = css({ display: 'flex' })
    `)

    expect(result.code).toContain(JSON.stringify(fixture.runtimeCss({ display: 'flex', opacity: 0.8 })))
    expect(result.code).toContain('cvaMap([tone]')
    expect(result.code).not.toMatch(/sva_[a-z0-9]+__/)
    expect(result.folded.some((entry) => withoutMergeCodes(entry.classNames).includes('d_flex'))).toBe(true)
  })

  test('a whole inline sva call becomes one slot object lookup', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStyleSets(`
      import { sva } from 'styled-system/css'
      const field = sva({
        slots: ['root', 'label'],
        base: { root: { display: 'flex' }, label: { color: 'red.300' } },
        variants: { tone: { quiet: { label: { color: 'gray.500' } } } },
      })
      export const staticSlots = field({ tone: 'quiet' })
      export const dynamicSlots = (tone) => field({ tone })
    `)

    expect(result.code).toContain(
      JSON.stringify({
        root: fixture.runtimeCss({ display: 'flex' }),
        label: fixture.runtimeCss({ color: 'gray.500' }),
      }),
    )
    expect(result.code).toContain('cvaMap([tone]')
    expect(result.folded.filter((entry) => entry.kind === 'slots')).toHaveLength(2)
  })

  test('a static viewTransition bag becomes its extracted class literal', () => {
    const fixture = createFoldFixture()
    const options = { old: { animationName: 'fade-out' }, new: { animationName: 'fade-in' } }
    const result = fixture.foldStrict(`
      import { cx, viewTransition } from 'styled-system/css'
      export const transition = cx('external', viewTransition(${JSON.stringify(options)}))
    `)

    const className = viewTransitionClassName(options, fixture.ctx.utility.prefix)
    expect(result.code).toContain(JSON.stringify(`external ${className}`))
    expect(result.code).not.toContain('viewTransition(')
    expect(result.code).not.toContain('cx(')
    expect(result.skipped).not.toContainEqual(expect.objectContaining({ reason: 'runtime-binding' }))
    expect(fixture.getStyleSetCss()).toContain(`view-transition-class: ${className}`)
  })

  test('rejects an open viewTransition bag instead of retaining its runtime', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(`
      import { viewTransition } from 'styled-system/css'
      export const transition = (duration) => viewTransition({ old: { animationDuration: duration } })
    `)

    expect(result.skipped).toContainEqual(expect.objectContaining({ name: 'viewTransition', reason: 'dynamic' }))
  })
})

/**
 * A recipe call takes one variant per axis. `{ base: 'sm', md: 'lg' }` was taken for a runtime
 * value and compiled into the decision table, where it reached the lookup as `[object Object]`,
 * matched no variant, and rendered the call without one: no error, and no size.
 */
describe('a responsive or conditional selection', () => {
  const refused = (result: ReturnType<ReturnType<typeof createFoldFixture>['foldStrict']>, name: string) => {
    expect(result.code).not.toContain('cvaMap(')
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        name,
        reason: 'recipe-call',
        detail: expect.stringContaining('`size` is selected with an object'),
      }),
    )
  }

  test.each([
    ['an object', `{ base: 'sm', md: 'md' }`],
    ['an array', `['sm', 'md']`],
  ])('is refused, written as %s', (_label, value) => {
    const result = createFoldFixture().foldStrict(`
      import { buttonStyle } from 'styled-system/recipes'
      export const className = buttonStyle({ size: ${value} })
    `)
    refused(result, 'buttonStyle')
  })

  test('is refused through a binding holding one', () => {
    const result = createFoldFixture().foldStrict(`
      import { buttonStyle } from 'styled-system/recipes'
      const size = { base: 'sm', md: 'md' }
      export const className = buttonStyle({ size })
    `)
    refused(result, 'buttonStyle')
  })

  test('is refused by an inline recipe', () => {
    const result = createFoldFixture().foldStrict(`
      import { cva } from 'styled-system/css'
      const badge = cva({ variants: { size: { sm: { fontSize: 'sm' }, lg: { fontSize: 'lg' } } } })
      export const className = badge({ size: { base: 'sm', md: 'lg' } })
    `)
    refused(result, 'badge')
  })

  // The value is the caller's, and may be one of the variants: only a written or known object is refused.
  test('a parameter still compiles to the decision table', () => {
    const result = createFoldFixture().foldStrict(`
      import { buttonStyle } from 'styled-system/recipes'
      export const Button = (size) => buttonStyle({ size })
    `)
    expect(result.code).toContain('cvaMap(')
    expect(result.skipped).toEqual([])
  })
})

/**
 * An inline recipe's name is a hash of its config with object keys sorted, so two configs writing
 * the same variants in another order share one name. Registering the second compared the two
 * configs key order and all, and failed the build as a conflict — `could not be extracted` — over
 * two valid programs. The order does decide precedence between variants that set the same property,
 * but each call's classes come from its own config, so it still does.
 */
describe('inline recipes that differ only in key order', () => {
  const solidFirst = `cva({ variants: { visual: { solid: { padding: '1px' } }, size: { sm: { padding: '4px' } } } })`
  const sizeFirst = `cva({ variants: { size: { sm: { padding: '4px' } }, visual: { solid: { padding: '1px' } } } })`

  test('compile in one file, each call by its own config order', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(`
      import { cva } from 'styled-system/css'
      const a = ${solidFirst}
      const b = ${sizeFirst}
      export const x = a({ visual: 'solid', size: 'sm' })
      export const y = b({ visual: 'solid', size: 'sm' })
    `)

    // What the build asserts before it emits anything: the fold alone named the right classes
    // while the stylesheet pass failed on the file.
    expect(() => fixture.ctx.assertExtracted(fixture.ctx.parseFailures.keys())).not.toThrow()
    expect(result.skipped).toEqual([])
    expect(withoutMergeCodes(result.code)).toContain('export const x = "p_4px"')
    expect(withoutMergeCodes(result.code)).toContain('export const y = "p_1px"')
    const css = withoutMergeCodes(fixture.getStyleSetCss())
    expect(css).toMatch(/\.p_1px \{\s*padding: 1px/)
    expect(css).toMatch(/\.p_4px \{\s*padding: 4px/)
  })

  test('compile across two files', () => {
    const fixture = createFoldFixture()
    const first = fixture.foldStrict(
      `
      import { cva } from 'styled-system/css'
      const a = ${solidFirst}
      export const x = a({ visual: 'solid', size: 'sm' })
    `,
      'src/first.tsx',
    )
    const second = fixture.foldStrict(
      `
      import { cva } from 'styled-system/css'
      const b = ${sizeFirst}
      export const y = b({ visual: 'solid', size: 'sm' })
    `,
      'src/second.tsx',
    )

    expect(() => fixture.ctx.assertExtracted(fixture.ctx.parseFailures.keys())).not.toThrow()
    expect(first.skipped).toEqual([])
    expect(second.skipped).toEqual([])
    expect(withoutMergeCodes(first.code)).toContain('export const x = "p_4px"')
    expect(withoutMergeCodes(second.code)).toContain('export const y = "p_1px"')
  })

  // Key order aside, one name still has one meaning: a declared name with other styles is a conflict.
  test('a different recipe under the same declared name still fails', () => {
    const fixture = createFoldFixture()
    fixture.foldStrict(
      `
      import { cva } from 'styled-system/css'
      const a = cva({ className: 'btn', base: { color: 'red' } })
      export const x = a()
    `,
      'src/first.tsx',
    )
    fixture.foldStrict(
      `
      import { cva } from 'styled-system/css'
      const b = cva({ className: 'btn', base: { color: 'blue' } })
      export const y = b()
    `,
      'src/second.tsx',
    )

    expect(() => fixture.ctx.assertExtracted(fixture.ctx.parseFailures.keys())).toThrowError(
      /inline recipe "btn" conflicts with another owner/,
    )
  })

  // A file that joined another's registration holds it in its own key order, and letting go of it
  // last has to release it as the first file would have.
  test('a registration both files let go of is released', () => {
    const fixture = createFoldFixture()
    const declare = (file: string, recipe: string) =>
      fixture.foldStrict(
        `
      import { cva } from 'styled-system/css'
      const r = ${recipe}
      export const x = r({ visual: 'solid', size: 'sm' })
    `,
        file,
      )
    declare('src/first.tsx', solidFirst)
    declare('src/second.tsx', sizeFirst)
    const name = getRecipeIdentity({
      variants: { visual: { solid: { padding: '1px' } }, size: { sm: { padding: '4px' } } },
    })
    expect(fixture.ctx.recipes.getInlineConfig(name)).toBeDefined()

    fixture.foldStrict(`export const x = 1`, 'src/first.tsx')
    fixture.foldStrict(`export const y = 1`, 'src/second.tsx')
    expect(fixture.ctx.recipes.getInlineConfig(name)).toBeUndefined()
  })

  // Values of one variant are exclusive, so their order decides nothing at all.
  test('compile when only the values of one variant are reordered', () => {
    const fixture = createFoldFixture()
    const result = fixture.foldStrict(`
      import { cva } from 'styled-system/css'
      const a = cva({ variants: { size: { sm: { padding: '4px' }, md: { padding: '8px' } } } })
      const b = cva({ variants: { size: { md: { padding: '8px' }, sm: { padding: '4px' } } } })
      export const x = a({ size: 'md' })
      export const y = b({ size: 'sm' })
    `)

    expect(() => fixture.ctx.assertExtracted(fixture.ctx.parseFailures.keys())).not.toThrow()
    expect(result.skipped).toEqual([])
    expect(withoutMergeCodes(result.code)).toContain('export const x = "p_8px"')
    expect(withoutMergeCodes(result.code)).toContain('export const y = "p_4px"')
  })
})
