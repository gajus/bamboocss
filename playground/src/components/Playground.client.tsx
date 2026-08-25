import '@/src/browser-globals.client'
import { PlaygroundContent } from '@/src/components/PlaygroundContent'
import { useConfig } from '@/src/hooks/useConfig'
import { type UsePlayGroundProps, usePlayground } from '@/src/hooks/usePlayground'

export const Playground = (props: UsePlayGroundProps) => {
  const playground = usePlayground(props)
  const state = playground.diffState ?? playground.state

  const config = useConfig(state.config)
  if (!config.config && !config.error) return null

  return <PlaygroundContent playground={playground} config={config} />
}
