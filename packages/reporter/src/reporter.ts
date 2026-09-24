import type { ParserOptions, Stylesheet } from '@bamboocss/core'
import type { Generator } from '@bamboocss/generator'
import { logger } from '@bamboocss/logger'
import type { AnalysisReport, ParserResultInterface } from '@bamboocss/types'
import { version } from '../package.json'
import { classifyProject } from './classify'
import { analyzeRecipes, type RecipeReportEntry } from './reporter-recipe'
import { analyzeTokens, type TokenAnalysisReport } from './reporter-token'

export class Reporter {
  #parserResults = new Map<string, ParserResultInterface>()
  #extractTimes = new Map<string, number>()
  #sheet!: Stylesheet
  #report!: AnalysisReport

  constructor(
    private ctx: Generator,
    private options: ReporterOptions,
  ) {}

  private setup = (): void => {
    this.#sheet = this.ctx.createSheet()
    this.ctx.appendLayerParams(this.#sheet)
    this.ctx.appendBaselineCss(this.#sheet)
    this.parseFiles()
    this.ctx.appendParserCss(this.#sheet)
  }

  get report() {
    return this.#report
  }

  private parseFiles = (): void => {
    const { getFiles, prepare } = this.options

    const files = getFiles()
    logger.info('analyze', `Analyzing ${files.length} file(s) for token and recipe usage...`)

    // One native pass for the whole set, rather than one per file.
    prepare?.(files)

    for (const file of files) {
      this.parseFile(file)
    }
  }

  private parseFile = (file: string): void => {
    const { parseFile, getRelativePath, onResult } = this.options
    const { config } = this.ctx

    const start = performance.now()
    const result = parseFile(file)

    const extractMs = performance.now() - start
    const filePath = getRelativePath(config.cwd, file)

    this.#extractTimes.set(filePath, extractMs)
    logger.debug('analyze', `Parsed ${file} in ${extractMs}ms`)

    if (result) {
      this.#parserResults.set(filePath, result)
      onResult?.(file, result)
    }
  }

  init = (): void => {
    this.setup()
    const classify = classifyProject(this.options.parserOptions, this.#parserResults)

    this.#report = {
      schemaVersion: version,
      details: classify.details,
      propByIndex: classify.propById,
      componentByIndex: classify.componentById,
      derived: classify.derived,
    }
  }

  getTokenReport = (): TokenAnalysisReport => analyzeTokens(this.options.parserOptions, this.#report)

  getRecipeReport = (): RecipeReportEntry[] => analyzeRecipes(this.options.parserOptions, this.#report)
}

export interface ReporterOptions {
  onResult?: (file: string, result: ParserResultInterface) => void
  parserOptions: ParserOptions
  /** Extract one file. The build's own extraction, so the report reads what the build reads. */
  parseFile: (file: string) => ParserResultInterface | undefined
  /** Prepare a batch before `parseFile` is called for each of its files. */
  prepare?: (files: string[]) => void
  getFiles: () => string[]
  getRelativePath: (cwd: string, file: string) => string
}
