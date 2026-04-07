import { useState, useEffect } from 'react'

type Theme = 'dark' | 'light'

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return 'light'
  })

  useEffect(() => {
    // Electron native theme
    if (window.electronAPI) {
      window.electronAPI.getTheme().then(setTheme)
      const dispose = window.electronAPI.onThemeChanged(setTheme)
      return dispose
    }

    // Fallback: CSS media query
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return theme
}
