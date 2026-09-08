import { docsSource } from '@/lib/source'
import { createFromSource } from 'fumadocs-core/search/server'

// Loader-only resource route, same shape as llms-index.ts/llms-full.ts/llms-doc.ts: prerendered
// to a static file (react-router.config.ts), no server needed at runtime.
const server = createFromSource(docsSource)

export async function loader() {
  return server.staticGET()
}
