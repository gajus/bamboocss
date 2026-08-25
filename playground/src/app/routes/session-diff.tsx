import { Playground } from '@/src/components/Playground'
import { parseState } from '@/src/lib/parse-state'
import { prisma } from '@/src/server/prisma.server'
import { useLoaderData } from 'react-router'
import type { Route } from './+types/session-diff'

export async function loader({ params }: Route.LoaderArgs) {
  const [initialState, diffState] = await Promise.all([
    prisma.session
      .findFirst({
        where: { id: params.id },
        select: { id: true, code: true, css: true, config: true },
      })
      .catch(() => {
        throw new Response('Not Found', { status: 404, statusText: 'Not Found' })
      }),
    prisma.session
      .findFirst({
        where: { id: params.id2 },
        select: { id: true, code: true, css: true, config: true },
      })
      .catch(() => {
        throw new Response('Not Found', { status: 404, statusText: 'Not Found' })
      }),
  ])

  return {
    initialState: parseState(initialState),
    diffState: parseState(diffState),
  }
}

export default function SessionDiff() {
  const data = useLoaderData<typeof loader>()
  return <Playground initialState={data.initialState} diffState={data.diffState} />
}
