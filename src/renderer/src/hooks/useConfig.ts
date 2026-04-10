import { useEffect, useState, useCallback, useRef } from 'react'
import { AppConfig } from '../types'

/**
 * Extracts a user-facing error message from an IPC rejection. Electron wraps
 * main-thrown errors as "Error invoking remote method 'X': Error: <msg>" so
 * we strip the wrapping to surface just the underlying reason.
 */
function formatIpcError(e: unknown): string {
  if (e instanceof Error) {
    // Electron wrap: "Error invoking remote method 'X': Error: <msg>"
    const m = e.message.match(/Error invoking remote method '[^']+':\s*(?:Error:\s*)?(.*)$/)
    if (m && m[1]) return m[1]
    return e.message
  }
  return String(e)
}

export function useConfig(): {
  config: AppConfig | null
  setConfig: (patch: Partial<AppConfig>) => Promise<boolean>
  configError: string | null
  clearConfigError: () => void
} {
  const [config, setLocalConfig] = useState<AppConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  // Serialise concurrent setConfig calls so rapid-fire patches (e.g. multiple
  // checkbox toggles) don't race against each other's in-flight writes or
  // against the config-changed broadcast.
  const writeChain = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    const api = window.electronAPI?.config
    if (!api) return
    let aborted = false
    api.get()
      .then((cfg) => { if (!aborted) setLocalConfig(cfg) })
      .catch((e) => { if (!aborted) setConfigError(formatIpcError(e)) })
    const unsub = api.onChange(setLocalConfig)
    return () => {
      aborted = true
      unsub()
    }
  }, [])

  /**
   * Apply a config patch. Never rejects — always resolves to a boolean
   * indicating success. On failure, the error is captured in `configError`
   * state so fire-and-forget callers remain safe (no unhandled rejection).
   */
  const setConfig = useCallback(async (patch: Partial<AppConfig>): Promise<boolean> => {
    const api = window.electronAPI?.config
    if (!api) return false
    const run = async (): Promise<boolean> => {
      try {
        const next = await api.set(patch)
        setLocalConfig(next)
        setConfigError(null)
        return true
      } catch (e) {
        setConfigError(formatIpcError(e))
        console.error('[useConfig] set failed:', e)
        return false
      }
    }
    const chained = writeChain.current.then(run, run)
    writeChain.current = chained.catch(() => undefined)
    return chained
  }, [])

  const clearConfigError = useCallback(() => setConfigError(null), [])

  return { config, setConfig, configError, clearConfigError }
}
