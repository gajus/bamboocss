import { describe, it, expect } from 'vitest'
import { createContext } from '@bamboocss/fixture'
import { Reporter } from '../src'

const ctx = createContext({
  theme: {
    tokens: {
      colors: {
        red: { 200: { value: 'red' } },
        green: { 200: { value: 'green' } },
        blue: { 200: { value: 'blue' } },
        yellow: { 200: { value: 'yellow' } },
        custom: { value: 'custom' },
      },
      fontSizes: { lg: { value: '12px' } },
      spacing: { 1: { value: '10px' }, 2: { value: '20px' } },
    },
  },
})

const tokenReport = (code: string) => {
  ctx.project.addSourceFile('code.tsx', code)
  const reporter = new Reporter(ctx, {
    parserOptions: ctx.parserOptions,
    parseFile: (file) => ctx.parseFile(file),
    prepare: (files) => ctx.prepareNativeExtraction(files),
    getRelativePath: ctx.runtime.path.relative,
    getFiles: () => ['code.tsx'],
  })

  reporter.init()

  const report = reporter.getTokenReport()
  return report.getSummary()
}

describe('reporter', () => {
  it('tokens / v1', () => {
    const code = `
    import {css} from "styled-system/css"

    const baseStyle = css({
        color: 'red.200',
        fontSize: '12px',
        bg: 'red.200',
    })
    `
    expect(tokenReport(code)).toMatchInlineSnapshot(`
      [
        {
          "category": "fontSizes",
          "count": 1,
          "hardcoded": 7,
          "mostUsedNames": [
            "lg",
          ],
          "percentUsed": 100,
          "usedCount": 1,
          "usedInXFiles": 1,
        },
        {
          "category": "spacing",
          "count": 6,
          "hardcoded": 3,
          "mostUsedNames": [
            "2",
          ],
          "percentUsed": 16.67,
          "usedCount": 1,
          "usedInXFiles": 0,
        },
        {
          "category": "colors",
          "count": 19,
          "hardcoded": 9,
          "mostUsedNames": [
            "red.200",
          ],
          "percentUsed": 5.26,
          "usedCount": 1,
          "usedInXFiles": 1,
        },
        {
          "category": "sizes",
          "count": 5,
          "hardcoded": 5,
          "mostUsedNames": [],
          "percentUsed": 0,
          "usedCount": 0,
          "usedInXFiles": 0,
        },
      ]
    `)
  })

  /**
   * A value nested under a condition in a config recipe is a use like any other.
   *
   * The report used to walk config recipes and global css through boxes that stopped one
   * level down, so `_hover: { color: 'darkblue' }` in a recipe was never counted, while the
   * same shape at a call site was. The walk is over plain objects now, at every depth.
   */
  it('counts values nested under conditions in config recipes', () => {
    const nested = createContext({
      theme: {
        tokens: { colors: { brand: { value: 'blue' } } },
        extend: {
          recipes: {
            probe: {
              className: 'probe',
              base: { _hover: { color: 'brand' }, '&[data-x]': { background: 'hotpink' } },
            },
          },
        },
      },
    })
    const reporter = new Reporter(nested, {
      parserOptions: nested.parserOptions,
      parseFile: (file) => nested.parseFile(file),
      prepare: (files) => nested.prepareNativeExtraction(files),
      getRelativePath: nested.runtime.path.relative,
      getFiles: () => [],
    })
    reporter.init()

    const colors = reporter.getTokenReport().usageMap.get('colors') ?? []
    const probe = colors.filter((usage) => usage.filePath === '@config/theme/recipes/probe')

    expect(probe.map((usage) => [usage.value, usage.type])).toEqual([
      ['brand', 'token'],
      ['hotpink', 'nonToken'],
    ])
  })
})
