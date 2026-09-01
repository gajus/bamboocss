'use client'

import { css } from '../styled-system/css'

/**
 * Mounted by the browser entry alone, so no server environment ever renders it: its rule is
 * reached by the client graph and nothing else. The one case where the last environment to
 * build restores a rule the earlier prune removed.
 */
export function ClientOnlyBadge() {
  return <span className={css({ color: 'purple.700', fontVariantNumeric: 'tabular-nums' })}>client-only badge</span>
}
