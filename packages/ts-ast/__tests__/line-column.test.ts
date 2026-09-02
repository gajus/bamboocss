import { describe, expect, test } from 'vitest'
import { getLineAndColumnAtPos } from '../src/node'
import type { SourceFile } from '../src/types'

/** The reference implementation: slice to the offset, count the breaks. */
const reference = (text: string, pos: number) => {
  const upto = text.slice(0, pos)
  const lastBreak = upto.lastIndexOf('\n')
  return { line: upto.split('\n').length, column: pos - lastBreak }
}

const fileOf = (text: string) => ({ text }) as unknown as SourceFile

describe('getLineAndColumnAtPos', () => {
  const text = 'const a = 1\n\nconst b = css({\n  color: "red",\n})\n'

  test('agrees with slicing and counting at every offset', () => {
    const file = fileOf(text)
    for (let pos = 0; pos <= text.length; pos++) {
      expect(getLineAndColumnAtPos(file, pos), `offset ${pos}`).toEqual(reference(text, pos))
    }
  })

  test('is 1-based, and a line break belongs to the line it ends', () => {
    const file = fileOf(text)
    expect(getLineAndColumnAtPos(file, 0)).toEqual({ line: 1, column: 1 })
    expect(getLineAndColumnAtPos(file, text.indexOf('\n'))).toEqual({ line: 1, column: 12 })
    expect(getLineAndColumnAtPos(file, text.indexOf('css'))).toEqual({ line: 3, column: 11 })
  })

  test('re-reads a file object whose text changed', () => {
    const file = { text: 'a\nb' } as { text: string }
    expect(getLineAndColumnAtPos(file as unknown as SourceFile, 2)).toEqual({ line: 2, column: 1 })
    file.text = 'ab\nc'
    expect(getLineAndColumnAtPos(file as unknown as SourceFile, 2)).toEqual({ line: 1, column: 3 })
  })
})
