import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react'

type Theme = 'dark' | 'light'

const ThemeContext = createContext<{
  resolvedTheme: Theme
  setTheme: (theme: Theme) => void
} | null>(null)

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('theme')
    if (storedTheme === 'dark' || storedTheme === 'light') setTheme(storedTheme)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.classList.toggle('light', theme === 'light')
    window.localStorage.setItem('theme', theme)
  }, [theme])

  const value = useMemo(() => ({ resolvedTheme: theme, setTheme }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}
