import type { IncomingMessage, ServerResponse } from 'node:http'

/** How long a dev server stays quiet, nothing requested and nothing compiled, before it judges. */
export const UNIMPORTED_STYLESHEET_GRACE_MS = 1500

export interface UnimportedStylesheetWatch {
  /** A module was compiled to Bamboo class values. */
  compiled(file: string): void
  /** Something asked for the stylesheet, which leaves nothing to say. */
  loaded(): void
}

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void

/**
 * Say once, in dev, that modules were compiled to Bamboo class values and nothing has asked for the
 * stylesheet, so they render with class names and no rules behind them.
 *
 * A build fails on this at its end. A dev server said nothing, and the first sign was an unstyled
 * page.
 *
 * Judged once the server has served something and gone quiet, not at the first compile: the entry
 * importing the stylesheet is transformed before the components it renders, but its import is
 * loaded alongside them, and a slow render can load it last. Not before any request either, so
 * modules warmed up at start-up (`server.warmup`), before anything loaded the entry, are not read
 * as a missing import. A request still open holds the judgement, which leaves a long-lived one, an
 * event stream, saying nothing rather than something wrong.
 */
export function watchUnimportedStylesheet(
  use: (middleware: Middleware) => void,
  warn: (compiled: ReadonlySet<string>) => void,
  grace = UNIMPORTED_STYLESHEET_GRACE_MS,
): UnimportedStylesheetWatch {
  const compiled = new Set<string>()
  let settled = false
  let requested = false
  let open = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  const schedule = () => {
    cancel()
    if (settled || !requested || open || !compiled.size) return
    timer = setTimeout(() => {
      timer = undefined
      if (settled || open) return
      settled = true
      warn(compiled)
    }, grace)
    timer.unref?.()
  }

  use((_request, response, next) => {
    if (!settled) {
      requested = true
      open++
      cancel()
      response.once('close', () => {
        open--
        schedule()
      })
    }
    next()
  })

  return {
    compiled(file) {
      if (settled) return
      compiled.add(file)
      schedule()
    },
    loaded() {
      settled = true
      cancel()
    },
  }
}
