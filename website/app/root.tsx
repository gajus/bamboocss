import { NotFound } from '@/components/not-found'
import { css, cx } from '@/styled-system/css'
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'
import 'virtual:bamboo.css'
import seoConfig from '../seo.config'

export function meta() {
  return [
    { title: seoConfig.title.default },
    { name: 'description', content: seoConfig.description },
    { name: 'theme-color', content: seoConfig.themeColor },
    { property: 'og:url', content: seoConfig.openGraph.url },
    { property: 'og:image', content: '/opengraph-image.png' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:image', content: '/opengraph-image.png' },
  ]
}

export function links() {
  return [
    { rel: 'manifest', href: seoConfig.manifest },
    ...seoConfig.icons.map((icon) => ({ rel: icon.rel, href: icon.url })),
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Onest:wght@100..900&family=Source+Code+Pro:wght@200..900&display=swap',
    },
  ]
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cx('dark', css({ fontFamily: 'body' }))}
      style={
        {
          '--font-sans': '"Onest"',
          '--font-mono': '"Source Code Pro"',
        } as React.CSSProperties
      }
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: { error: unknown }) {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFound />
  }

  const message = error instanceof Error ? error.message : 'An unexpected error occurred.'
  return (
    <main>
      <h1>Application error</h1>
      <p>{message}</p>
    </main>
  )
}
