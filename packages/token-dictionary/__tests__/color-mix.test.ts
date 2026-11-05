import { expect, test } from 'vitest'
import { TokenDictionary } from '../src/dictionary'

test('color-mix', () => {
  const dictionary = new TokenDictionary({
    tokens: {
      colors: {
        pink: { value: '#ff00ff' },
        border: { value: 'token(colors.pink/30)' },
        ref: { value: 'token(colors.border/40)' },
      },
      opacity: {
        half: { value: 0.5 },
      },
    },
  })

  dictionary.init()

  expect(dictionary.expandReferenceInValue('token(colors.pink/30)')).toMatchInlineSnapshot(
    `"color-mix(in srgb, var(--colors-pink) 30%, transparent)"`,
  )
  expect(dictionary.expandReferenceInValue('token(colors.border/40)')).toMatchInlineSnapshot(
    `"color-mix(in srgb, var(--colors-border) 40%, transparent)"`,
  )
  expect(dictionary.expandReferenceInValue('token(colors.border/half)')).toMatchInlineSnapshot(
    `"color-mix(in srgb, var(--colors-border) 50%, transparent)"`,
  )

  expect(dictionary.view.vars).toMatchInlineSnapshot(`
    Map {
      "base" => Map {
        "--colors-pink" => "#ff00ff",
        "--colors-border" => "color-mix(in srgb, var(--colors-pink) 30%, transparent)",
        "--colors-ref" => "color-mix(in srgb, var(--colors-border) 40%, transparent)",
        "--opacity-half" => 0.5,
      },
    }
  `)
})

test('an opacity token becomes an exact percentage, without float noise', () => {
  const dictionary = new TokenDictionary({
    tokens: {
      colors: { pink: { value: '#ff00ff' } },
      // Each of these multiplies to a non-integer in binary floating point.
      opacity: { a: { value: 0.07 }, b: { value: 0.29 }, c: { value: '0.57' }, d: { value: 0.125 } },
    },
  })

  dictionary.init()

  expect(['a', 'b', 'c', 'd'].map((o) => dictionary.expandReferenceInValue(`token(colors.pink/${o})`)))
    .toMatchInlineSnapshot(`
    [
      "color-mix(in srgb, var(--colors-pink) 7%, transparent)",
      "color-mix(in srgb, var(--colors-pink) 29%, transparent)",
      "color-mix(in srgb, var(--colors-pink) 57%, transparent)",
      "color-mix(in srgb, var(--colors-pink) 12.5%, transparent)",
    ]
  `)
})

test('color-mix with semanticTokens', () => {
  const dictionary = new TokenDictionary({
    tokens: {
      colors: {
        black: { value: 'black' },
        white: { value: 'white' },
      },
    },
    semanticTokens: {
      colors: {
        fg: {
          default: {
            value: { base: 'token(colors.black/87)', _dark: 'token(colors.white)' },
          },
        },
      },
    },
  })

  dictionary.init()

  expect(dictionary.expandReferenceInValue('token(colors.black/87)')).toMatchInlineSnapshot(
    `"color-mix(in srgb, var(--colors-black) 87%, transparent)"`,
  )

  expect(dictionary.view.vars).toMatchInlineSnapshot(`
    Map {
      "base" => Map {
        "--colors-black" => "black",
        "--colors-white" => "white",
        "--colors-fg-default" => "color-mix(in srgb, var(--colors-black) 87%, transparent)",
      },
      "_dark" => Map {
        "--colors-fg-default" => "var(--colors-white)",
      },
    }
  `)
})

test('a slash outside a reference does not make that reference a color mix', () => {
  const dictionary = new TokenDictionary({
    tokens: {
      colors: {
        red: { value: '#f00' },
        overlay: { value: 'rgb(from token(colors.red) r g b / 50%)' },
      },
    },
  })

  dictionary.init()

  expect(dictionary.view.vars.get('base')?.get('--colors-overlay')).toBe('rgb(from var(--colors-red) r g b / 50%)')
})

