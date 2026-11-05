import type { PropertyTransform } from '@bamboocss/types'

/**
 * A colour with an opacity modifier — `red.300/50` — as the `color-mix()` it stands for.
 *
 * It went through a variable of its own, `--mix-color: color-mix(…); color: var(--mix-color,
 * <colour>)`, on the claim that the fallback was the colour where `color-mix()` is not supported.
 * It never was: a custom property holds `color-mix()` unread whether or not the browser knows it,
 * so the variable is always set, and the fallback in `var()` applies only to one that is not. All
 * the variable did was write each declaration twice.
 */
export const createColorMixTransform =
  (prop: string): PropertyTransform =>
  (value, args) => {
    const mix = args.utils.colorMix(value)
    if (mix.invalid) return { [prop]: value }
    return { [prop]: mix.value }
  }
