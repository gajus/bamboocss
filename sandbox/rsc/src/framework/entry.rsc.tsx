import { renderToReadableStream } from '@vitejs/plugin-rsc/rsc/server'
import { App } from '../app'

/** The `rsc` entry: a request handler that serializes the server tree to an RSC stream. */
export default async function handler(request: Request): Promise<Response> {
  const rscStream = renderToReadableStream(<App />)

  if (request.url.endsWith('.rsc')) {
    return new Response(rscStream, { headers: { 'Content-type': 'text/x-component;charset=utf-8' } })
  }

  const ssrEntry = await import.meta.viteRsc.loadModule<typeof import('./entry.ssr')>('ssr', 'index')
  const htmlStream = await ssrEntry.handleSsr(rscStream)

  return new Response(htmlStream, { headers: { 'Content-type': 'text/html' } })
}

if (import.meta.hot) {
  import.meta.hot.accept()
}