test('only the references carrying a modifier are mixed', () => {
  const dictionary = new TokenDictionary({
    tokens: {
      colors: {
        red: { value: '#f00' },
      },
      shadows: {
        ring: { value: '0 0 0 1px token(colors.bg), 0 0 0 3px token(colors.red/50)' },
      },
    },
    semanticTokens: {
      colors: {
        bg: { value: { base: 'white', _dark: 'black' } },
      },
    },
  })

  dictionary.init()

  expect(dictionary.view.vars.get('base')?.get('--shadows-ring')).toBe(
    '0 0 0 1px var(--colors-bg), 0 0 0 3px color-mix(in srgb, var(--colors-red) 50%, transparent)',
  )
})

/**
 * A colour written out inside `token()` stands for itself, and given an opacity is mixed as a
 * token's colour is. `token(#000/64)` already was; `token(rgb(0 0 0)/64)` was left in the css as
 * written, since its parentheses kept it from reading as a reference, and `token(#000)` in a token's
 * value became `var(--\#000)`, a variable nothing declares.
 */
test('color-mix of a colour written out', () => {
  const values = {
    hex: '0 0 0 1px token(#000/64)',
    hexAlone: '0 0 0 1px token(#000)',
    functional: '0 0 0 1px token(rgb(0 0 0)/64)',
    functionalAlone: '0 0 0 1px token(rgb(0 0 0))',
    // The colour's own slash is inside its parentheses, and the opacity's outside them.
    functionalWithAlpha: '0 0 0 1px token(rgb(0 0 0 / 50%)/64)',
    beside: 'token(colors.pink/30) token(oklch(0.5 0.1 200)/50)',
  }
  const dictionary = new TokenDictionary({
    tokens: { colors: { pink: { value: '#ff00ff' } } },
    semanticTokens: {
      shadows: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }])),
    },
  })
  dictionary.init()

  const resolved = Object.fromEntries(
    Object.keys(values).map((name) => [name, dictionary.getByName(`shadows.${name}`)?.value]),
  )
  expect(resolved).toMatchInlineSnapshot(`
    {
      "beside": "color-mix(in srgb, var(--colors-pink) 30%, transparent) color-mix(in srgb, oklch(0.5 0.1 200) 50%, transparent)",
      "functional": "0 0 0 1px color-mix(in srgb, rgb(0 0 0) 64%, transparent)",
      "functionalAlone": "0 0 0 1px rgb(0 0 0)",
      "functionalWithAlpha": "0 0 0 1px color-mix(in srgb, rgb(0 0 0 / 50%) 64%, transparent)",
      "hex": "0 0 0 1px color-mix(in srgb, #000 64%, transparent)",
      "hexAlone": "0 0 0 1px #000",
    }
  `)

  // In a style value, as the build expands one, and none of them a token that is missing.
  for (const value of Object.values(values)) {
    expect(dictionary.expandReferenceInValue(value), value).not.toContain('token(')
    expect(dictionary.unresolvedReferences(value), value).toEqual([])
  }
  expect(dictionary.unresolvedReferences('token(colors.nope/50)')).toEqual(['colors.nope/50'])
})

// Out of `color-mix()`'s 0% to 100%, in a token's value as in a style: an invalid mix there fails the
// build, as `token(colors.pink/unknown)` already did.
test('color-mix with an opacity outside 0 to 100', () => {
  const dictionary = new TokenDictionary({ tokens: { colors: { pink: { value: '#ff00ff' } } } })
  dictionary.init()

  expect(() => dictionary.expandReferenceInValue('token(colors.pink/150)')).toThrow(
    'Invalid color mix at colors.pink/150',
  )
  expect(dictionary.expandReferenceInValue('token(colors.pink/100)')).toBe(
    'color-mix(in srgb, var(--colors-pink) 100%, transparent)',
  )
})
