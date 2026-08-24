import { describe, expect, test } from 'vitest'
import { viewTransition } from '../styled-system/css'

describe('viewTransition', () => {
  test('refuses to resolve a class string at runtime', () => {
    expect(() =>
      viewTransition({
        group: { animationDuration: '0.4s', animationTimingFunction: 'ease-in-out' },
        imagePair: { isolation: 'isolate' },
        old: { animationName: 'fade-out' },
        new: { animationName: 'fade-in' },
      }),
    ).toThrow('was not compiled')
  })
})
