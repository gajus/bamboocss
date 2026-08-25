import { Providers } from '@/src/components/providers'
import type { CSSProperties, ReactNode } from 'react'
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'
import type { Route } from './+types/root'
import '../styles/globals.css'
import 'virtual:bamboo.css'

export const meta: Route.MetaFunction = () => [
  { title: 'Bamboo Playground' },
  {
    name: 'description',
    content: 'Explore Bamboo CSS with an interactive playground. Create and share your own Bamboo CSS snippets.',
  },
  { property: 'og:image', content: 'https://play.bamboocss.com/og-image.png' },
  { property: 'og:url', content: 'https://play.bamboocss.com' },
  { name: 'twitter:site', content: '@bamboo__css' },
  { name: 'twitter:creator', content: '@thesegunadebayo' },
  { name: 'theme-color', content: '#F6E458' },
]

export const links: Route.LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap',
  },
  { rel: 'manifest', href: '/site.webmanifest' },
  { rel: 'icon', href: '/favicon.ico' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
]

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" style={{ '--font-inter': 'Inter' } as CSSProperties} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Providers>{children}</Providers>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error)) {
    return (
      <main>
        <h1>
          {error.status} {error.statusText}
        </h1>
      </main>
    )
  }

  return (
    <main>
      <h1>Unexpected error</h1>
      <p>{error instanceof Error ? error.message : 'An unknown error occurred.'}</p>
    </main>
  )
}
