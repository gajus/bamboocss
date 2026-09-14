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
