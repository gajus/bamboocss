import { Playground as ClientPlayground } from '@/src/components/Playground.client'
import type { UsePlayGroundProps } from '@/src/hooks/usePlayground'
import { useEffect, useState } from 'react'

export const Playground = (props: UsePlayGroundProps) => {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  return hydrated ? <ClientPlayground {...props} /> : null
}
