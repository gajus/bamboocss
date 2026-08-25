import { describe, expect, test } from 'vitest'
import { createHash } from '../crypto-shim'

describe('browser crypto shim', () => {
  test('matches Node SHA-256 output across incremental updates', () => {
    const hash = createHash('sha256').update('a').update('bc')

    expect(hash.digest('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  test('emits the base64 format used by parser digests', () => {
    expect(createHash('sha256').update('abc').digest('base64')).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=')
  })

  test('rejects algorithms the browser shim does not implement', () => {
    expect(() => createHash('sha1')).toThrow('Unsupported browser hash algorithm')
  })
})
