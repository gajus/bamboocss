import type { ReportFormat } from '@bamboocss/reporter'
import type { AnalysisOptions } from '@bamboocss/types'
import type { BambooContext } from './create-context'

/**
 * `analyze` is one CLI command, but this module is reachable from `@bamboocss/node`'s index,
 * so a static import made every consumer of that index — the CLI on any command, and the Vite
 * plugin on every build — load the reporter and its table formatters to run neither. Loading
 * it here keeps that off the path of everything that is not the `analyze` command.
 */
export async function analyze(ctx: BambooContext, options: AnalysisOptions = {}) {
  const { Reporter, formatRecipeReport, formatTokenReport } = await import('@bamboocss/reporter')

  const reporter = new Reporter(ctx, {
    project: ctx.project,
    getRelativePath: ctx.runtime.path.relative,
    getFiles: ctx.getFiles,
    ...options,
  })

  reporter.init()

  return {
    getRecipeReport(format: ReportFormat = 'table') {
      const report = reporter.getRecipeReport()
      return { report, formatted: formatRecipeReport(report, format) }
    },
    getTokenReport(format: ReportFormat = 'table') {
      const report = reporter.getTokenReport()
      return { report, formatted: formatTokenReport(report.getSummary(), format) }
    },
    writeReport(filePath: string) {
      const dirname = ctx.runtime.path.dirname(filePath)
      ctx.runtime.fs.ensureDirSync(dirname)
      const str = JSON.stringify(reporter.report, replacer, 2)
      return ctx.runtime.fs.writeFile(filePath, str)
    },
  }
}

function replacer(_: string, value: any) {
  if (value instanceof Set) return Array.from(value)
  if (value instanceof Map) return Object.fromEntries(value)
  return value
}
