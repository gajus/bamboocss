import { css } from '@/styled-system/css'
import { forwardRef } from 'react'
import { Link } from 'react-router'

export interface AnchorProps extends Omit<React.ComponentProps<'a'>, 'ref'> {
  newWindow?: boolean
}

// `/llms.txt`, `/llms-full.txt` and `/llms/*` are loader-only resource routes (plain-text
// responses, no page component — see routes.ts). React Router's <Link> still tries to render
// *something* for the matched route on client-side navigation; with nothing to render, that's a
// blank page until a hard refresh. A plain <a> lets the browser navigate normally instead.
const RESOURCE_ROUTE = /^\/llms(-full)?\.txt$|^\/llms\//

export const Anchor = forwardRef<HTMLAnchorElement, AnchorProps>(function Anchor(props, ref) {
  const { href = '', children, newWindow, ...rest } = props

  if (newWindow) {
    return (
      <a ref={ref} href={href} target="_blank" rel="noreferrer" {...rest}>
        {children}
        <span className={css({ srOnly: true })}> (opens in a new tab)</span>
      </a>
    )
  }

  if (!href) {
    return (
      <a ref={ref} {...rest}>
        {children}
      </a>
    )
  }

  if (href.startsWith('#') || RESOURCE_ROUTE.test(href)) {
    return (
      <a ref={ref} href={href} {...rest}>
        {children}
      </a>
    )
  }

  return (
    <Link ref={ref} to={href} {...rest}>
      {children}
    </Link>
  )
})
