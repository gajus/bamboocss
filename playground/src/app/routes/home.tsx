import { EXAMPLES } from '@/src/components/Examples/data'
import { Playground } from '@/src/components/Playground'
import { parseState } from '@/src/lib/parse-state'
import { useLoaderData } from 'react-router'
import type { Route } from './+types/home'

export function loader({ request }: Route.LoaderArgs) {
  const exampleId = new URL(request.url).searchParams.get('eg')
  return parseState(EXAMPLES.find((example) => example.id === exampleId))
}

export default function Home() {
  return <Playground initialState={useLoaderData<typeof loader>()} />
}
