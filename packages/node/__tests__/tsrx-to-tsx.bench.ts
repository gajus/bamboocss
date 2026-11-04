import { bench, describe } from 'vitest'
import { loadNativeExtractor } from '../src/native-extractor'
import { tsrxToTsx } from '@bamboocss/plugin-tsrx'

/**
 * `tsrxToTsx` on a representative component: the `@tsrx/core` parse plus the text-edit lowering a
 * `parser:before` pass runs once per `.tsrx` file it reads.
 *
 * The control reads the same component as the equivalent TSX through the native `analyze`, so the
 * number carries the whole cost the hook adds over a file that needed no lowering.
 *
 * Files that are not `.tsrx` never reach it: the hook is one `endsWith` per file in the chain.
 */
const COMPONENT = `import { css } from './styled-system/css'
import { stack } from './styled-system/patterns'

const tone = css({ color: 'primary' })

export function Card(props: { items: string[]; tone: string; on?: boolean }) @{
  const label = css({ color: 'primary' })
  const items = props.items
  const Tag = props.as ?? 'section'
  if (props.on === false) return null
  <div className={css({ padding: '4', borderRadius: 'lg' })}>
    <h2 className={label}>Items</h2>
    @for (const item of items; index i; key item) {
      <span className={css({ color: i % 2 ? 'accent' : 'primary' })}>{item}</span>
    } @empty {
      <p className={css({ color: 'muted' })}>Nothing here</p>
    }
    @if (props.tone === 'warn') {
      <b className={css({ color: 'yellow.300' })} />
    } @else {
      <b className={css({ color: 'green.300' })} />
    }
    @switch (props.tone) {
      @case 'a': {
        <i className={css({ color: 'red.100' })} />
      }
      @default: {
        <i className={css({ color: 'red.200' })} />
      }
    }
    @try {
      <u className={css({ color: 'red.400' })} />
    } @pending {
      <u className={css({ color: 'red.500' })} />
    } @catch (error, reset) {
      <u className={css({ color: 'red.600' })}>{String(error)}</u>
    }
    <{Tag} {tone}>
      <em className={css({ color: 'red.700' })} />
    </{Tag}>
  </div>
}

export const footer = <footer className={stack({ gap: '2' })}>@{ <span>{'end'}</span> }</footer>
`

// The same file without the TSRX-only syntax, which is what the lowering makes of it.
const AS_TSX = `import { css } from './styled-system/css'
import { stack } from './styled-system/patterns'

const tone = css({ color: 'primary' })

export function Card(props: { items: string[]; tone: string; on?: boolean }) {
  const label = css({ color: 'primary' })
  const items = props.items
  const Tag = props.as ?? 'section'
  if (props.on === false) return null
  return <div className={css({ padding: '4', borderRadius: 'lg' })} />
}

export const footer = <footer className={stack({ gap: '2' })} />
`

const native = loadNativeExtractor()
if (tsrxToTsx(COMPONENT, 'Card.tsrx') === undefined) throw new Error('@tsrx/core is not installed')

describe('tsrx to tsx', () => {
  bench('~80-line component through parseModule and the lowering', () => void tsrxToTsx(COMPONENT, 'Card.tsrx'), {
    warmupIterations: 200,
    time: 1000,
  })

  bench(
    'the same component as TSX through native analyze (control)',
    () => void native.analyze('Card.tsx', AS_TSX, []),
    {
      warmupIterations: 200,
      time: 1000,
    },
  )
})
