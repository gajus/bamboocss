import { describe, expect, test } from 'vitest'
import { createFoldFixture } from './fixture'

const classes = (result: ReturnType<ReturnType<typeof createFoldFixture>['fold']>) =>
  result.folded.filter((entry) => entry.kind === 'class' || entry.kind === 'slots')

describe('calls the compiler rejects', () => {
  test.each([
    {
      reason: 'raw-call',
      code: `import { css } from 'styled-system/css'\nexport const styles = css.raw({ color: 'red.300' })\n`,
    },
    {
      reason: 'dynamic',
      code: `import { css } from 'styled-system/css'\nexport const make = (tone) => css({ color: { base: tone } })\n`,
    },
    {
      reason: 'dynamic',
      code: `import { css } from 'styled-system/css'\nexport const make = (rest) => css({ color: 'red.300', ...rest })\n`,
    },
    {
      reason: 'dynamic',
      code: `import { flex } from 'styled-system/patterns'\nexport const make = (gap) => flex({ gap })\n`,
    },
  ])('leaves $reason source unchanged', ({ code, reason }) => {
    const result = createFoldFixture().fold(code)
    expect(result.code).toBe(code)
    expect(result.folded).toHaveLength(0)
    expect(result.skipped.map((entry) => entry.reason)).toContain(reason)
  })

  test('still compiles an independent static call in the same module', () => {
    const result = createFoldFixture().fold(`
      import { css } from 'styled-system/css'
      export const fixed = css({ color: 'red.300' })
      export const dynamic = (tone) => css({ color: { base: tone } })
    `)

    expect(classes(result)).toHaveLength(1)
    expect(result.code).toContain('export const fixed = "c_red.300"')
    expect(result.code).toContain('css({ color: { base: tone } })')
  })

  test('returns a module with no Bamboo calls untouched', () => {
    const code = `export const value = compute({ color: 'red.300' })\n`
    expect(createFoldFixture().fold(code)).toMatchObject({ code, map: null, folded: [] })
  })
})

describe('config recipe calls', () => {
  test('compiles a static selection to declaration atoms', () => {
    const fixture = createFoldFixture()
    const result = fixture.fold(`
      import { buttonStyle } from 'styled-system/recipes'
      export const cls = buttonStyle({ size: 'sm' })
    `)

    expect(classes(result)).toHaveLength(1)
    expect(classes(result)[0]!.className).toContain('d_inline-flex')
    expect(classes(result)[0]!.className).not.toContain('buttonStyle')
  })

  test('compiles a runtime selection to a finite decision table', () => {
    const code = `import { buttonStyle } from 'styled-system/recipes'\nexport const make = (size) => buttonStyle({ size })\n`
    const result = createFoldFixture().fold(code)
    expect(classes(result)).toHaveLength(1)
    expect(result.code).toContain('cvaMap([size]')
    expect(result.code).not.toContain('buttonStyle({ size })')
    expect(result.skipped).toHaveLength(0)
  })

  test('rejects raw() but compiles a whole slot object to preselected slot atoms', () => {
    const raw = createFoldFixture().fold(
      `import { buttonStyle } from 'styled-system/recipes'\nexport const x = buttonStyle.raw({ size: 'sm' })\n`,
    )
    expect(raw.skipped.map((entry) => entry.reason)).toContain('raw-call')

    const slots = createFoldFixture().fold(
      `import { checkbox } from 'styled-system/recipes'\nexport const x = checkbox({ size: 'sm' })\n`,
    )
    expect(slots.folded).toContainEqual(expect.objectContaining({ kind: 'slots' }))
    expect(slots.code).toContain('"root"')
    expect(slots.code).not.toContain('checkbox({ size:')
  })
})

