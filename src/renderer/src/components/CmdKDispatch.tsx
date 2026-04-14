import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentProfile, AppConfig, Project } from '../types'
import { parseSlashCommand } from '../../../shared/commandParser'
import { CommandPalette, type CommandPaletteHandle } from './CommandPalette'

interface CmdKDispatchProps {
  open: boolean
  projects: Project[]
  config: AppConfig | null
  onClose: () => void
  onDispatched: (sessionId: string) => void
  /** Pre-select this project path when the overlay opens */
  presetProjectPath?: string | null
}

interface HistoryEntry {
  prompt: string
  projectPath: string
  projectName: string
  ts: number
}

const HISTORY_KEY = 'flight-deck.dispatchHistory'
const HISTORY_MAX = 20

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)))
  } catch {
    // ignore — localStorage may be disabled
  }
}

export function CmdKDispatch({
  open,
  projects,
  config,
  onClose,
  onDispatched,
  presetProjectPath
}: CmdKDispatchProps) {
  const [prompt, setPrompt] = useState('')
  const [targetPath, setTargetPath] = useState<string>('')
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('dispatching…')
  const [error, setError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  // 'new' = create new session; any other value = existing sessionId to append to
  const [sessionMode, setSessionMode] = useState<string>('new')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const paletteRef = useRef<CommandPaletteHandle | null>(null)
  const useMock = config?.mock.enabled ?? true

  // Load opencode profiles on mount.
  useEffect(() => {
    const api = window.electronAPI?.profile
    if (!api) return
    void api.list().then((all) => {
      setProfiles(all)
      // Pre-select the default profile, or the first one.
      const def = all.find((p) => p.isDefault) ?? all[0]
      if (def) setSelectedProfileId(def.id)
    })
  }, [])

  const dispatchableProjects = projects

  const target = useMemo(
    () =>
      dispatchableProjects.find((p) => p.path === targetPath) ??
      dispatchableProjects[0] ??
      null,
    [targetPath, projects]
  )

  // Default target + focus on open. Preset path (from "+ New Session") takes priority.
  // Otherwise pick the project with the most recent session activity so the
  // dispatch overlay doesn't default to an arbitrary (e.g. home-directory) project.
  useEffect(() => {
    if (!open) return
    if (presetProjectPath) {
      setTargetPath(presetProjectPath)
    } else if (!targetPath && projects.length > 0) {
      const mostRecent = [...projects].sort((a, b) => {
        const aLast = Math.max(0, ...a.sessions.map((s) => s.lastActivity))
        const bLast = Math.max(0, ...b.sessions.map((s) => s.lastActivity))
        return bLast - aLast
      })
      setTargetPath(mostRecent[0].path)
    }
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [open, projects, targetPath, presetProjectPath])

  // Clear state when closed.
  useEffect(() => {
    if (!open) {
      setPrompt('')
      setError(null)
      setBusy(false)
      setSessionMode('new')
    }
  }, [open])

  // Reset session mode when target project changes.
  useEffect(() => {
    setSessionMode('new')
  }, [targetPath])

  // If the selected append target disappears from the snapshot (session
  // completed, aborted, etc.) fall back to 'new' so the dropdown doesn't
  // hold an orphaned id that would dispatch to nothing.
  useEffect(() => {
    if (sessionMode === 'new') return
    const stillThere = target?.sessions.some(
      (s) =>
        s.id === sessionMode &&
        (
          (s.agentType === 'opencode' && (s.state === 'running' || s.state === 'idle' || s.state === 'question')) ||
          (s.agentType === 'claude-code' && (s.state === 'idle' || s.state === 'error'))
        )
    )
    if (!stillThere) setSessionMode('new')
  }, [target, sessionMode])

  const dispatch = useCallback(async () => {
    const text = prompt.trim()
    if (!text || busy) return
    if (!target) {
      setError('no project selected')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (useMock) {
        console.warn('[cmdk] mock mode — dispatch is a no-op', { target: target.path, text, sessionMode })
      } else if (sessionMode !== 'new') {
        // Find the target session to determine agent type
        const targetSession = target.sessions.find((s) => s.id === sessionMode)

        if (targetSession?.agentType === 'claude-code') {
          // Resume claude-code session via subprocess
          const api = window.electronAPI?.instance
          if (!api) throw new Error('bridge unavailable')
          setBusyLabel('resuming…')
          const res = await api.dispatch({
            profileId: selectedProfileId,
            directory: target.path,
            prompt: text,
            sessionId: sessionMode,
          })
          onDispatched(res.sessionId)
        } else {
          // Append to existing opencode session.
          const api = window.electronAPI?.opencode
          if (!api) throw new Error('bridge unavailable')
          setBusyLabel('sending…')
          // Slash command routing for append-to-existing-session path.
          const parsed = parseSlashCommand(text)
          if (parsed) {
            await api.sendCommand(sessionMode, parsed.command, parsed.args)
          } else {
            await api.sendPrompt(sessionMode, text.startsWith('\\/') ? text.slice(1) : text)
          }
          onDispatched(sessionMode)
        }
      } else if (selectedProfileId) {
        // Managed dispatch: launcher starts opencode serve if needed.
        const api = window.electronAPI?.instance
        if (!api) throw new Error('bridge unavailable')
        setBusyLabel('starting agent…')
        const res = await api.dispatch({
          profileId: selectedProfileId,
          directory: target.path,
          prompt: text
        })
        onDispatched(res.sessionId)
      } else {
        // Legacy path: use an already-running manually-configured instance.
        const api = window.electronAPI?.opencode
        if (!api) throw new Error('bridge unavailable')
        setBusyLabel('dispatching…')
        const instanceKey = target.sessions[0]?.instanceKey
        const res = await api.createSession({
          instanceKey,
          directory: target.path,
          prompt: text,
          title: text.slice(0, 60)
        })
        onDispatched(res.sessionId)
      }
      const entry: HistoryEntry = {
        prompt: text,
        projectPath: target.path,
        projectName: target.name,
        ts: Date.now()
      }
      const next = [entry, ...history.filter((h) => h.prompt !== text)].slice(0, HISTORY_MAX)
      setHistory(next)
      saveHistory(next)
      // Reset busy state BEFORE onClose() so a late setState can't warn
      // about being called on an unmounted component.
      setBusy(false)
      setBusyLabel('dispatching…')
      onClose()
      return
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setBusyLabel('dispatching…')
    }
  }, [prompt, busy, target, useMock, selectedProfileId, sessionMode, history, onClose, onDispatched])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 120,
        zIndex: 1000
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: '90%',
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
          padding: 16,
          fontSize: 12,
          color: 'var(--fg-primary)'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            color: 'var(--fg-muted)'
          }}
        >
          <span className="mono" style={{ fontWeight: 600 }}>⌘ Dispatch</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--fg-subtle)',
              fontSize: 10,
              padding: '2px 6px',
              cursor: 'pointer'
            }}
          >
            Esc
          </button>
        </div>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          {sessionMode !== 'new' && (
            <CommandPalette
              ref={paletteRef}
              sessionId={sessionMode}
              inputValue={prompt}
              onComplete={(completed) => {
                setPrompt(completed)
                textareaRef.current?.focus()
              }}
              onDismiss={() => {
                setPrompt('')
                textareaRef.current?.focus()
              }}
            />
          )}
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              // Forward navigation/completion/dismiss keys to the palette first
              if (sessionMode !== 'new' && paletteRef.current?.handleKey(e)) return
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void dispatch()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="What should the agent do?"
            rows={3}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 13,
              fontFamily: '"Berkeley Mono", "SF Mono", monospace',
              border: '1px solid var(--border)',
              borderRadius: 6,
              backgroundColor: 'var(--bg-base)',
              color: 'var(--fg-primary)',
              outline: 'none',
              resize: 'vertical'
            }}
          />
        </div>

        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11 }}
        >
          <span style={{ color: 'var(--fg-subtle)' }}>Target:</span>
          <select
            value={target?.path ?? ''}
            onChange={(e) => setTargetPath(e.target.value)}
            style={selectStyle}
          >
            {dispatchableProjects.length === 0 && <option value="">(no projects)</option>}
            {dispatchableProjects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
          {profiles.length > 0 ? (
            <>
              <span style={{ color: 'var(--fg-subtle)' }}>·</span>
              <select
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                style={selectStyle}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}{p.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span style={{ color: 'var(--fg-subtle)' }}>· opencode</span>
          )}
          <span style={{ color: 'var(--fg-subtle)' }}>·</span>
          <select
            value={sessionMode}
            onChange={(e) => setSessionMode(e.target.value)}
            style={selectStyle}
          >
            <option value="new">New session</option>
            {target?.sessions
              .filter(
                (s) =>
                  (s.agentType === 'opencode' &&
                    (s.state === 'running' || s.state === 'idle' || s.state === 'question')) ||
                  (s.agentType === 'claude-code' && (s.state === 'idle' || s.state === 'error'))
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.agentType === 'claude-code' ? 'Resume: ' : 'Append to: '}
                  #{s.id.slice(-4)} ({s.state})
                </option>
              ))}
          </select>
        </div>

        {error && (
          <div style={{ color: 'var(--status-error)', fontSize: 11, marginBottom: 8 }}>{error}</div>
        )}
        {useMock && (
          <div style={{ color: 'var(--fg-subtle)', fontSize: 10, marginBottom: 8 }}>
            mock mode — dispatch is a no-op
          </div>
        )}

        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 10,
            marginTop: 4,
            fontSize: 11
          }}
        >
          <div style={{ color: 'var(--fg-subtle)', marginBottom: 6 }}>Recent dispatches</div>
          {history.length === 0 && (
            <div style={{ color: 'var(--fg-subtle)', fontSize: 10 }}>(none yet)</div>
          )}
          {history.slice(0, 5).map((h) => (
            <button
              key={`${h.ts}-${h.prompt}`}
              onClick={() => {
                setPrompt(h.prompt)
                setTargetPath(h.projectPath)
                textareaRef.current?.focus()
              }}
              style={{
                display: 'flex',
                width: '100%',
                textAlign: 'left',
                gap: 8,
                padding: '4px 0',
                background: 'none',
                border: 'none',
                color: 'var(--fg-muted)',
                cursor: 'pointer',
                fontSize: 11
              }}
            >
              <span style={{ color: 'var(--fg-subtle)' }}>↑</span>
              <span
                className="mono"
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {h.prompt}
              </span>
              <span style={{ color: 'var(--fg-subtle)' }}>{h.projectName}</span>
            </button>
          ))}
        </div>

        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '1px solid var(--border)',
            fontSize: 10,
            color: 'var(--fg-subtle)'
          }}
        >
          ⌘↵ Send · Esc dismiss {busy && `· ${busyLabel}`}
        </div>
      </div>
    </div>
  )
}

const selectStyle: CSSProperties = {
  fontSize: 11,
  padding: '3px 6px',
  backgroundColor: 'var(--bg-base)',
  color: 'var(--fg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  cursor: 'pointer'
}
