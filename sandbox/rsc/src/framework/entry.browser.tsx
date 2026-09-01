import { createFromReadableStream } from '@vitejs/plugin-rsc/browser'
import type { ReactNode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { ClientOnlyBadge } from '../client-only'

/** The `client` entry: fetch the RSC stream and hydrate, then mount what only the browser renders. */
async function main() {
  const rscResponse = await fetch(`${window.location.href}.rsc`)
  const root = await createFromReadableStream<ReactNode>(rscResponse.body!)
  hydrateRoot(document, root)

  const badge = document.createElement('div')
  badge.id = 'client-only'
  document.body.append(badge)
  createRoot(badge).render(<ClientOnlyBadge />)
}

void main()
