import { colors, logger } from '@bamboocss/logger'
import { writeFile } from 'node:fs/promises'
import { basename, dirname, parse } from 'node:path'
import type { BambooContext } from './create-context'
import { createZip, type ZipEntry } from './zip'

interface DebugOptions {
  outdir: string
  dry: boolean
  onlyConfig?: boolean
  /** Write the dump as one `<outdir>.zip`, which a bug report attaches, rather than as files. */
  zip?: boolean
}

export async function debug(ctx: BambooContext, options: DebugOptions) {
  const files = ctx.getFiles()
  const measureTotal = logger.time.debug(`Done parsing ${files.length} files`)

  // easier to debug
  ctx.config.minify = false

  const { fs, path } = ctx.runtime
  const outdir = options.outdir
  // Beside the folder it stands in for: `debug/` and `debug` alike are `debug.zip`.
  const archive = options.zip && outdir ? `${path.resolve(outdir)}.zip` : undefined

  // Into the archive, under the folder the files would have been written to, or to disk.
  const entries: ZipEntry[] = []
  const writes: Array<Promise<unknown>> = []
  // Twenty at a time, as codegen writes. There is a file per source file, and the runtime's
  // `writeFile` is `node:fs`'s, which fails a write that runs out of file handles where
  // `fs-extra`'s queued it and tried again.
  const { default: pLimit } = await import('p-limit')
  const limit = pLimit(20)
  const write = (name: string, content: string) => {
    if (options.zip) {
      entries.push({ name: `${basename(path.resolve(outdir))}/${name}`, data: content })
      return
    }
    logger.info('cli', `Writing ${colors.bold(`${outdir}/${name}`)}`)
    writes.push(limit(() => fs.writeFile(`${outdir}${path.sep}${name}`, content)))
  }
  const finish = async () => {
    // A file that could not be written fails the command, rather than ending in a count of files
    // nothing was written for.
    const failed = (await Promise.allSettled(writes)).flatMap((write) =>
      write.status === 'rejected' ? [write.reason] : [],
    )
    if (failed.length) {
      throw new AggregateError(failed, `${failed.length} debug file(s) could not be written to ${outdir}: ${failed[0]}`)
    }
    if (!archive) return
    fs.ensureDirSync(dirname(archive))
    logger.info('cli', `Writing ${colors.bold(archive)}`)
    // Bytes, which the runtime's `writeFile` is not for.
    await writeFile(archive, createZip(entries))
  }

  if (!options.dry && outdir) {
    if (!options.zip) fs.ensureDirSync(outdir)
    write('config.json', JSON.stringify(ctx.config, null, 2))
  }

  if (options.onlyConfig) {
    await finish()
    measureTotal()
    return
  }

  const filesWithCss = []

  ctx.prepareNativeExtraction(files)
  files.map((file) => {
    const measure = logger.time.debug(`Parsed ${file}`)
    const encoder = ctx.encoder.clone()
    const result = ctx.parseFile(file, encoder)

    measure()
    if (!result || result.isEmpty() || encoder.isEmpty()) return

    const styles = ctx.decoder.clone().collect(encoder)
    const css = ctx.getParserCss(styles)
    if (!css) return

    if (options.dry) {
      console.log({ path: file, ast: result, code: css })
      return
    }

    if (outdir) {
      filesWithCss.push(file)
      const parsedPath = parse(file)
      const relative = path.relative(ctx.config.cwd, parsedPath.dir)

      const astJsonPath = `${relative}${path.sep}${parsedPath.name}.ast.json`.replaceAll(path.sep, '__')
      const cssPath = `${relative}${path.sep}${parsedPath.name}.css`.replaceAll(path.sep, '__')

      write(astJsonPath, JSON.stringify(result.toJSON(), null, 2))
      write(cssPath, css)
    }
  })

  await finish()
  logger.info('cli', `Found ${colors.bold(`${filesWithCss.length}/${files.length}`)} files using Bamboo`)
  measureTotal()
}
