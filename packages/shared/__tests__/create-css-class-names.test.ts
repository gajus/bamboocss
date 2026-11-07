import { describe, expect, test } from 'vitest'
import { atomKey, atomKeyCode } from '../src/atom-name'
import { createCss } from '../src/classname'
import { mergeDeclarationValue } from '../src/merge-declarations'

const makeContext = (over: { prefix?: string; hash?: boolean } = {}) => ({
  hash: over.hash ?? false,
  utility: {
    prefix: over.prefix ?? '',
    hasShorthand: false,
    resolveShorthand: (p: string) => p,
    transform: (prop: string, value: any) => ({ className: `${prop}_${value}` }),
  },
  conditions: {
    breakpoints: { keys: ['base', 'md'] },
    // What the generated `sortConditions` does: move the conditions behind the property, and
    // sort in place, which is why each leaf needs its own path array.
    shift: (paths: string[]) =>
      paths.sort((a, b) => {
        const aa = isCondition(a)
        const bb = isCondition(b)
        if (aa && !bb) return 1
        if (!aa && bb) return -1
        return 0
      }),
    finalize: (v: string[]) => v.map((c) => c.replace(/^_/, '')),
  },
})

const isCondition = (value: string) => value.startsWith('_') || value === 'base' || value === 'md'

/** The name of an atom setting `property` under `conditions`: its merge code, then `readable`. */
const named = (conditions: string[], property: string, readable: string) =>
  `_${atomKeyCode(atomKey(conditions, property))}:${readable}`

/**
 * The class name is assembled from a prefix, the merge code, the conditions and the utility class,
 * and each piece but the code is optional. Most configs set no prefix and most leaves carry no condition, so those
 * are the paths that skip the assembly — and therefore the ones that have to agree with it.
 */
describe('createCss class name assembly', () => {
  test('no prefix and no condition is the merge code and the utility class', () => {
    expect(createCss(makeContext())({ color: 'red' })).toBe(named([], 'color', 'color_red'))
  })

  test('a prefix is joined with a dash', () => {
    expect(createCss(makeContext({ prefix: 'bam' }))({ color: 'red' })).toBe(`bam-${named([], 'color', 'color_red')}`)
  })

  test('conditions are joined with colons after the merge code, and the prefix comes first', () => {
    expect(createCss(makeContext())({ _hover: { color: 'red' } })).toBe(named(['hover'], 'color', 'hover:color_red'))
    expect(createCss(makeContext({ prefix: 'bam' }))({ _hover: { color: 'red' } })).toBe(
      `bam-${named(['hover'], 'color', 'hover:color_red')}`,
    )
  })

  test('several conditions keep their order', () => {
    expect(createCss(makeContext())({ _hover: { _focus: { color: 'red' } } })).toBe(
      named(['hover', 'focus'], 'color', 'hover:focus:color_red'),
    )
  })

  test('a base condition is dropped before assembly', () => {
    expect(createCss(makeContext())({ color: { base: 'red' } })).toBe(named([], 'color', 'color_red'))
  })

  test('hashing folds the conditions and the value into five characters after the code, and the prefix stays outside', () => {
    const plain = createCss(makeContext({ hash: true }))({ _hover: { color: 'red' } })
    const prefixed = createCss(makeContext({ hash: true, prefix: 'bam' }))({ _hover: { color: 'red' } })

    expect(plain).toMatch(new RegExp(`^_${atomKeyCode(atomKey(['hover'], 'color'))}:[\\w-]{5}$`))
    expect(prefixed).toBe(`bam-${plain}`)
  })

  test('an important value keeps its marker after assembly', () => {
    expect(createCss(makeContext({ prefix: 'bam' }))({ color: 'red !important' })).toBe(
      `bam-${named([], 'color', 'color_red')}!`,
    )
    expect(createCss(makeContext())({ _hover: { color: 'red !important' } })).toBe(
      `${named(['hover'], 'color', 'hover:color_red')}!`,
    )
  })

  test('an empty utility class collapses to the prefix alone', () => {
    const context = makeContext({ prefix: 'bam' })
    context.utility.transform = () => ({ className: '' })

    expect(createCss(context)({ color: 'red' })).toBe('bam')
  })

  test('an empty utility class with no prefix is empty', () => {
    const context = makeContext()
    context.utility.transform = () => ({ className: '' })

    expect(createCss(context)({ color: 'red' })).toBe('')
  })
})

describe('createCss top-level base', () => {
  test('merges into the styles, so a condition block written in both keeps every declaration', () => {
    expect(createCss(makeContext())({ _hover: { color: 'red' }, base: { _hover: { bg: 'blue' } } })).toBe(
      `${named(['hover'], 'color', 'hover:color_red')} ${named(['hover'], 'bg', 'hover:bg_blue')}`,
    )
  })

  test('still overrides a declaration it repeats', () => {
    expect(createCss(makeContext())({ color: 'red', base: { color: 'blue' } })).toBe(named([], 'color', 'color_blue'))
  })
})

/** The engine the Vite compiler names a call's classes with, which normalizes the same way. */
describe('createCss with a shorthand and its longhand', () => {
  test('names the earlier important value', () => {
    const context = {
      ...makeContext(),
      utility: {
        ...makeContext().utility,
        hasShorthand: true,
        resolveShorthand: (prop: string) => (prop === 'bg' ? 'background' : prop),
        mergeDeclarationValue,
      },
    }

    expect(createCss(context)({ bg: 'red !important', background: 'blue' })).toBe(
      `${named([], 'background', 'background_red')}!`,
    )
  })
})
