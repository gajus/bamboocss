import type { SkipReason } from './fold'

/**
 * A declaration the build's copy of the runtime will not name a class for, because no rule could
 * ever have that class.
 *
 * Thrown while a class is named; the fold reports it by the call the style is written in, under
 * `reason`, and emits nothing for that call. The message is the whole report.
 */
export abstract class UnwritableStyleError extends Error {
  abstract readonly reason: Extract<SkipReason, 'unknown-condition' | 'empty-value'>
}
