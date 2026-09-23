/* eslint-disable no-constant-binary-expression -- false guards keep the reads type-checked without running them */
import { describe, expect, test } from 'vitest'
import { cva, sva } from '../styled-system/css'
import { button, slotButton } from '../styled-system/recipes'

/**
 * A recipe's type declares only what a compiled build accepts: calling it, and
 * `splitVariantProps`. The compiler erases the recipe, so every other read of the binding —
 * `raw`, `variantMap`, `config`, `merge`, `getVariantProps`, `classNameMap`, `slotsAffectedBy`
 * — fails the build with `runtime-binding` or `raw-call`. They used to be declared anyway, so
 * the failure type-checked and surfaced only at build time.
 *
 * Enforced by `pnpm codegen typecheck`: an unused `@ts-expect-error` is itself an error, so
 * each line below fails the moment its member is declared again.
 */
const inline = cva({ base: { color: 'red.300' }, variants: { tone: { a: { color: 'blue.300' } } } })
const slots = sva({ slots: ['root'], base: { root: { color: 'red.300' } } })

describe('recipe type surface', () => {
  test('declares nothing the compiler rejects', () => {
    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && inline.raw()
    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && inline.variantMap
    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && inline.config
    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && inline.merge(inline)
    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && inline.getVariantProps()

    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && slots.raw()
    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && slots.classNameMap
    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && slots.slotsAffectedBy

    // @ts-expect-error rejected by the compiler (raw-call)
    false && button.raw()
    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && button.variantMap
    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && button.getVariantProps()

    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && slotButton.slotsAffectedBy
    // @ts-expect-error rejected by the compiler (runtime-binding)
    false && slotButton.variantMap

    expect(true).toBe(true)
  })

  test('still declares what compiles', () => {
    const [variants, rest] = inline.splitVariantProps({ tone: 'a', id: 'x' })
    expect(variants).toEqual({ tone: 'a' })
    expect(rest).toEqual({ id: 'x' })

    expect(typeof button.splitVariantProps).toBe('function')
    expect(typeof slots.splitVariantProps).toBe('function')
    expect(typeof slotButton.splitVariantProps).toBe('function')
  })
})
