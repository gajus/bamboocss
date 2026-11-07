function toChar(code: number) {
  return String.fromCharCode(code + (code > 25 ? 39 : 97))
}

function toName(code: number) {
  let name = ''
  let x: number
  for (x = Math.abs(code); x > 52; x = (x / 52) | 0) name = toChar(x % 52) + name
  return toChar(x % 52) + name
}

function toPhash(h: number, x: string) {
  let i = x.length
  while (i) h = (h * 33) ^ x.charCodeAt(--i)
  return h
}

export function toHash(value: string) {
  return toName(toPhash(5381, value) >>> 0)
}

/** murmur3's finalizer: every bit of the result depends on every bit of `h`. */
function fmix32(h: number) {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * A 32-bit hash of `value` whose bits are all equally mixed, so a code can take any slice of
 * them. `toPhash` leaves its low bits poorly mixed — `toHash` reads them through a base-52
 * division, which does not care — so murmur3's finalizer goes on top.
 */
export function hash32(value: string) {
  return fmix32(toPhash(5381, value) >>> 0)
}

/**
 * A second 32-bit hash of `value`, independent of `hash32`: FNV-1a over its UTF-16 code units,
 * started from `seed`, through the same finalizer. A code needing more bits than `hash32` has
 * takes the rest from here, where two values `hash32` gives one answer are told apart as often
 * as any two.
 */
export function hash32b(value: string, seed: number) {
  let h = seed >>> 0
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193)
  return fmix32(h)
}
