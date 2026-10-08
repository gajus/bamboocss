import type { UtilityConfig } from '@bamboocss/types'

/**
 * Each of these writes the vendor-prefixed declaration next to the standard one, prefixed
 * first. The later of two declarations is the one that applies wherever both are understood,
 * so the standard spelling goes last, and minifiers read the order the same way: written the
 * other way round, LightningCSS (Vite 8's default) kept only `-webkit-backdrop-filter`, which
 * Chrome, Edge and Firefox do not support.
 */
export const polyfill: UtilityConfig = {
  appearance: {
    className: 'ap',
    group: 'Visibility',
    transform(value) {
      return { WebkitAppearance: value, appearance: value }
    },
  },
  backfaceVisibility: {
    className: 'bfv',
    group: 'Visibility',
    transform(value) {
      return { WebkitBackfaceVisibility: value, backfaceVisibility: value }
    },
  },
  clipPath: {
    className: 'cp-path',
    group: 'Other',
    transform(value) {
      return { WebkitClipPath: value, clipPath: value }
    },
  },
  hyphens: {
    className: 'hy',
    group: 'Other',
    transform(value) {
      return { WebkitHyphens: value, hyphens: value }
    },
  },
  mask: {
    className: 'msk',
    group: 'Other',
    transform(value) {
      return { WebkitMask: value, mask: value }
    },
  },
  maskImage: {
    className: 'msk-i',
    group: 'Other',
    transform(value) {
      return { WebkitMaskImage: value, maskImage: value }
    },
  },
  maskSize: {
    className: 'msk-s',
    group: 'Other',
    transform(value) {
      return { WebkitMaskSize: value, maskSize: value }
    },
  },
  textSizeAdjust: {
    className: 'txt-adj',
    group: 'Typography',
    transform(value) {
      return { WebkitTextSizeAdjust: value, textSizeAdjust: value }
    },
  },
}
