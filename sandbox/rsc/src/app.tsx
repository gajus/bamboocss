import 'virtual:bamboo.css'
import { css } from '../styled-system/css'
import { Counter } from './counter'

/**
 * A server component. Nothing here reaches the client graph: the `css()` calls below are
 * compiled in the `rsc` environment only, so their rules exist only if the stylesheet is
 * pruned against that environment's reachability as well as the client's.
 */
export function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Bamboo + React Server Components</title>
      </head>
      <body className={css({ fontFamily: 'sans', p: '8', bg: 'gray.50', color: 'gray.900' })}>
        <main className={css({ maxW: '3xl', mx: 'auto', display: 'grid', gap: '6' })}>
          <h1 className={css({ fontSize: '3xl', fontWeight: 'bold', md: { fontSize: '4xl' } })}>Server-rendered</h1>
          <p className={css({ color: 'green.700', _dark: { color: 'green.300' } })}>
            This paragraph is styled by a server component that never ships to the browser.
          </p>
          <Counter />
        </main>
      </body>
    </html>
  )
}
