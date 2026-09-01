'use client'

import { useState } from 'react'
import { css, cva } from '../styled-system/css'

const button = cva({
  base: { px: '4', py: '2', borderRadius: 'md', fontWeight: 'semibold', cursor: 'pointer' },
  variants: {
    tone: {
      neutral: { bg: 'gray.200', color: 'gray.900', _hover: { bg: 'gray.300' } },
      accent: { bg: 'blue.600', color: 'white', _hover: { bg: 'blue.700' } },
    },
  },
  defaultVariants: { tone: 'neutral' },
})

/** A client component, reached by every environment: the recipe compiles in each. */
export function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
      <button
        type="button"
        className={button({ tone: count % 2 ? 'accent' : 'neutral' })}
        onClick={() => setCount(count + 1)}
      >
        Clicked {count} times
      </button>
      <span className={css({ color: 'gray.500', fontSize: 'sm' })}>hydrated on the client</span>
    </div>
  )
}
