import type { OpencodeSnapshotPayload } from '@shared/types'

const BASE = window.location.origin  // same-origin

function getToken(): string {
  return sessionStorage.getItem('fd_token') ?? ''
}

export function setToken(token: string): void {
  sessionStorage.setItem('fd_token', token)
}

async function bearerFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
  })
}

export async function getSnapshot(): Promise<OpencodeSnapshotPayload> {
  const r = await fetch(`${BASE}/api/snapshot`, { credentials: 'include' })
  if (!r.ok) throw new Error(`snapshot failed: ${r.status}`)
  return r.json() as Promise<OpencodeSnapshotPayload>
}

export function subscribeSSE(onSnapshot: (s: OpencodeSnapshotPayload) => void): () => void {
  const es = new EventSource(`${BASE}/api/events`, { withCredentials: true })
  es.addEventListener('snapshot', (e) => {
    try { onSnapshot(JSON.parse((e as MessageEvent).data) as OpencodeSnapshotPayload) } catch { /* ignore */ }
  })
  return () => es.close()
}

export async function dispatch(args: { profileId: string; directory: string; prompt: string }): Promise<{ sessionId: string }> {
  const r = await bearerFetch('/api/dispatch', { method: 'POST', body: JSON.stringify(args) })
  if (!r.ok) throw new Error(`dispatch failed: ${r.status}`)
  return r.json() as Promise<{ sessionId: string }>
}

export async function respond(sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void> {
  const r = await bearerFetch(`/api/session/${sessionId}/respond`, { method: 'POST', body: JSON.stringify({ permissionId, response }) })
  if (!r.ok) throw new Error(`respond failed: ${r.status}`)
}

export async function abort(sessionId: string): Promise<void> {
  const r = await bearerFetch(`/api/session/${sessionId}/abort`, { method: 'POST', body: JSON.stringify({}) })
  if (!r.ok) throw new Error(`abort failed: ${r.status}`)
}
