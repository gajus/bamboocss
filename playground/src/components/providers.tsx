import { AppToastProvider } from '@/src/components/ToastProvider'
import { ThemeProvider } from '@/src/hooks/useTheme'
import { PropsWithChildren, useEffect } from 'react'

export function Providers({ children }: PropsWithChildren) {
  useEffect(() => {
    const initWasm = async () => {
      const lightningcssWasm = await import('lightningcss-wasm')
      await lightningcssWasm.default()
    }
    initWasm()
  }, [])

  return (
    <ThemeProvider>
      <AppToastProvider>{children}</AppToastProvider>
    </ThemeProvider>
  )
}
