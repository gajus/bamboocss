import { expect, test } from 'vitest'
import { TokenDictionary } from '../src/dictionary'

// A number is as valid a semantic token value as it is a plain one, but only strings and composite
// values were wrapped as `{ base }`. A bare number was then read as a map of conditions, and a base
// of `0` was dropped as falsy, so neither variable was declared.
test('numeric semantic token values are declared', () => {
  const dictionary = new TokenDictionary({
    semanticTokens: {
      opacity: {
        overlay: { value: { base: 0, _open: 1 } },
      },
      zIndex: {
        layer: { value: 10 },
      },
    },
  })

  dictionary.init()

  expect(dictionary.view.vars.get('base')?.get('--opacity-overlay')).toBe(0)
  expect(dictionary.view.vars.get('base')?.get('--z-index-layer')).toBe(10)
  expect(dictionary.view.vars.get('_open')?.get('--opacity-overlay')).toBe(1)
})
