export const createHash = () => {
  let hash = 2166136261

  const digest = {
    update(value) {
      for (const byte of new TextEncoder().encode(String(value))) {
        hash ^= byte
        hash = Math.imul(hash, 16777619)
      }
      return digest
    },
    digest(encoding) {
      const hex = (hash >>> 0).toString(16).padStart(8, '0')
      return encoding === 'hex' ? hex : new TextEncoder().encode(hex)
    },
  }

  return digest
}
