import { bench, describe } from 'vitest'
import { importsSourceModule, namesEntrypoint } from '../src/plugin'

/**
 * The transform's test of whether a module reaches bamboo at all, asked of every module before
 * it is parsed: a module naming no entrypoint and importing nothing the project holds is skipped.
 *
 * Measured on modules that import only packages, which is where the test reads the whole text and
 * answers no, and so where it costs the most: every specifier is resolved against the inventory,
 * none is in it. In the second set, a comment wraps after "from" and `Array.from(` takes one before
 * its argument, so the scan reads past a comment twice a module and finds no specifier; in real
 * code that is a file in fifty or fewer. The control is the entrypoint test over the same text, a
 * substring search the import scan does not touch.
 */
const MODULES = 1000

const moduleText = (index: number, commented: boolean) => `/**
 * Component ${index}, rendered from the list below. Its props come from
 * the route loader, which is imported from the router package.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { format } from 'date-fns'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import * as Dialog from '@radix-ui/react-dialog'

${commented ? '// The schema is derived from\n// the API' : '// The schema follows the API'}'s own, so a field renamed there fails here first.
const schema = z.object({ id: z.string(), title: z.string(), at: z.string() })

export const item${index} = (input: unknown, children: ReactNode) => {
  const [open, setOpen] = useState(false)
  const parsed = useMemo(() => schema.parse(input), [input])
  const rows = Array.from(${commented ? '\n    // One row per letter, as the design asks.\n   ' : ''} parsed.title)
  const label = clsx('item', open && 'item-open', \`item-\${parsed.id}\`)
  return { open, setOpen, rows, label, when: format(new Date(parsed.at), 'PP'), children, Dialog, readFileSync }
}
`

const plain = Array.from({ length: MODULES }, (_, index) => moduleText(index, false))
const commented = Array.from({ length: MODULES }, (_, index) => moduleText(index, true))
const resolution = {
  isSourceModule: () => false,
  resolveAlias: () => undefined,
  baseUrl: '/repo/src',
  isSourcePackage: () => false,
}
const ctx = {
  imports: { outdir: 'styled-system', value: { css: ['styled-system/css'], recipe: [], pattern: [], tokens: [] } },
}
const options = { time: 1000, warmupIterations: 10 }

describe(`a module that reaches nothing bamboo x${MODULES}`, () => {
  bench(
    'control: the entrypoint test',
    () => {
      for (let index = 0; index < MODULES; index++) {
        if (namesEntrypoint(ctx, plain[index]!)) throw new Error('a module names an entrypoint')
      }
    },
    options,
  )

  for (const [label, texts] of [
    ['importsSourceModule', plain],
    ['importsSourceModule, a comment after a keyword twice a module', commented],
  ] as const) {
    bench(
      label,
      () => {
        for (let index = 0; index < MODULES; index++) {
          if (importsSourceModule(resolution, `/repo/src/item-${index}.tsx`, texts[index]!)) {
            throw new Error('a module reaches the inventory')
          }
        }
      },
      options,
    )
  }
})
