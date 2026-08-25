import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const encoder = new TextEncoder()

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const createHash = (algorithm: string) => {
  if (algorithm !== 'sha256') {
    throw new Error(`Unsupported browser hash algorithm: ${algorithm}`)
  }

  const hash = sha256.create()
  const api = {
    update(value: string | Uint8Array) {
      hash.update(typeof value === 'string' ? encoder.encode(value) : value)
      return api
    },
    digest(encoding?: 'base64' | 'hex') {
      const bytes = hash.digest()
      if (encoding === 'base64') return bytesToBase64(bytes)
      if (encoding === 'hex') return bytesToHex(bytes)
      return bytes
    },
  }

  return api
}
