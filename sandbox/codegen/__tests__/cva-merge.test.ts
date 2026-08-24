import { describe, expect, test } from 'vitest'
import { cva } from '../styled-system/css/cva'

interface Merged {
  (props?: Record<string, unknown>): string
  getVariantProps: () => Record<string, unknown>
  merge: (other: unknown) => Merged
}

describe('cva().merge()', () => {
  const a = cva({
    base: { color: 'red' },
    className: 'A',
    defaultVariants: { size: 'sm' },
    variants: { size: { lg: { padding: '9' }, sm: { padding: '1' } } },
  } as never)
  const b = cva({
    base: { background: 'blue' },
    className: 'B',
    defaultVariants: { tone: 'x' },
    variants: { tone: { x: { margin: '1' } } },
  } as never)

  test('refuses to resolve composed class strings at runtime', () => {
    const merged = (a as never as { merge: (o: unknown) => Merged }).merge(b)
    expect(() => merged()).toThrow('was not compiled')
  })
})
