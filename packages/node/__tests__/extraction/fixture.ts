import type { StyleDecoder, StyleEncoder } from '@bamboocss/core'
import { createContext } from '@bamboocss/fixture'
import type { Config, ResultItem, TSConfig } from '@bamboocss/types'
import type { BambooContext } from '../../src/create-context'
import type { ParserResult } from '../../src/parser-result'

/**
 * The extraction-semantics fixture, ported from the retired TypeScript parser suite.
 *
 * Every helper feeds its source to the native engine the way a build does: the bytes are an
 * in-memory overlay on the context's `SourceProject`, and `ctx.parseFile` extracts them.
 * Nothing is written to disk. A relative path resolves against the fixture's `cwd`.
 */
export const filePath = 'app/src/test.tsx'

export function getFixtureProject(code: string, userConfig?: Config, tsconfig?: TSConfig): BambooContext {
  const ctx = createContext(Object.assign({}, userConfig, { tsconfig }))
  ctx.project.addSourceFile(filePath, code)
  return ctx
}

/**
 * `ctx.parseFile`, failing loudly rather than returning `undefined`.
 *
 * `parseFile` catches an extraction error and records it in `parseFailures`, which is right for
 * a build and wrong for a test: an assertion that something is *absent* would pass against a
 * file that was never read at all.
 */
export function parseFile(ctx: BambooContext, file: string, encoder?: StyleEncoder): ParserResult {
  const result = ctx.parseFile(file, encoder)
  if (!result) {
    const failure = ctx.parseFailures.get(ctx.runtime.path.abs(ctx.config.cwd, file))
    throw failure ?? new Error(`bamboo: no extraction result for ${file}`)
  }
  return result
}

const parse = (ctx: BambooContext, encoder?: StyleEncoder) => parseFile(ctx, filePath, encoder)

/**
 * An item as a snapshot reads it: what was called and with what, without the call-site
 * position (`atomOrigin`) or the token callee range, which only the fold and source maps read.
 */
const toItem = ({ atomOrigin: _atomOrigin, tokenCalleeRange: _tokenCalleeRange, ...item }: ResultItem) => item
const toItems = (items: Iterable<ResultItem>) => new Set([...items].map(toItem))
const toItemMap = (map: Map<string, Set<ResultItem>>) =>
  new Map([...map].map(([name, items]) => [name, toItems(items)]))

export function cssParser(code: string) {
  const data = parse(getFixtureProject(code))
  return {
    css: toItems(data.css),
  }
}

/**
 * `token()` and `token.value()` entries, which share one set and are told apart by `type`.
 * Separate from `cssParser` because a standalone token call produces no `css` entry at all.
 */
export function tokenParser(code: string) {
  return toItems(parse(getFixtureProject(code)).token)
}

export function cvaParser(code: string) {
  const data = parse(getFixtureProject(code))
  return {
    cva: toItems(data.cva),
  }
}

export function svaParser(code: string) {
  const data = parse(getFixtureProject(code))
  return {
    sva: toItems(data.sva),
  }
}

export function recipeParser(code: string) {
  return toItemMap(parse(getFixtureProject(code)).recipe)
}

export function patternParser(code: string) {
  const ctx = getFixtureProject(code, {
    patterns: {
      extend: {
        stack: {
          properties: {
            align: { type: 'property', value: 'alignItems' },
            justify: { type: 'property', value: 'justifyContent' },
            direction: { type: 'property', value: 'flexDirection' },
            gap: { type: 'property', value: 'gap' },
          },
          transform(props: any) {
            const { align = 'flex-start', justify, direction = 'column', gap = '10px', ...rest } = props
            return {
              display: 'flex',
              flexDirection: direction,
              alignItems: align,
              justifyContent: justify,
              gap,
              ...rest,
            }
          },
        },
      },
    },
  })
  return toItemMap(parse(ctx).pattern)
}

export function jsxRecipeParser(code: string) {
  const ctx = getFixtureProject(code, {
    theme: {
      extend: {
        recipes: {
          button: {
            className: 'button',
            jsx: ['Button', /WithRegex$/],
            description: 'A button styles',
            base: { fontSize: 'lg' },
            variants: {
              size: {
                sm: { padding: '2', borderRadius: 'sm' },
                md: { padding: '4', borderRadius: 'md' },
              },
              variant: {
                primary: { color: 'white', backgroundColor: 'blue.500' },
                danger: { color: 'white', backgroundColor: 'red.500' },
                secondary: { color: 'pink.300', backgroundColor: 'green.500' },
              },
            },
          },
        },
      },
    },
  })
  return toItemMap(parse(ctx).recipe)
}

interface ParseAndExtractReturn {
  ctx: BambooContext
  encoder: StyleEncoder
  styles: StyleDecoder
  json: any[]
  css: string
  /** The raw result, for assertions about what the parser saw rather than what it emitted. */
  parserResult: ParserResult
}

const toJson = (result: ParserResult) => result.toArray().map(toItem)

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
        )
      : value

/** Items as a sorted list of canonical strings: what was extracted, regardless of order. */
export const itemSet = (items: unknown[]) => items.map((item) => JSON.stringify(sortKeys(item))).sort()

export const parseAndExtract = (code: string, userConfig?: Config, tsconfig?: TSConfig): ParseAndExtractReturn => {
  const ctx = getFixtureProject(code, userConfig, tsconfig)
  const encoder = ctx.encoder.clone()
  const result = parse(ctx, encoder)
  const styles = ctx.decoder.clone().collect(encoder)

  return {
    ctx,
    encoder,
    styles,
    json: toJson(result),
    css: ctx.getParserCss(styles),
    parserResult: result,
  }
}
