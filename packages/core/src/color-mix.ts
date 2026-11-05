import { opacityPercent } from '@bamboocss/token-dictionary'
import type { TransformArgs } from '@bamboocss/types'

export const colorMix = (value: string, token: TransformArgs['token']) => {
  if (!value || typeof value !== 'string') return { invalid: true, value }

  const [rawColor, rawOpacity] = value.split('/')

  if (!rawColor || !rawOpacity) {
    return { invalid: true, value: rawColor }
  }

  const colorToken = token(`colors.${rawColor}`)
  const opacityToken = token.raw(`opacity.${rawOpacity}`)?.value

  // A percentage `color-mix()` takes, from 0% to 100%: `red.500/150` wrote one it refuses, and
  // reading a variable, the declaration was one no check could judge, so nothing said so.
  const opacity = opacityToken ? Number(opacityToken) * 100 : Number(rawOpacity)
  if (!(opacity >= 0 && opacity <= 100)) {
    return { invalid: true, value: rawColor }
  }

  const percent = opacityToken ? opacityPercent(opacityToken) : `${rawOpacity}%`
  const color = colorToken ?? rawColor

  return {
    invalid: false,
    color,
    value: `color-mix(in srgb, ${color} ${percent}, transparent)`,
  }
}
