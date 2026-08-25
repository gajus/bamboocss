import { Playground } from '@/src/components/Playground'
import { parseState } from '@/src/lib/parse-state'
import { prisma } from '@/src/server/prisma.server'
import { useLoaderData } from 'react-router'
import type { Route } from './+types/session'

export async function loader({ params }: Route.LoaderArgs) {
  const session = await prisma.session
    .findFirst({
      where: { id: params.id },
      select: { id: true, code: true, css: true, config: true },
    })
    .catch(() => {
      throw new Response('Not Found', { status: 404, statusText: 'Not Found' })
    })

  return parseState(session)
}

export default function Session() {
  return <Playground initialState={useLoaderData<typeof loader>()} />
}
