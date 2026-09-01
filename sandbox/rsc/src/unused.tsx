import { css } from '../styled-system/css'

/**
 * Inside `include`, so the stylesheet is extracted with this rule — and imported by nothing,
 * so no environment reaches it. What pruning across every environment has to remove, and the
 * only thing it may.
 */
export const unreachable = css({ width: '[123.456px]' })
