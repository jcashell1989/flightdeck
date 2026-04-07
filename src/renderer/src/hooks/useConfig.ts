import { useEffect, useState, useCallback } from 'react'
import { AppConfig } from '../types'

declare global {
  interface Window {
    electronAPI?: {
      getTheme: () => Promise<'dark' | 'light'>
      onThemeChanged: (cb: (theme: 'dark' | 'light') => void) => () => void
      config: {
        get: () => Promise<AppConfig>
        set: (patch: Partial<AppConfig>) => Promise<AppConfig>
        onChange: (cb: (cfg: AppConfig) => void) => () => void
      }
    }
  }
}

export function useConfig(): {
  config: AppConfig | null
  setConfig: (patch: Partial<AppConfig>) => Promise<void>
} {
  const [config, setLocalConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    const api = window.electronAPI?.config
    if (!api) return
    api.get().then(setLocalConfig)
    return api.onChange(setLocalConfig)
  }, [])

  const setConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const api = window.electronAPI?.config
    if (!api) return
    const next = await api.set(patch)
    setLocalConfig(next)
  }, [])

  return { config, setConfig }
}
