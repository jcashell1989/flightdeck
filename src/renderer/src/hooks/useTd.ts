import { useCallback, useEffect, useState } from 'react'
import type { TdTicket } from '../../../shared/types'

export function useTd(cwd?: string) {
  const [tickets, setTickets] = useState<TdTicket[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TdTicket | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.td
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      const list = await api.list(cwd)
      setTickets(list)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [cwd])

  const loadDetail = useCallback(async (id: string) => {
    const api = window.electronAPI?.td
    if (!api) return
    setDetailLoading(true)
    setSelectedId(id)
    try {
      const t = await api.show(id, cwd)
      setDetail(t)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [cwd])

  const start = useCallback(async (id: string) => {
    await window.electronAPI?.td?.start(id, cwd)
    await refresh()
  }, [cwd, refresh])

  const log = useCallback(async (id: string, message: string) => {
    await window.electronAPI?.td?.log(id, message, cwd)
    await refresh()
  }, [cwd, refresh])

  const handoff = useCallback(async (id: string) => {
    await window.electronAPI?.td?.handoff(id, cwd)
    await refresh()
  }, [cwd, refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const api = window.electronAPI?.td
    if (!api?.onTdChange) return
    const unsub = api.onTdChange(() => { void refresh() })
    return unsub
  }, [refresh])

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const id = setInterval(() => { void refresh() }, 10_000)
    return () => clearInterval(id)
  }, [refresh])

  return { tickets, loading, error, refresh, selectedId, detail, detailLoading, loadDetail, start, log, handoff }
}
