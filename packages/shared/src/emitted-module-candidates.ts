/** File spellings a JavaScript extension can name when an import points at source. */
const extensionsByEmittedSuffix: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx', '.d.ts', '.js', '.jsx'],
  '.jsx': ['.tsx', '.ts', '.d.ts', '.jsx', '.js'],
  '.mjs': ['.mts', '.d.mts', '.mjs'],
  '.cjs': ['.cts', '.d.cts', '.cjs'],
}

/** Candidates for an explicit JavaScript filename, or undefined for other spellings. */
export const emittedModuleCandidates = (path: string): string[] | undefined => {
  const dot = path.lastIndexOf('.')
  const extensions = extensionsByEmittedSuffix[path.slice(dot)]
  if (!extensions) return undefined
  const stem = path.slice(0, dot)
  return extensions.map((extension) => stem + extension)
}
