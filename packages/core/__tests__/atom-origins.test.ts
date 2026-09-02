import { createGeneratorContext } from '@bamboocss/fixture'
import { describe, expect, test } from 'vitest'

/**
 * Where an atom was first written, for a source map to point DevTools at.
 *
 * Recorded through the owner scopes `withOwner` keeps per file, so a file's re-parse replaces
 * its own entries and nothing else's, and read back in path order so the answer does not
 * depend on the order files happened to be extracted in.
 */
describe('atom origins', () => {
  const styles = { color: 'red.200' }
  const at = (filePath: string, line: number) => ({ filePath, line, column: 1 })

  const encoderOf = () => {
    const encoder = createGeneratorContext().encoder.clone()
    encoder.recordOrigins = true
    return encoder
  }

  const hashOf = (encoder: ReturnType<typeof encoderOf>) => {
    const [hash] = encoder.atomic
    return hash!
  }

  test('records nothing unless asked to', () => {
    const encoder = createGeneratorContext().encoder.clone()
    encoder.withOwner('extract', '/app/a.tsx', () => {
      encoder.withOrigin(at('/app/a.tsx', 3), () => encoder.processAtomic(styles))
    })

    expect(encoder.atomic.size).toBe(1)
    expect(encoder.atomOrigins().size).toBe(0)
  })

  test('keeps the first call site of a file, and the first file in path order', () => {
    const encoder = encoderOf()
    // Read in reverse path order, on purpose.
    encoder.withOwner('extract', '/app/b.tsx', () => {
      encoder.withOrigin(at('/app/b.tsx', 8), () => encoder.processAtomic(styles))
      encoder.withOrigin(at('/app/b.tsx', 12), () => encoder.processAtomic(styles))
    })
    encoder.withOwner('extract', '/app/a.tsx', () => {
      encoder.withOrigin(at('/app/a.tsx', 20), () => encoder.processAtomic(styles))
    })

    expect(encoder.atomOrigins().get(hashOf(encoder))).toEqual(at('/app/a.tsx', 20))
  })

  test("a file's re-parse replaces its own entries", () => {
    const encoder = encoderOf()
    encoder.withOwner('extract', '/app/a.tsx', () => {
      encoder.withOrigin(at('/app/a.tsx', 3), () => encoder.processAtomic(styles))
    })
    encoder.withOwner('extract', '/app/a.tsx', () => {
      encoder.withOrigin(at('/app/a.tsx', 9), () => encoder.processAtomic(styles))
    })

    expect(encoder.atomOrigins().get(hashOf(encoder))).toEqual(at('/app/a.tsx', 9))
  })

  test('a bundler transform reading a module is not an origin', () => {
    const encoder = encoderOf()
    encoder.withOwner('parse', '/app/a.tsx', () => {
      encoder.withOrigin(at('/app/a.tsx', 3), () => encoder.processAtomic(styles))
    })

    expect(encoder.atomic.size).toBe(1)
    expect(encoder.atomOrigins().size).toBe(0)
  })

  test('a nested scope hands its origins to the owner', () => {
    const encoder = encoderOf()
    encoder.withOwner('extract', '/app/a.tsx', () => {
      encoder.withScope(() => {
        encoder.withOrigin(at('/app/a.tsx', 5), () => encoder.processAtomic(styles))
      })
    })

    expect(encoder.atomOrigins().get(hashOf(encoder))).toEqual(at('/app/a.tsx', 5))
  })
})