describe('inline recipe declarations are compile-time only', () => {
  const inline = (body: string) => `
    import { cva } from 'styled-system/css'
    const badge = cva({
      base: { display: 'flex', color: 'red.300' },
      variants: { tone: { quiet: { color: 'gray.500' }, loud: { color: 'red.500' } } },
      defaultVariants: { tone: 'quiet' },
    })
    ${body}
  `

  test('erases the factory and compiles a static call to shared atoms', () => {
    const result = createFoldFixture().fold(inline(`export const cls = badge({ tone: 'loud' })`))
    expect(result.code).toContain('const badge = undefined')
    expect(result.code).not.toContain('cva({')
    expect(classes(result)[0]!.className).toContain('c_red.500')
    expect(classes(result)[0]!.className).not.toContain('cva_')
  })

  test('compiles a runtime axis to the finite decision helper', () => {
    const result = createFoldFixture().fold(inline(`export const cls = (tone) => badge({ tone })`))
    expect(result.code).toContain('cvaMap([tone]')
    expect(result.code).not.toContain('badge({ tone })')
    expect(result.code).not.toContain('cva({')
  })

  test('lowers splitVariantProps without preserving the recipe object', () => {
    const result = createFoldFixture().fold(
      inline(`
        export const Badge = (props) => {
          const [variants, rest] = badge.splitVariantProps(props)
          return badge(variants) + JSON.stringify(rest)
        }
      `),
    )
    expect(result.code).toContain('splitProps(props, ["tone"])')
    expect(result.code).not.toContain('badge.splitVariantProps')
    expect(result.code).not.toContain('cva({')
  })

  test('reports an unenumerable selection and reflective recipe reads', () => {
    const spread = createFoldFixture().foldStrict(inline(`export const cls = (rest) => badge({ ...rest })`))
    expect(spread.skipped.map((entry) => entry.reason)).toContain('recipe-call')

    const reflective = createFoldFixture().foldStrict(inline(`export const config = badge.config`))
    expect(reflective.skipped).toContainEqual(expect.objectContaining({ reason: 'runtime-binding', name: 'badge' }))
  })

  test('erases an exported declaration even when all calls live in consumer modules', () => {
    const result = createFoldFixture().fold(`
      import { cva } from 'styled-system/css'
      export const badge = cva({ base: { display: 'flex' } })
    `)
    expect(result.code).toContain('export const badge = undefined')
    expect(result.folded).toContainEqual(expect.objectContaining({ kind: 'definition', name: 'badge' }))
  })
})

/**
 * `cx()` is the one call that is allowed to survive compilation, because forwarding a
 * `className` prop has no other shape. What it gives up is the guarantee the rest of the
 * compiler provides: arguments Bamboo can read are merged into shared atoms before a string
 * exists, and an argument it cannot read is concatenated after. A declaration set on both
 * sides is then resolved by the cascade instead of by the merge.
 *
 * In practice the foreign class wins that race, because everything Bamboo emits is inside a
 * cascade layer and unlayered CSS outranks layered CSS. Worse is the narrower case underneath
 * it: an opaque class that is itself a Bamboo class, where both sides are in `@layer utilities`
 * and the sublayer order decides instead of argument order. Which of the two arrived is not
 * something the compiler can see — an opaque string is opaque — so `opaque-composition` covers
 * every mix rather than that subset.
 *
 * It separates all of them from a plain `dynamic` skip so `reportSkipped` and the coverage
 * summary can name them. It still passes the build — `strict-compiler.test.ts` pins that — and
 * changes no compiled output.
 */
describe('cx composing an opaque class', () => {
  const fold = (body: string) =>
    createFoldFixture()
      .fold(`import { css, cx } from 'styled-system/css'\n${body}\n`)
      .skipped.filter((entry) => entry.name === 'cx')
      .map((entry) => entry.reason)

  test('reports the mix of compiled atoms and a class the build cannot see', () => {
    expect(fold(`export const f = (rest) => cx(css({ color: 'red.300' }), rest.className)`)).toEqual([
      'opaque-composition',
    ])
  })

  test('reports it when the opaque argument comes first', () => {
    // The argument walk aborts on the first thing it cannot take, so the Bamboo call here was
    // never visited. Reading the mix off the partially populated match list missed this.
    expect(fold(`export const f = (rest) => cx(rest.className, css({ color: 'red.300' }))`)).toEqual([
      'opaque-composition',
    ])
  })

  test('reports it through an array literal', () => {
    expect(fold(`export const f = (rest) => cx([css({ color: 'red.300' }), rest.className])`)).toEqual([
      'opaque-composition',
    ])
  })

  test('stays `dynamic` when nothing in the join was ours', () => {
    // Two opaque classes promise nothing and mislead nobody. Warning here would be noise in
    // every codebase that uses `cx` as a plain class joiner.
    expect(fold(`export const f = (a, b) => cx(a, b)`)).toEqual(['dynamic'])
  })

  test('says nothing when every argument resolved', () => {
    expect(fold(`export const f = cx(css({ color: 'red.300' }), 'external')`)).toEqual([])
  })
})

