import { loadNativeExtractor } from './native-extractor'

/** Check converted TSX with the same parser used for stylesheet extraction. */
export const isValidTsx = (code: string): boolean =>
  loadNativeExtractor().analyze('component.tsx', code, []).errors.length === 0
