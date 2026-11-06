import { createRule } from '../utils'

export const RULE_NAME = 'no-overridden-by-mixin'

/**
 * Deprecated, reporting nothing: what it reported cannot happen any more.
 *
 * It reported a property written before a mixin in the same object that the mixin set too, which
 * the mixin replaced while it applied where its key was written. A mixin is the base of the style
 * it is applied in now — its declarations first, the style's own after them — so a property beside
 * it overrides it wherever either is written. Kept so that a config naming it still loads, and in no
 * config of ours; it goes in the next major.
 */
const rule = createRule({
  create: () => ({}),
  defaultOptions: [],
  meta: {
    deprecated: true,
    docs: {
      description:
        'Deprecated: a property beside a mixin overrides it wherever either is written, so what this reported cannot happen.',
    },
    messages: {},
    schema: [],
    type: 'problem',
  },
  name: RULE_NAME,
})

export default rule