describe('a config recipe joined with an opaque class', () => {
  test('reports the mix rather than a bare dynamic skip', () => {
    const result = createFoldFixture().fold(`
      import { cx } from 'styled-system/css'
      import { buttonStyle } from 'styled-system/recipes'
      export const f = (props) => cx(buttonStyle({ size: 'sm' }), props.className)
    `)

    expect(result.skipped.filter((entry) => entry.name === 'cx').map((entry) => entry.reason)).toEqual([
      'opaque-composition',
    ])
  })
})

/**
 * Several runtime maps decline the call on their own — one `cx()` cannot reduce to one lookup —
 * and that verdict is reached before the argument walk's result is read. It must not also decide
 * the *reason*, or the classification becomes a fact about argument order: the walk aborts at the
 * first opaque argument, so how many maps it had already taken by then is what changes.
 */
describe('two runtime recipe maps joined with an opaque class', () => {
  const reasons = (body: string) =>
    createFoldFixture()
      .foldStyleSets(
        `import { cva, cx } from 'styled-system/css'
` +
          `const badge = cva({ variants: { tone: { quiet: { color: 'gray.500' }, loud: { color: 'red.500' } } } })
` +
          `const chip = cva({ variants: { size: { sm: { padding: '2' }, md: { padding: '4' } } } })
` +
          `${body}
`,
      )
      .skipped.filter((entry) => entry.name === 'cx')
      .map((entry) => entry.reason)

  test.each([
    ['last', `export const f = (tone, size, props) => cx(badge({ tone }), chip({ size }), props.className)`],
    [
      'between the maps',
      `export const f = (tone, size, props) => cx(badge({ tone }), props.className, chip({ size }))`,
    ],
    ['first', `export const f = (tone, size, props) => cx(props.className, badge({ tone }), chip({ size }))`],
  ])('reports the mix with the opaque argument %s', (_position, body) => {
    expect(reasons(body)).toEqual(['opaque-composition'])
  })

  test('stays `dynamic` when the maps are the only reason it declined', () => {
    // Nothing foreign is in this join. It survives to runtime because two maps cannot be merged,
    // which is what `dynamic` has always meant, and there is no second half to warn about.
    expect(reasons(`export const f = (tone, size) => cx(badge({ tone }), chip({ size }))`)).toEqual(['dynamic'])
  })
})

/**
 * The declined `cx()` covers a range, and that range is what stops the survivor scan reporting a
 * Bamboo binding standing inside it a second time under `runtime-binding` — a reason that *does*
 * fail the build. That suppression is `SURVIVES_TO_RUNTIME` membership and nothing else, so the
 * new reason had to join the set; deleting it there leaves every other test in this package green
 * and turns the build below red.
 */
describe('a binding inside a declined cx', () => {
  const survivors = (body: string) =>
    createFoldFixture()
      .foldStrict(
        `import { css, cx } from 'styled-system/css'
` +
          `import { buttonStyle } from 'styled-system/recipes'
` +
          `${body}
`,
      )
      .skipped.map((entry) => [entry.name, entry.reason])

  test('is not also reported as a runtime binding', () => {
    expect(
      survivors(`export const f = (props) => cx(css({ color: 'red.300' }), buttonStyle, props.className)`),
    ).toEqual([['cx', 'opaque-composition']])
  })

  test('is not reported when the join declines as `dynamic` either', () => {
    expect(survivors(`export const f = (props) => cx(buttonStyle, props.className)`)).toEqual([['cx', 'dynamic']])
  })
})
