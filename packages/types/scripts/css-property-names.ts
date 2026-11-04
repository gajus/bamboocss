import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Project as TsProject } from 'ts-morph'

const src = join(__dirname, '..', 'src')

/**
 * Every name `CssProperties` declares, sorted: csstype's `Properties` with everything it extends,
 * and `ModernCssProperties`.
 *
 * The generator writes `CssProperties["…"]` as a style property's value type, and that resolves
 * only for a name declared here. The style properties themselves come from mdn-data, which lists a
 * property before csstype types it — `readingFlow`, the `corner-*-shape` longhands — and an index
 * with any other name is an error in a project with `skipLibCheck` off, and an `any` that accepts
 * every value in one with it on.
 *
 * Read off the resolved interface rather than its source, so a base added to `CssProperties`, or
 * an interface csstype splits in two, is counted without anyone listing it here.
 */
export const getCssPropertyNames = () => {
  const project = new TsProject({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    useInMemoryFileSystem: true,
    compilerOptions: { skipLibCheck: true },
  })

  // `system-types.ts` imports `Properties` from `./csstype`, so the two sit side by side.
  for (const file of ['csstype.d.ts', 'system-types.ts']) {
    project.createSourceFile(`/src/${file}`, readFileSync(join(src, file), 'utf8'))
  }

  const cssProperties = project.getSourceFileOrThrow('/src/system-types.ts').getInterfaceOrThrow('CssProperties')

  return cssProperties
    .getType()
    .getProperties()
    .map((symbol) => symbol.getName())
    .sort()
}
