import { useState, useEffect } from 'react'
import type { ThemeId } from '../../../shared/types'

export function useTheme(themeId?: ThemeId | null): ThemeId {
  // OS-resolved theme — always tracked so switching back to 'os' is instant.
  const [osTheme, setOsTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return 'light'
  })

  // Only subscribe to OS theme events when following OS — avoids unnecessary
  // IPC + App re-renders for users who've pinned an explicit theme.
  const followOs = !themeId || themeId === 'os'
  useEffect(() => {
    if (!followOs) return
    if (window.electronAPI) {
      window.electronAPI.getTheme().then((t) => setOsTheme(t as 'dark' | 'light'))
      const dispose = window.electronAPI.onThemeChanged((t) => setOsTheme(t as 'dark' | 'light'))
      return dispose
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setOsTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [followOs])

  // Resolved theme: explicit pin wins over OS default.
  const resolved: ThemeId = (!themeId || themeId === 'os') ? osTheme : themeId

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
  }, [resolved])

  return resolved
}
