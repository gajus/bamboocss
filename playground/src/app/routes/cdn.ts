import { extract } from '@/src/server/dev-runtime.server'
import type { Route } from './+types/cdn'

const methodNotAllowed = () =>
  new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST' },
  })

export function loader() {
  return methodNotAllowed()
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') return methodNotAllowed()

  const { code, config } = await request.json()
  if (!code) return Response.json({ error: 'Missing code parameter' }, { status: 400 })

  try {
    return Response.json(extract(code, config))
  } catch (error) {
    console.error('Error processing request:', error)
    return Response.json({ error: 'Failed to process code' }, { status: 500 })
  }
}
