import { prisma } from '@/src/server/prisma.server'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { Route } from './+types/api.share'

const schema = z.object({
  code: z.string(),
  css: z.string(),
  config: z.string(),
})

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

  try {
    const data = schema.parse(await request.json())
    const id = nanoid(10)
    const session = await prisma.session.create({ data: { id, ...data }, select: { id: true } })
    return Response.json({ success: true, data: session })
  } catch (error) {
    console.error(error)
    return Response.json({ success: false }, { status: 500 })
  }
}
