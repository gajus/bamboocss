import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { describe, expect, test } from 'vitest'
import { cssSourceMap } from '../src/css-output-module'

/** The sheet as a dev server serves it: pruned of nothing, prettified, one rule per line. */
const css = `@layer reset, base, tokens, utilities;
@layer utilities {
  @layer s010-c0-p3000 {
    .c_red\\.200 {
      color: var(--colors-red-200);
    }
    .p_2,
    .m_2 {
      padding: var(--spacing-2);
    }
  }
  @layer s010-c2-p3000 {
    @media (width >= 48rem) {
      .md\\:c_blue\\.500 {
        color: blue;
      }
    }
  }
}
:root {
  --made-with-bamboo: 🌱;
}
`

const a = '/app/src/a.tsx'
const b = '/app/src/b.tsx'

const origins = new Map([
  // Escaped, as the decoder may spell a class; the map keys on the escape-free name.
  ['c_red\\.200', { filePath: a, line: 3, column: 22 }],
  ['p_2', { filePath: a, line: 5, column: 22 }],
  ['m_2', { filePath: b, line: 9, column: 20 }],
  ['md:c_blue.500', { filePath: b, line: 2, column: 20 }],
])

/** Generated position of the first `needle` in `css`: 1-based line, 0-based column. */
const positionOf = (needle: string) => {
  const index = css.indexOf(needle)
  const before = css.slice(0, index)
  return { line: before.split('\n').length, column: index - before.lastIndexOf('\n') - 1 }
}

describe("the served stylesheet's source map", () => {
  test('maps each rule to the call site of its atom', () => {
    const map = cssSourceMap(css, origins)!
    expect(map).toBeDefined()
    const tracer = new TraceMap(map as never)

    expect(originalPositionFor(tracer, positionOf('.c_red'))).toMatchObject({ source: a, line: 3, column: 21 })
    expect(originalPositionFor(tracer, positionOf('.md\\:c_blue'))).toMatchObject({ source: b, line: 2, column: 19 })
  })

  test('a merged rule maps each of its selectors to their own call sites', () => {
    const tracer = new TraceMap(cssSourceMap(css, origins) as never)

    expect(originalPositionFor(tracer, positionOf('.p_2'))).toMatchObject({ source: a, line: 5, column: 21 })
    expect(originalPositionFor(tracer, positionOf('.m_2'))).toMatchObject({ source: b, line: 9, column: 19 })
  })

  test('leaves the sources for Vite to read, and names nothing else', () => {
    const map = cssSourceMap(css, origins)!

    expect(map.sources).toEqual([a, b])
    expect(map.sourcesContent).toBeUndefined()
    expect(map.names).toEqual([])
  })

  test('is nothing when no rule has an origin', () => {
    expect(cssSourceMap(css, new Map())).toBeUndefined()
    expect(cssSourceMap(css, new Map([['unknown', { filePath: a, line: 1, column: 1 }]]))).toBeUndefined()
  })

  test('a selector list inside a function is not split on its commas', () => {
    const sheet = `.p_2:is(:hover, :focus),\n.m_2 {\n  padding: 0;\n}\n`
    const tracer = new TraceMap(cssSourceMap(sheet, origins) as never)

    expect(originalPositionFor(tracer, { line: 1, column: 0 })).toMatchObject({ source: a, line: 5 })
    expect(originalPositionFor(tracer, { line: 2, column: 0 })).toMatchObject({ source: b, line: 9 })
  })
})
