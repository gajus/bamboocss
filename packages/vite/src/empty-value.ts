import { UnwritableStyleError } from './unwritable-style'

/**
 * A declaration whose value is an empty string.
 *
 * CSS has no empty value. The stylesheet writes the declaration with nothing after its colon and
 * the optimizer drops it, so the class named for it — `content_` — has no rule, and the build used
 * to fail on that as a mismatch between the compiler and the stylesheet. Nearly always it is
 * `content: ''`, meant as the empty string CSS generates a pseudo-element's box for, which is
 * written `'""'`; anywhere else it was meant as no declaration at all.
 */
export class EmptyValueError extends UnwritableStyleError {
  readonly reason = 'empty-value'

  constructor(readonly property: string) {
    super(
      property === 'content'
        ? `\`content\` is an empty string, which CSS has no value for; an empty \`content\` is written \`'""'\``
        : `\`${property}\` is an empty string, which CSS has no value for; leave it out, or write \`undefined\` where it is chosen`,
    )
    this.name = 'EmptyValueError'
  }
}

/** Refuse a value that is empty or blank, as a class is about to be named for it. */
export const checkValue = (property: string, value: unknown) => {
  if (typeof value === 'string' && value.trim() === '') throw new EmptyValueError(property)
}
